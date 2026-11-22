/**
 * HTTP contract between the extension / web app and the Hono worker.
 * Every request body and response body is validated with these schemas on
 * both sides, so change them here and let the type-checker find the callers.
 */
import { z } from "zod";

import { youTubeImageOrNull } from "./images";
import { CHANNEL_ID_RE, VIDEO_ID_RE } from "./youtube";

export const videoIdSchema = z.string().regex(VIDEO_ID_RE, "invalid video id");
export const channelIdSchema = z
	.string()
	.regex(CHANNEL_ID_RE, "invalid channel id");

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
/** Counts stored in Postgres `integer` columns (durations, video counts). */
const INT4_MAX = 2_147_483_647;
const int4Count = z.number().int().nonnegative().max(INT4_MAX);
/** ISO-8601 timestamp; offsets like `-08:00` (YouTube's publishDate) allowed. */
const isoDateTime = z.iso.datetime({ offset: true });

/** Postgres text can't hold NUL characters; they never carry meaning here. */
const stripNul = (s: string) =>
	s.includes("\u0000") ? s.replaceAll("\u0000", "") : s;
/** Free text from clients: length-capped, NUL characters removed. */
const text = (max: number) => z.string().max(max).transform(stripNul);
/** YouTube launched in 2005: earlier channel join dates are bogus. */
const YOUTUBE_FIRST_DAY = "2005-01-01";

// ---------------------------------------------------------------------------
// Ingest (extension -> server). Anonymous, rate-limited, crowdsourced stats.
// ---------------------------------------------------------------------------

export const videoSnapshotInput = z.object({
	videoId: videoIdSchema,
	channelId: channelIdSchema.optional(),
	title: text(300).optional(),
	channelTitle: text(200).optional(),
	publishedAt: isoDateTime.optional(),
	durationSec: int4Count.optional(),
	isShort: z.boolean().optional(),
	views: count,
	likes: count.optional(),
	comments: count.optional(),
});
export type VideoSnapshotInput = z.infer<typeof videoSnapshotInput>;

export const ingestVideosBody = z.object({
	videos: z.array(videoSnapshotInput).min(1).max(50),
});
export type IngestVideosBody = z.infer<typeof ingestVideosBody>;

export const channelSnapshotInput = z.object({
	channelId: channelIdSchema,
	handle: text(100).optional(),
	title: text(200).optional(),
	/**
	 * Only https URLs on YouTube's image hosts (`isYouTubeImageUrl`). Anything
	 * else is dropped (treated as absent) rather than failing the batch.
	 */
	avatarUrl: z
		.string()
		.max(4000)
		.transform((value) => youTubeImageOrNull(stripNul(value)) ?? undefined)
		.optional(),
	subscribers: count.optional(),
	totalViews: count.optional(),
	videoCount: int4Count.optional(),
	/** YYYY-MM-DD, 2005 or later */
	joinedAt: z.iso
		.date()
		.refine((d) => d >= YOUTUBE_FIRST_DAY, "date before YouTube existed")
		.optional(),
	country: text(80).optional(),
	keywords: z.array(text(100)).max(100).optional(),
});
export type ChannelSnapshotInput = z.infer<typeof channelSnapshotInput>;

export const ingestChannelsBody = z.object({
	channels: z.array(channelSnapshotInput).min(1).max(50),
});
export type IngestChannelsBody = z.infer<typeof ingestChannelsBody>;

export const ingestResponse = z.object({
	accepted: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
});
export type IngestResponse = z.infer<typeof ingestResponse>;

// ---------------------------------------------------------------------------
// History (server -> clients)
// ---------------------------------------------------------------------------

export const historyRangeSchema = z.enum(["24h", "7d", "28d", "all"]);
export type HistoryRange = z.infer<typeof historyRangeSchema>;

export const videoHistoryQuery = z.object({
	range: historyRangeSchema.default("24h"),
});

