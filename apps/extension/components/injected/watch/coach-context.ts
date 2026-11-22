/** Builds the AI coach context from everything the watch panel knows. */
import type { CoachContext } from "@/lib/ai/types";
import type { MyChannel } from "@/lib/settings";
import type {
	ChannelInfo,
	ChannelVideo,
	VideoDetails,
} from "@/lib/youtube/types";

import type { WatchMetrics } from "./data";

export type CoachInputs = {
	details: VideoDetails;
	metrics: WatchMetrics | null;
	channel?: ChannelInfo | null;
	/** Baselines of both formats when known */
	baselineLong?: number | null;
	baselineShort?: number | null;
	uploadsPerWeek?: number | null;
	tagRanks?: Record<string, number | null> | null;
	recentVideos?: ChannelVideo[] | null;
	transcriptExcerpt?: string | null;
	myChannel?: MyChannel | null;
};

export function buildCoachContext(input: CoachInputs): CoachContext {
	const { details: d, metrics: m, channel: c } = input;
	const ctx: CoachContext = {
		page: d.isShort ? "shorts" : "watch",
		video: {
			videoId: d.videoId,
			title: d.title,
			description: d.description,
			channelTitle: d.channelTitle,
			views: d.views,
			likes: d.likes,
			comments: d.comments,
			publishedAt: d.publishedAt,
			durationSec: d.durationSec,
			isShort: d.isShort,
			keywords: d.keywords,
			category: d.category,
		},
		stats: {
			vph: m?.lifetimeVph ?? null,
			recentVph: m?.recentVph ?? null,
			engagementRate: m?.engagementRate ?? null,
			outlierScore: m?.outlierScore ?? null,
			baseline: m?.baseline ?? null,
			ageHours: m?.ageHours ?? null,
			seoScore: m?.seo.score ?? null,
			...(input.tagRanks && Object.keys(input.tagRanks).length
				? { tagRanks: input.tagRanks }
				: {}),
		},
	};
	if (c) {
		ctx.channel = {
			channelId: c.channelId,
			title: c.title,
			handle: c.handle,
			subscribers: c.subscribers,
			totalViews: c.totalViews,
			videoCount: c.videoCount,
			joinedAt: c.joinedAt,
			country: c.country,
			keywords: c.keywords,
			description: c.description,
			baselineLong:
				input.baselineLong ?? (m?.format === "long" ? m.baseline : null),
			baselineShort:
				input.baselineShort ?? (m?.format === "short" ? m.baseline : null),
			uploadsPerWeek: input.uploadsPerWeek ?? null,
		};
	} else if (d.channelId) {
		ctx.channel = {
			channelId: d.channelId,
			title: d.channelTitle,
			handle: d.channelHandle,
			subscribers: d.channelSubscribers,
		};
	}
	if (input.recentVideos?.length) {
		ctx.recentVideos = input.recentVideos
			.filter((v) => v.videoId !== d.videoId)
			.slice(0, 15)
			.map((v) => ({
				title: v.title,
				views: v.views,
				publishedAt: v.publishedAt,
				isShort: v.isShort,
			}));
	}
	if (input.myChannel) {
		ctx.myChannel = {
			title: input.myChannel.title,
			handle: input.myChannel.handle,
		};
	}
	if (input.transcriptExcerpt) ctx.transcriptExcerpt = input.transcriptExcerpt;
	return ctx;
}
