/**
 * Minimal YouTube Data API v3 client (videos.list / channels.list), used by
 * the hourly cron. Each list call costs 1 quota unit for up to 50 ids.
 */
import { parseIsoDuration } from "@growtube/shared";
import { z } from "zod";

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
export const YOUTUBE_MAX_IDS_PER_CALL = 50;

export class YouTubeApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		/** e.g. "quotaExceeded", "keyInvalid", "rateLimitExceeded" */
		readonly reason: string | undefined,
	) {
		super(message);
		this.name = "YouTubeApiError";
	}

	/** Errors after which further calls in the same run are pointless. */
	get isFatal(): boolean {
		return (
			this.status === 400 ||
			this.status === 401 ||
			(this.status === 403 &&
				[
					"quotaExceeded",
					"dailyLimitExceeded",
					"keyInvalid",
					"accessNotConfigured",
					"forbidden",
				].includes(this.reason ?? ""))
		);
	}
}

/** API counts are decimal strings; absent when hidden/disabled. */
const apiCount = z
	.string()
	.regex(/^\d+$/)
	.transform(Number)
	.refine(Number.isSafeInteger)
	.optional()
	.catch(undefined);

const videoItem = z.object({
	id: z.string(),
	snippet: z
		.object({
			publishedAt: z.string().optional(),
			channelId: z.string().optional(),
			title: z.string().optional(),
			channelTitle: z.string().optional(),
			liveBroadcastContent: z.string().optional(),
		})
		.optional(),
	statistics: z
		.object({
			viewCount: apiCount,
			likeCount: apiCount,
			commentCount: apiCount,
		})
		.optional(),
	contentDetails: z.object({ duration: z.string().optional() }).optional(),
	status: z.object({ privacyStatus: z.string().optional() }).optional(),
});

const thumbnail = z.object({ url: z.string() }).optional();

const channelItem = z.object({
	id: z.string(),
	snippet: z
		.object({
			title: z.string().optional(),
			customUrl: z.string().optional(),
			publishedAt: z.string().optional(),
			country: z.string().optional(),
			thumbnails: z
				.object({ default: thumbnail, medium: thumbnail, high: thumbnail })
				.optional(),
		})
		.optional(),
	statistics: z
		.object({
			viewCount: apiCount,
			subscriberCount: apiCount,
			hiddenSubscriberCount: z.boolean().optional(),
			videoCount: apiCount,
		})
		.optional(),
	brandingSettings: z
		.object({
			channel: z.object({ keywords: z.string().optional() }).optional(),
		})
		.optional(),
});

const listResponse = <T extends z.ZodType>(item: T) =>
	z.object({ items: z.array(z.unknown()).default([]) }).transform(({ items }) =>
		items.flatMap((raw) => {
			const parsed = item.safeParse(raw);
			return parsed.success ? [parsed.data as z.output<T>] : [];
		}),
	);

const errorBody = z
	.object({
		error: z
			.object({
				message: z.string().optional(),
				errors: z.array(z.object({ reason: z.string().optional() })).optional(),
			})
			.optional(),
	})
	.catch({});

export type ApiVideo = {
	id: string;
	channelId: string | null;
	title: string | null;
	channelTitle: string | null;
	publishedAt: Date | null;
	durationSec: number | null;
	views: number | null;
	likes: number | null;
	comments: number | null;
	isLive: boolean;
	/**
	 * "public", "unlisted" or "private" (null: not reported). videos.list by
	 * id returns unlisted videos too; only private and deleted ones are left
	 * out.
	 */
	privacyStatus: string | null;
};

export type ApiChannel = {
	id: string;
	title: string | null;
	handle: string | null;
	avatarUrl: string | null;
	joinedAt: string | null;
	country: string | null;
	subscribers: number | null;
	totalViews: number | null;
	videoCount: number | null;
	keywords: string[] | null;
};

export type YouTubeClientOptions = {
	apiKey: string;
	fetch?: typeof fetch;
	baseUrl?: string;
};