export const videoHistoryPoint = z.object({
	/** ISO timestamp of the snapshot */
	t: isoDateTime,
	views: count,
	likes: count.nullable(),
	comments: count.nullable(),
});
export type VideoHistoryPoint = z.infer<typeof videoHistoryPoint>;

export const videoHistoryResponse = z.object({
	videoId: videoIdSchema,
	range: historyRangeSchema,
	publishedAt: isoDateTime.nullable(),
	firstSeenAt: isoDateTime.nullable(),
	/**
	 * For "24h" / "7d" / "28d" the window is relative to publishedAt (like
	 * vidIQ's "first 7 days"); when publishedAt is unknown it's relative to now.
	 */
	points: z.array(videoHistoryPoint),
	/** Views/hour over the most recent ~48h of snapshots, null if < 2 points. */
	recentVph: z.number().nullable(),
	/**
	 * Display metadata, when the server knows it. Optional so older servers
	 * and cached responses stay valid.
	 */
	title: z.string().nullable().optional(),
	channelId: channelIdSchema.nullable().optional(),
	channelTitle: z.string().nullable().optional(),
});
export type VideoHistoryResponse = z.infer<typeof videoHistoryResponse>;

export const channelHistoryPoint = z.object({
	/** YYYY-MM-DD (UTC) */
	day: z.iso.date(),
	subscribers: count.nullable(),
	totalViews: count.nullable(),
	videoCount: count.nullable(),
});
export type ChannelHistoryPoint = z.infer<typeof channelHistoryPoint>;

export const channelHistoryResponse = z.object({
	channelId: channelIdSchema,
	points: z.array(channelHistoryPoint),
	/** Display metadata, when known (optional, like on video history). */
	title: z.string().nullable().optional(),
	handle: z.string().nullable().optional(),
	/** A YouTube image URL (`isYouTubeImageUrl`); anything else parses as null. */
	avatarUrl: z
		.string()
		.nullable()
		.optional()
		.transform((value) => (value == null ? value : youTubeImageOrNull(value))),
});
export type ChannelHistoryResponse = z.infer<typeof channelHistoryResponse>;

// ---------------------------------------------------------------------------
// Trending (server -> clients): top videos by recent VPH from crowdsourced
// snapshots + cron refreshes.
// ---------------------------------------------------------------------------

export const trendingWindowSchema = z.enum(["24h", "7d"]);
export type TrendingWindow = z.infer<typeof trendingWindowSchema>;

export const trendingQuery = z.object({
	window: trendingWindowSchema.default("24h"),
	type: z.enum(["all", "long", "short"]).default("all"),
	/** Case-insensitive title filter */
	q: z.string().trim().max(100).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type TrendingQuery = z.infer<typeof trendingQuery>;

export const trendingVideo = z.object({
	videoId: videoIdSchema,
	channelId: channelIdSchema.nullable(),
	title: z.string().nullable(),
	channelTitle: z.string().nullable(),
	publishedAt: isoDateTime.nullable(),
	views: count,
	vph: z.number().nonnegative(),
	isShort: z.boolean().nullable(),
});
export type TrendingVideo = z.infer<typeof trendingVideo>;

export const trendingResponse = z.object({
	window: trendingWindowSchema,
	generatedAt: isoDateTime,
	videos: z.array(trendingVideo),
});
export type TrendingResponse = z.infer<typeof trendingResponse>;

// ---------------------------------------------------------------------------

export const apiErrorResponse = z.object({
	error: z.string(),
	details: z.unknown().optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponse>;

export const API_ROUTES = {
	health: "/health",
	ingestVideos: "/v1/ingest/videos",
	ingestChannels: "/v1/ingest/channels",
	videoHistory: (videoId: string) => `/v1/videos/${videoId}/history`,
	channelHistory: (channelId: string) => `/v1/channels/${channelId}/history`,
	trending: "/v1/trending",
	/** MCP (streamable HTTP) endpoint exposing the same data to AI clients */
	mcp: "/mcp",
} as const;
