/**
 * Data loaders shared by several side-panel tools. Everything goes through
 * `@/lib/client` (the background caches and rate-limits it), so calling the
 * same loader from two tools is cheap.
 */
import { formatCompact } from "@growtube/shared/format";
import {
	computeEngagementRate,
	computeUploadsPerWeek,
	median,
} from "@growtube/shared/metrics";
import { computeSeoScore } from "@growtube/shared/seo";
import {
	extractChannelRef,
	extractVideoId,
	isChannelId,
} from "@growtube/shared/youtube";

import type { CoachContext } from "@/lib/ai/types";
import { BackgroundError, yt } from "@/lib/client";
import type { Competitor, MyChannel } from "@/lib/settings";
import type {
	ChannelInfo,
	ChannelRef,
	ChannelVideo,
	VideoDetails,
} from "@/lib/youtube/types";
import { isPublicVideo } from "@/lib/youtube/visibility";

import { ageHoursOf, createQueue, outlierOf, vphOf } from "./utils";

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Channel input
// ---------------------------------------------------------------------------

/**
 * Parses what users paste into a "channel" field: a channel URL, @handle,
 * UC… id, a bare handle, or a video URL (→ the uploader's channel).
 */
export function parseChannelInput(
	input: string,
): { ref: ChannelRef } | { videoId: string } | null {
	const value = input.trim();
	if (!value) return null;
	if (isChannelId(value)) return { ref: { channelId: value } };
	const ref = extractChannelRef(value);
	if (ref) return { ref };
	if (/youtu\.?be|youtube\.com/i.test(value) || /^[\w-]{11}$/.test(value)) {
		const videoId = extractVideoId(value);
		if (videoId) return { videoId };
	}
	if (/^[\w.-]{3,30}$/.test(value)) return { ref: { handle: `@${value}` } };
	return null;
}

/** Resolves a pasted channel reference to full channel info. */
export async function resolveChannelInput(input: string): Promise<ChannelInfo> {
	const parsed = parseChannelInput(input);
	if (!parsed) {
		throw new BackgroundError(
			"channel",
			"Paste a channel URL, an @handle, a channel id (UC…) or a video link.",
			"BAD_REQUEST",
		);
	}
	if ("videoId" in parsed) {
		const video = await yt.getVideoDetails(parsed.videoId, { level: "basic" });
		// An unlisted or private video's channel is not crowdsourced.
		return yt.getChannel(
			{ channelId: video.channelId },
			{ crowdsource: isPublicVideo(video) },
		);
	}
	return yt.getChannel(parsed.ref);
}

export function toCompetitor(c: ChannelInfo): Competitor {
	return {
		channelId: c.channelId,
		handle: c.handle,
		title: c.title,
		avatarUrl: c.avatarUrl,
	};
}

export function toMyChannel(c: ChannelInfo): MyChannel {
	return { channelId: c.channelId, handle: c.handle, title: c.title };
}

// ---------------------------------------------------------------------------
// Channel overview
// ---------------------------------------------------------------------------

export type ScoredChannelVideo = ChannelVideo & {
	vph: number | null;
	outlier: number | null;
};

export type ChannelOverview = {
	channel: ChannelInfo;
	/** Newest long-form uploads, with VPH and outlier score */
	videos: ScoredChannelVideo[];
	baselineLong: number | null;
	/** Mean views of the newest uploads older than a day */
	avgRecentViews: number | null;
	uploadsPerWeek: number | null;
};

export function scoreChannelVideos(
	videos: ChannelVideo[],
	baseline: number | null,
): ScoredChannelVideo[] {
	return videos.map((v) => ({
		...v,
		vph: vphOf(v.views, v.publishedAt),
		outlier: outlierOf(v.views, baseline),
	}));
}

/** Uploads older than 24 h (fresh uploads haven't had time to collect views). */
export function settledVideos<
	T extends { publishedAt: string | null; isLive?: boolean },
>(videos: T[]): T[] {
	return videos.filter((v) => {
		if (v.isLive) return false;
		const h = ageHoursOf(v.publishedAt);
		return h == null || h >= 24;
	});
}

