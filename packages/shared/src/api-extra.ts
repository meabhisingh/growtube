/**
 * Additions to the HTTP contract in `api.ts` (kept in a separate file so the
 * original contract stays untouched). Same conventions: every request and
 * response is validated with these schemas on both sides.
 */
import { z } from "zod";

import { channelIdSchema, videoIdSchema } from "./api";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const isoDateTime = z.iso.datetime({ offset: true });

/** Max ids per `GET /v1/videos/stats` call. */
export const MAX_VIDEO_STATS_IDS = 50;

// ---------------------------------------------------------------------------
// Batch stats (server -> clients): latest known stats + server-side VPH for
// many videos at once. Powers the VPH badges on feed / search cards.
// ---------------------------------------------------------------------------

/**
 * `?ids=a,b,c` — comma-separated video ids, 1..50, duplicates ignored.
 * Parses into a de-duplicated `string[]`.
 */
export const videoStatsQuery = z.object({
	ids: z
		.string()
		.max(MAX_VIDEO_STATS_IDS * 13)
		.transform((raw) => [
			...new Set(
				raw
					.split(",")
					.map((id) => id.trim())
					.filter(Boolean),
			),
		])
		.pipe(z.array(videoIdSchema).min(1).max(MAX_VIDEO_STATS_IDS)),
});
export type VideoStatsQuery = z.infer<typeof videoStatsQuery>;

/** Where `recentVph` came from. */
export const vphSourceSchema = z.enum([
	/** Views gained per hour across the last ~48h of snapshots. */
	"recent",
	/** Lifetime average (views ÷ hours since publish): not enough history yet. */
	"lifetime",
]);
export type VphSource = z.infer<typeof vphSourceSchema>;

export const videoStats = z.object({
	videoId: videoIdSchema,
	channelId: channelIdSchema.nullable(),
	title: z.string().nullable(),
	channelTitle: z.string().nullable(),
	publishedAt: isoDateTime.nullable(),
	durationSec: z.number().int().nonnegative().nullable(),
	isShort: z.boolean().nullable(),
	views: count,
	likes: count.nullable(),
	comments: count.nullable(),
	/**
	 * Server-side views/hour. Momentum over the most recent ~48h of snapshots
	 * when `vphSource` is "recent", else the lifetime average. Null when
	 * neither can be computed (e.g. unknown publish date, single snapshot).
	 */
	recentVph: z.number().nonnegative().nullable(),
	vphSource: vphSourceSchema.nullable(),
	firstSeenAt: isoDateTime,
	lastSnapshotAt: isoDateTime.nullable(),
});
export type VideoStats = z.infer<typeof videoStats>;

export const videoStatsResponse = z.object({
	generatedAt: isoDateTime,
	/** Known videos, in the order they were requested. */
	videos: z.array(videoStats),
	/** Requested ids the server has never seen. */
	missing: z.array(videoIdSchema),
});
export type VideoStatsResponse = z.infer<typeof videoStatsResponse>;

// ---------------------------------------------------------------------------
// Handle -> channel id (server -> clients), from channels the server has seen.
// ---------------------------------------------------------------------------

/** `?handle=@name` (the leading "@" is optional). */
export const channelResolveQuery = z.object({
	handle: z
		.string()
		.trim()
		.min(1)
		.max(101)
		.regex(/^@?[^\s/?#@]{1,100}$/u, "invalid handle"),
});
export type ChannelResolveQuery = z.infer<typeof channelResolveQuery>;

export const channelResolveResponse = z.object({
	channelId: channelIdSchema,
	handle: z.string().nullable(),
	title: z.string().nullable(),
});
export type ChannelResolveResponse = z.infer<typeof channelResolveResponse>;

export const API_ROUTES_EXTRA = {
	videoStats: "/v1/videos/stats",
	/** 404 when the server has never seen a channel with that handle. */
	channelResolve: "/v1/channels/resolve",
} as const;

/** Builds `/v1/channels/resolve?handle=…`. */
export function channelResolvePath(handle: string): string {
	return `${API_ROUTES_EXTRA.channelResolve}?handle=${encodeURIComponent(handle)}`;
}

/** Builds `/v1/videos/stats?ids=…` (ids are URL-safe, so no escaping). */
export function videoStatsPath(ids: readonly string[]): string {
	return `${API_ROUTES_EXTRA.videoStats}?ids=${ids.join(",")}`;
}