async function list(
	opts: YouTubeClientOptions,
	resource: "videos" | "channels",
	params: Record<string, string>,
): Promise<unknown> {
	const url = new URL(`${opts.baseUrl ?? YOUTUBE_API_BASE}/${resource}`);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
	url.searchParams.set("key", opts.apiKey);
	const res = await (opts.fetch ?? fetch)(url, {
		headers: { accept: "application/json" },
	});
	if (!res.ok) {
		const body = errorBody.parse(await res.json().catch(() => ({})));
		const reason = body.error?.errors?.[0]?.reason;
		throw new YouTubeApiError(
			`YouTube ${resource}.list failed (${res.status}${reason ? ` ${reason}` : ""}): ${body.error?.message ?? res.statusText}`,
			res.status,
			reason,
		);
	}
	return res.json();
}

function parseDate(value: string | undefined): Date | null {
	if (!value) return null;
	const t = Date.parse(value);
	return Number.isFinite(t) ? new Date(t) : null;
}

/** `"multi word" single other` -> ["multi word", "single", "other"] */
export function parseChannelKeywords(raw: string | undefined): string[] | null {
	if (!raw?.trim()) return null;
	const out: string[] = [];
	for (const m of raw.matchAll(/"([^"]+)"|(\S+)/g)) {
		const kw = (m[1] ?? m[2] ?? "").trim();
		if (kw) out.push(kw.slice(0, 100));
	}
	return out.length ? out.slice(0, 100) : null;
}

export async function fetchVideos(
	opts: YouTubeClientOptions,
	ids: string[],
): Promise<ApiVideo[]> {
	if (ids.length === 0) return [];
	const json = await list(opts, "videos", {
		part: "snippet,statistics,contentDetails,status",
		id: ids.slice(0, YOUTUBE_MAX_IDS_PER_CALL).join(","),
		maxResults: String(YOUTUBE_MAX_IDS_PER_CALL),
		fields:
			"items(id,snippet(publishedAt,channelId,title,channelTitle,liveBroadcastContent),statistics(viewCount,likeCount,commentCount),contentDetails(duration),status(privacyStatus))",
	});
	return listResponse(videoItem)
		.parse(json)
		.map((v) => ({
			id: v.id,
			channelId: v.snippet?.channelId ?? null,
			title: v.snippet?.title ?? null,
			channelTitle: v.snippet?.channelTitle ?? null,
			publishedAt: parseDate(v.snippet?.publishedAt),
			durationSec: parseIsoDuration(v.contentDetails?.duration),
			views: v.statistics?.viewCount ?? null,
			likes: v.statistics?.likeCount ?? null,
			comments: v.statistics?.commentCount ?? null,
			isLive: v.snippet?.liveBroadcastContent === "live",
			privacyStatus: v.status?.privacyStatus ?? null,
		}));
}

export async function fetchChannels(
	opts: YouTubeClientOptions,
	ids: string[],
): Promise<ApiChannel[]> {
	if (ids.length === 0) return [];
	const json = await list(opts, "channels", {
		part: "snippet,statistics,brandingSettings",
		id: ids.slice(0, YOUTUBE_MAX_IDS_PER_CALL).join(","),
		maxResults: String(YOUTUBE_MAX_IDS_PER_CALL),
		fields:
			"items(id,snippet(title,customUrl,publishedAt,country,thumbnails),statistics(viewCount,subscriberCount,hiddenSubscriberCount,videoCount),brandingSettings(channel(keywords)))",
	});
	return listResponse(channelItem)
		.parse(json)
		.map((c) => {
			const thumbs = c.snippet?.thumbnails;
			const customUrl = c.snippet?.customUrl?.trim();
			return {
				id: c.id,
				title: c.snippet?.title ?? null,
				handle: customUrl
					? customUrl.startsWith("@")
						? customUrl
						: `@${customUrl}`
					: null,
				avatarUrl:
					thumbs?.high?.url ??
					thumbs?.medium?.url ??
					thumbs?.default?.url ??
					null,
				joinedAt:
					parseDate(c.snippet?.publishedAt)?.toISOString().slice(0, 10) ?? null,
				country: c.snippet?.country ?? null,
				subscribers: c.statistics?.hiddenSubscriberCount
					? null
					: (c.statistics?.subscriberCount ?? null),
				totalViews: c.statistics?.viewCount ?? null,
				videoCount: c.statistics?.videoCount ?? null,
				keywords: parseChannelKeywords(c.brandingSettings?.channel?.keywords),
			};
		});
}