export function averageViews(
	videos: { views: number | null }[],
): number | null {
	const nums = videos
		.map((v) => v.views)
		.filter((n): n is number => n != null && Number.isFinite(n));
	return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export async function loadChannelOverview(
	channelId: string,
	opts: { limit?: number; force?: boolean } = {},
): Promise<ChannelOverview> {
	const [channel, videos, baseline] = await Promise.all([
		yt.getChannel({ channelId }, { force: opts.force }),
		yt.getChannelVideos(channelId, { limit: opts.limit ?? 30 }),
		yt
			.getChannelBaseline(channelId, "long", { force: opts.force })
			.catch(() => null),
	]);
	const baselineLong =
		baseline?.baseline ??
		median(
			settledVideos(videos)
				.map((v) => v.views)
				.filter((n): n is number => n != null),
		);
	const recent = settledVideos(videos).slice(0, 15);
	return {
		channel,
		videos: scoreChannelVideos(videos, baselineLong),
		baselineLong,
		avgRecentViews: averageViews(recent),
		uploadsPerWeek: computeUploadsPerWeek(
			videos
				.slice(0, 20)
				.map((v) => v.publishedAt)
				.filter((d): d is string => !!d),
		),
	};
}

// ---------------------------------------------------------------------------
// Competitor outliers
// ---------------------------------------------------------------------------

export type CompetitorOutlier = ScoredChannelVideo & {
	channelId: string;
	channelTitle: string;
	channelAvatar: string | null;
};

const competitorQueue = createQueue(2);

/**
 * Recent long-form uploads of the given channels, best outlier first.
 * Channels that fail to load are skipped (reported in `failed`).
 */
export async function loadCompetitorOutliers(
	channels: Competitor[],
	opts: { maxAgeDays?: number; limit?: number; minOutlier?: number } = {},
): Promise<{ videos: CompetitorOutlier[]; failed: string[] }> {
	const maxAge = (opts.maxAgeDays ?? 30) * DAY_MS;
	const failed: string[] = [];
	const lists = await Promise.all(
		channels.map((c) =>
			competitorQueue(async () => {
				try {
					const [videos, baseline] = await Promise.all([
						yt.getChannelVideos(c.channelId, { limit: 30 }),
						yt.getChannelBaseline(c.channelId, "long").catch(() => null),
					]);
					const base =
						baseline?.baseline ??
						median(
							settledVideos(videos)
								.map((v) => v.views)
								.filter((n): n is number => n != null),
						);
					return scoreChannelVideos(videos, base)
						.filter((v) => {
							if (!v.publishedAt || v.isLive || v.isUpcoming) return false;
							const age = Date.now() - Date.parse(v.publishedAt);
							return age <= maxAge && age >= DAY_MS / 2;
						})
						.map(
							(v): CompetitorOutlier => ({
								...v,
								channelId: c.channelId,
								channelTitle: c.title,
								channelAvatar: c.avatarUrl,
							}),
						);
				} catch {
					failed.push(c.title);
					return [];
				}
			}),
		),
	);
	const min = opts.minOutlier ?? 0;
	const videos = lists
		.flat()
		.filter((v) => (v.outlier ?? 0) >= min)
		.sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))
		.slice(0, opts.limit ?? 20);
	return { videos, failed };
}

// ---------------------------------------------------------------------------
// Coach contexts
// ---------------------------------------------------------------------------

export function coachChannel(
	c: ChannelInfo,
	extra: {
		baselineLong?: number | null;
		baselineShort?: number | null;
		uploadsPerWeek?: number | null;
	} = {},
): NonNullable<CoachContext["channel"]> {
	return {
		channelId: c.channelId,
		title: c.title,
		handle: c.handle,
		subscribers: c.subscribers,
		totalViews: c.totalViews,
		videoCount: c.videoCount,
		joinedAt: c.joinedAt,
		country: c.country,
		keywords: c.keywords.slice(0, 30),
		description: c.description.slice(0, 600),
		...extra,
	};
}

