/** Data hooks for the watch page panel (one video at a time). */
import type { VideoSnapshotInput } from "@growtube/shared/api";
import type { VideoStats } from "@growtube/shared/api-extra";
import {
	computeEngagementRate,
	computeOutlierScore,
	computeVph,
	hoursSince,
} from "@growtube/shared/metrics";
import { computeSeoScore, type SeoResult } from "@growtube/shared/seo";
import { useEffect, useMemo } from "react";

import { server, yt } from "@/lib/client";
import { getCurrentVideoDetails } from "@/lib/youtube/page";
import { videoIdFromUrl } from "@/lib/youtube/page-type";
import type {
	ChannelBaseline,
	ChannelInfo,
	VideoDetails,
	YtPageData,
} from "@/lib/youtube/types";
import { isPublicVideo } from "@/lib/youtube/visibility";

import { type AsyncState, useAsync } from "../common/async";

export type WatchData = {
	videoId: string;
	details: AsyncState<VideoDetails>;
	channel: AsyncState<ChannelInfo>;
	baseline: AsyncState<ChannelBaseline>;
	/** Server stats (null when the server doesn't know the video yet) */
	stats: AsyncState<VideoStats | null>;
	metrics: WatchMetrics | null;
};

export type WatchMetrics = {
	format: "long" | "short";
	ageHours: number | null;
	engagementRate: number | null;
	/** views / baseline of the same format; null while unknown */
	outlierScore: number | null;
	baseline: number | null;
	/** Lifetime average */
	lifetimeVph: number | null;
	/** Server momentum (last ~48h), when available */
	recentVph: number | null;
	/** What the VPH pill shows */
	vph: number | null;
	vphSource: "recent" | "lifetime" | null;
	seo: SeoResult;
};

/** Details for `videoId`, reusing the page's own player data when it matches. */
async function loadDetails(
	videoId: string,
	page: YtPageData | null,
): Promise<VideoDetails> {
	const fromPage =
		page?.videoId === videoId
			? await getCurrentVideoDetails({ level: "full", page })
			: videoIdFromUrl(location.href) === videoId
				? await getCurrentVideoDetails({ level: "full" })
				: null;
	return fromPage?.videoId === videoId
		? fromPage
		: yt.getVideoDetails(videoId, { level: "full" });
}

/** null for upcoming, unlisted, private or unknown-listing videos (never uploaded). */
export function snapshotFromDetails(
	d: VideoDetails,
): VideoSnapshotInput | null {
	if (!d.videoId || d.isUpcoming || !isPublicVideo(d)) return null;
	return {
		videoId: d.videoId,
		channelId: d.channelId || undefined,
		title: d.title ? d.title.slice(0, 300) : undefined,
		channelTitle: d.channelTitle ? d.channelTitle.slice(0, 200) : undefined,
		publishedAt: d.publishedAt ?? undefined,
		durationSec: d.durationSec ? Math.round(d.durationSec) : undefined,
		isShort: d.isShort,
		views: d.views,
		likes: d.likes ?? undefined,
		comments: d.commentsExact ? (d.comments ?? undefined) : undefined,
	};
}

/**
 * Queues an exact snapshot of the video and its channel for crowdsourced
 * history. The background already ingests everything it fetches; this makes
 * the watch-page snapshot explicit (deduplicated server-side and in the
 * queue, and a no-op when the user disabled crowdsourcing).
 */
function useIngest(
	details: VideoDetails | undefined,
	channel: ChannelInfo | undefined,
) {
	useEffect(() => {
		const snap = details ? snapshotFromDetails(details) : null;
		if (snap) void server.ingestVideos([snap]).catch(() => {});
	}, [details]);
	const isPublic = isPublicVideo(details);
	useEffect(() => {
		if (!channel || !isPublic) return;
		void server
			.ingestChannels([
				{
					channelId: channel.channelId,
					handle: channel.handle ?? undefined,
					title: channel.title || undefined,
					avatarUrl: channel.avatarUrl ?? undefined,
					subscribers: channel.subscribers ?? undefined,
					totalViews: channel.totalViews ?? undefined,
					videoCount: channel.videoCount ?? undefined,
					joinedAt: channel.joinedAt ?? undefined,
					country: channel.country ?? undefined,
					keywords: channel.keywords.length ? channel.keywords : undefined,
				},
			])
			.catch(() => {});
	}, [channel, isPublic]);
}

export function useWatchData(
	videoId: string,
	page: YtPageData | null,
): WatchData {
	const details = useAsync(() => loadDetails(videoId, page), [videoId]);
	const d = details.data;
	const channelId = d?.channelId || null;
	const format: "long" | "short" = d?.isShort ? "short" : "long";

	// Not crowdsourced here: useIngest uploads the channel only when the
	// video itself is public, so opening an unlisted or private video sends
	// nothing about its channel.
	const channel = useAsync(
		() =>
			yt.getChannel({ channelId: channelId as string }, { crowdsource: false }),
		[channelId],
		!!channelId,
	);
	const baseline = useAsync(
		() => yt.getChannelBaseline(channelId as string, format),
		[channelId, format],
		!!channelId,
	);
	// Server stats only for public videos: an unlisted or private video's id
	// never reaches the server. Waits for the details to know which it is.
	const lookupStats = !!d && isPublicVideo(d);
	const stats = useAsync(
		() =>
			server
				.getVideosStats([videoId])
				.then((r) => r.videos.find((v) => v.videoId === videoId) ?? null),
		[videoId, lookupStats],
		lookupStats,
	);

	useIngest(d, channel.data);

	const metrics = useMemo<WatchMetrics | null>(() => {
		if (!d) return null;
		const base = baseline.data?.baseline ?? null;
		const lifetimeVph = d.publishedAt
			? computeVph(d.views, d.publishedAt)
			: null;
		const s = stats.data;
		const recentVph = s?.vphSource === "recent" ? s.recentVph : null;
		const vph = recentVph ?? lifetimeVph;
		return {
			format,
			ageHours: d.publishedAt ? hoursSince(d.publishedAt) : null,
			engagementRate: computeEngagementRate({
				views: d.views,
				likes: d.likes,
				comments: d.comments,
			}),
			outlierScore: computeOutlierScore(d.views, base),
			baseline: base,
			lifetimeVph,
			recentVph,
			vph,
			vphSource:
				recentVph != null ? "recent" : lifetimeVph != null ? "lifetime" : null,
			seo: computeSeoScore({
				title: d.title,
				description: d.description,
				tags: d.keywords,
				durationSec: d.durationSec,
				isShort: d.isShort,
			}),
		};
	}, [d, baseline.data, stats.data, format]);

	return { videoId, details, channel, baseline, stats, metrics };
}