export function coachRecentVideos(
	videos: ChannelVideo[],
	max = 15,
): NonNullable<CoachContext["recentVideos"]> {
	return videos.slice(0, max).map((v) => ({
		title: v.title,
		views: v.views,
		publishedAt: v.publishedAt,
		isShort: v.isShort,
	}));
}

export function coachVideo(
	v: VideoDetails,
): NonNullable<CoachContext["video"]> {
	return {
		videoId: v.videoId,
		title: v.title,
		description: v.description.slice(0, 2_000),
		channelTitle: v.channelTitle,
		views: v.views,
		likes: v.likes,
		comments: v.comments,
		publishedAt: v.publishedAt,
		durationSec: v.durationSec,
		isShort: v.isShort,
		keywords: v.keywords,
		category: v.category,
	};
}

export type BuiltContext = {
	context: CoachContext;
	/** Short human label ("Video: …", "Channel: …") */
	label: string;
	video?: VideoDetails;
	channel?: ChannelInfo;
};

/** Everything the coach should know about a video (+ its channel). */
export async function buildVideoContext(
	videoId: string,
): Promise<BuiltContext> {
	const video = await yt.getVideoDetails(videoId);
	const format = video.isShort ? "short" : "long";
	const [baseline, channel, recent] = await Promise.all([
		yt.getChannelBaseline(video.channelId, format).catch(() => null),
		yt
			.getChannel(
				{ channelId: video.channelId },
				{ crowdsource: isPublicVideo(video) },
			)
			.catch(() => null),
		yt
			.getChannelVideos(video.channelId, {
				tab: video.isShort ? "shorts" : "videos",
				limit: 15,
			})
			.catch(() => [] as ChannelVideo[]),
	]);
	const base = baseline?.baseline ?? null;
	const seo = computeSeoScore({
		title: video.title,
		description: video.description,
		tags: video.keywords,
		durationSec: video.durationSec,
		isShort: video.isShort,
	});
	const context: CoachContext = {
		page: video.isShort ? "shorts" : "watch",
		video: coachVideo(video),
		stats: {
			vph: vphOf(video.views, video.publishedAt),
			engagementRate: computeEngagementRate(video),
			outlierScore: outlierOf(video.views, base),
			baseline: base,
			ageHours: ageHoursOf(video.publishedAt),
			seoScore: seo.score,
		},
		channel: channel
			? coachChannel(channel, {
					[video.isShort ? "baselineShort" : "baselineLong"]: base,
				})
			: {
					channelId: video.channelId,
					title: video.channelTitle,
					handle: video.channelHandle,
					subscribers: video.channelSubscribers,
				},
		recentVideos: coachRecentVideos(
			recent.filter((v) => v.videoId !== videoId),
		),
	};
	return {
		context,
		label: video.title,
		video,
		channel: channel ?? undefined,
	};
}

/** Everything the coach should know about a channel. */
export async function buildChannelContext(
	ref: ChannelRef,
	page: CoachContext["page"] = "channel",
): Promise<BuiltContext> {
	const channel = await yt.getChannel(ref);
	const [videos, long, short] = await Promise.all([
		yt
			.getChannelVideos(channel.channelId, { limit: 20 })
			.catch(() => [] as ChannelVideo[]),
		yt.getChannelBaseline(channel.channelId, "long").catch(() => null),
		yt.getChannelBaseline(channel.channelId, "short").catch(() => null),
	]);
	return {
		context: {
			page,
			channel: coachChannel(channel, {
				baselineLong: long?.baseline ?? null,
				baselineShort: short?.baseline ?? null,
				uploadsPerWeek: computeUploadsPerWeek(
					videos.map((v) => v.publishedAt).filter((d): d is string => !!d),
				),
			}),
			recentVideos: coachRecentVideos(videos),
		},
		label: channel.title,
		channel,
	};
}

/** One-line summary of a channel for headers. */
export function channelSummary(c: ChannelInfo): string {
	return [
		c.handle,
		c.subscribers != null
			? `${formatCompact(c.subscribers, 2)} subscribers`
			: null,
		c.videoCount != null ? `${formatCompact(c.videoCount)} videos` : null,
	]
		.filter(Boolean)
		.join(" · ");
}
