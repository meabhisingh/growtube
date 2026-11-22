/**
 * Video details from InnerTube `player` (+ `next` for comments/owner info).
 *
 * The parsers are pure and also run in content scripts on the page's own
 * ytInitialPlayerResponse / ytInitialData (see lib/youtube/page.ts), so the
 * current video is never fetched twice.
 */
import { isVideoId, thumbnailUrl } from "@growtube/shared/youtube";

import { cached, cacheGet, TTL } from "../cache";
import { innertube, YouTubeError } from "./innertube";
import {
	handleFromUrl,
	parseCount,
	parseEnglishDate,
	toInt,
	toIso,
} from "./parse";
import type {
	CaptionTrack,
	Thumbnail,
	VideoDetails,
	VideoDetailsLevel,
} from "./types";
import { type AnyObj, findAll, findFirst, get, isObj, textOf } from "./walk";

/** Max Shorts length (YouTube raised it to 3 minutes in Oct 2024). */
export const SHORTS_MAX_SECONDS = 180;

// ---------------------------------------------------------------------------
// player
// ---------------------------------------------------------------------------

/** Normalized subset of a `player` response. */
export type PlayerInfo = {
	videoId: string;
	title: string;
	description: string;
	channelId: string;
	channelTitle: string;
	channelHandle: string | null;
	views: number | null;
	likes: number | null;
	publishedAt: string | null;
	durationSec: number;
	isShortsEligible: boolean | null;
	isLive: boolean;
	isLiveContent: boolean;
	isUpcoming: boolean;
	isUnlisted: boolean;
	/** videoDetails.isPrivate: only the uploader can watch it */
	isPrivate: boolean;
	/** The response says whether the video is listed (microformat or isCrawlable) */
	listingKnown: boolean;
	isFamilySafe: boolean | null;
	keywords: string[];
	category: string | null;
	thumbnails: Thumbnail[];
	captionTracks: CaptionTrack[];
	/** playabilityStatus.status, e.g. OK, UNPLAYABLE, LOGIN_REQUIRED, ERROR */
	playability: string | null;
	playabilityReason: string | null;
};

export function parseCaptionTracks(player: unknown): CaptionTrack[] {
	const list = get<AnyObj[]>(
		player,
		"captions",
		"playerCaptionsTracklistRenderer",
		"captionTracks",
	);
	if (!Array.isArray(list)) return [];
	return list
		.filter(
			(t) =>
				typeof t?.baseUrl === "string" && typeof t?.languageCode === "string",
		)
		.map((t) => ({
			baseUrl: t.baseUrl.startsWith("/")
				? `https://www.youtube.com${t.baseUrl}`
				: t.baseUrl,
			languageCode: t.languageCode,
			name: textOf(t.name) ?? t.languageCode,
			kind: t.kind === "asr" ? ("asr" as const) : ("manual" as const),
			vssId: typeof t.vssId === "string" ? t.vssId : null,
			isTranslatable: t.isTranslatable === true,
		}));
}

/** Returns null when the response has no videoDetails (unavailable/private). */
export function parsePlayer(player: unknown): PlayerInfo | null {
	if (!isObj(player)) return null;
	const vd = player.videoDetails as AnyObj | undefined;
	const mf =
		get<AnyObj>(player, "microformat", "playerMicroformatRenderer") ?? {};
	const videoId = (vd?.videoId ?? mf.externalVideoId) as string | undefined;
	if (!vd || !isVideoId(videoId)) return null;

	const live = mf.liveBroadcastDetails as AnyObj | undefined;
	const thumbs: Thumbnail[] = [
		...((get<AnyObj[]>(vd, "thumbnail", "thumbnails") ?? []) as Thumbnail[]),
		...((get<AnyObj[]>(mf, "thumbnail", "thumbnails") ?? []) as Thumbnail[]),
	]
		.filter((t) => typeof t?.url === "string")
		.map((t) => ({ url: t.url, width: t.width, height: t.height }));

	const ps = player.playabilityStatus as AnyObj | undefined;
	// Unlisted and private videos are never crawlable. SPA player responses
	// can lack the microformat, so fall back to isCrawlable for the listing.
	const mfUnlisted = typeof mf.isUnlisted === "boolean" ? mf.isUnlisted : null;
	const crawlable = typeof vd.isCrawlable === "boolean" ? vd.isCrawlable : null;
	return {
		videoId,
		title: String(vd.title ?? textOf(mf.title) ?? ""),
		description: String(vd.shortDescription ?? textOf(mf.description) ?? ""),
		channelId: String(vd.channelId ?? mf.externalChannelId ?? ""),
		channelTitle: String(vd.author ?? mf.ownerChannelName ?? ""),
		channelHandle: handleFromUrl(mf.ownerProfileUrl),
		views: toInt(vd.viewCount ?? mf.viewCount),
		likes: toInt(mf.likeCount),
		publishedAt: toIso(mf.publishDate ?? mf.uploadDate ?? live?.startTimestamp),
		durationSec: toInt(vd.lengthSeconds ?? mf.lengthSeconds) ?? 0,
		isShortsEligible:
			typeof mf.isShortsEligible === "boolean" ? mf.isShortsEligible : null,
		isLive: vd.isLive === true || live?.isLiveNow === true,
		isLiveContent: vd.isLiveContent === true || Boolean(live),
		isUpcoming: vd.isUpcoming === true || ps?.status === "LIVE_STREAM_OFFLINE",
		isUnlisted: mfUnlisted ?? crawlable === false,
		isPrivate: vd.isPrivate === true,
		listingKnown: mfUnlisted != null || crawlable != null,
		isFamilySafe: typeof mf.isFamilySafe === "boolean" ? mf.isFamilySafe : null,
		keywords: Array.isArray(vd.keywords) ? vd.keywords.map(String) : [],
		category: typeof mf.category === "string" ? mf.category : null,
		thumbnails: thumbs,
		captionTracks: parseCaptionTracks(player),
		playability: typeof ps?.status === "string" ? ps.status : null,
		playabilityReason:
			textOf(ps?.reason) ?? (typeof ps?.reason === "string" ? ps.reason : null),
	};
}

// ---------------------------------------------------------------------------
// next (watch-next)
// ---------------------------------------------------------------------------

/** Normalized subset of a `next` (watch page) response. */
export type NextInfo = {
	videoId: string | null;
	title: string | null;
	description: string | null;
	channelId: string | null;
	channelTitle: string | null;
	channelHandle: string | null;
	channelSubscribers: number | null;
	views: number | null;
	likes: number | null;
	likesExact: boolean;
	/** Rounded count from the comments panel header ("2.4M") */
	commentsApprox: number | null;
	commentsDisabled: boolean;
	/** Continuation that returns the comments header with the exact count */
	commentsToken: string | null;
	/** get_transcript params, if the video has a transcript panel */
	transcriptParams: string | null;
	/** YYYY-MM-DD from dateText ("Oct 24, 2009") */
	dateText: string | null;
	isLive: boolean;
};

export function parseNext(next: unknown): NextInfo | null {
	if (!isObj(next)) return null;
	const primary = findFirst<AnyObj>(next, "videoPrimaryInfoRenderer");
	const secondary = findFirst<AnyObj>(next, "videoSecondaryInfoRenderer");
	const owner = get<AnyObj>(secondary, "owner", "videoOwnerRenderer");
	if (!primary && !owner) return null;

	const videoId =
		get<string>(next, "currentVideoEndpoint", "watchEndpoint", "videoId") ??
		findFirst<AnyObj>(primary, "updatedMetadataEndpoint")?.videoId ??
		null;

	// Likes: likeCountEntity carries the exact number; the button title is rounded.
	const likeEntity = findFirst<AnyObj>(next, "likeCountEntity");
	let likes: number | null = null;
	let likesExact = false;
	const expanded = textOf(likeEntity?.expandedLikeCountIfIndifferent);
	if (expanded) {
		const c = parseCount(expanded);
		if (c) {
			likes = c.value;
			likesExact = c.exact;
		}
	}
	if (likes == null) {
		// SPA navigations ship a placeholder likeCountEntity; the button's a11y
		// text ("like this video along with 19,514,418 other people") is exact,
		// its title ("19M") is rounded.
		const likeButton = findFirst<AnyObj>(primary, "likeButtonViewModel");
		const a11y = findAll<unknown>(likeButton, "accessibilityText").find(
			(t): t is string => typeof t === "string" && /along with/i.test(t),
		);
		const title = findAll<unknown>(likeButton, "title").find(
			(t): t is string => typeof t === "string",
		);
		const c = parseCount(a11y) ?? parseCount(title);
		if (c) {
			likes = c.value;
			likesExact = c.exact;
		}
	}

	// Comments
	const panels = (next.engagementPanels as AnyObj[] | undefined) ?? [];
	const commentsPanel = panels
		.map((p) => p?.engagementPanelSectionListRenderer)
		.find(
			(p) =>
				p?.panelIdentifier === "engagement-panel-comments-section" ||
				p?.targetId === "engagement-panel-comments-section",
		);
	const commentsApprox =
		parseCount(
			textOf(
				get(
					commentsPanel,
					"header",
					"engagementPanelTitleHeaderRenderer",
					"contextualInfo",
				),
			),
		)?.value ??
		parseCount(
			textOf(
				findFirst<AnyObj>(next, "commentsEntryPointHeaderRenderer")
					?.commentCount,
			),
		)?.value ??
		null;

	const commentSection = findAll<AnyObj>(next, "itemSectionRenderer").find(
		(s) => s?.sectionIdentifier === "comment-item-section",
	);
	const commentsToken =
		findFirst<AnyObj>(commentSection, "continuationCommand")?.token ??
		findFirst<AnyObj>(commentsPanel, "continuationCommand")?.token ??
		null;
	const commentsDisabled =
		!commentsToken &&
		findAll<AnyObj>(commentSection ?? {}, "messageRenderer").some((m) =>
			/turned off|disabled/i.test(textOf(m?.text) ?? ""),
		);

	const transcriptParams =
		findFirst<AnyObj>(next, "getTranscriptEndpoint")?.params ?? null;

	const viewCountRenderer = findFirst<AnyObj>(
		primary,
		"videoViewCountRenderer",
	);
	const viewText =
		textOf(viewCountRenderer?.viewCount) ??
		textOf(viewCountRenderer?.originalViewCount);
	const views =
		toInt(viewCountRenderer?.originalViewCount) ??
		parseCount(viewText)?.value ??
		null;

	const canonical =
		get<string>(
			owner,
			"navigationEndpoint",
			"browseEndpoint",
			"canonicalBaseUrl",
		) ??
		get<string>(
			owner,
			"title",
			"runs",
			0,
			"navigationEndpoint",
			"browseEndpoint",
			"canonicalBaseUrl",
		);

	return {
		videoId: typeof videoId === "string" ? videoId : null,
		title: textOf(primary?.title),
		description:
			textOf(secondary?.attributedDescription) ??
			textOf(secondary?.description),
		channelId:
			get<string>(owner, "navigationEndpoint", "browseEndpoint", "browseId") ??
			get<string>(
				owner,
				"title",
				"runs",
				0,
				"navigationEndpoint",
				"browseEndpoint",
				"browseId",
			) ??
			null,
		channelTitle: textOf(owner?.title),
		channelHandle: handleFromUrl(canonical),
		channelSubscribers:
			parseCount(textOf(owner?.subscriberCountText))?.value ?? null,
		views,
		likes,
		likesExact,
		commentsApprox,
		commentsDisabled,
		commentsToken: typeof commentsToken === "string" ? commentsToken : null,
		transcriptParams:
			typeof transcriptParams === "string" ? transcriptParams : null,
		dateText: parseEnglishDate(textOf(primary?.dateText)),
		isLive: viewCountRenderer?.isLive === true,
	};
}

/** Exact comment count from the comments continuation header ("2,462,429 Comments"). */
export function parseCommentsHeader(
	resp: unknown,
): { value: number; exact: boolean } | null {
	const header = findFirst<AnyObj>(resp, "commentsHeaderRenderer");
	const c =
		parseCount(textOf(header?.countText)) ??
		parseCount(textOf(header?.commentsCount));
	return c ?? null;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function bestThumb(videoId: string, thumbs: Thumbnail[]): string {
	const sorted = [...thumbs].sort(
		(a, b) =>
			(b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
	);
	const url = sorted.find((t) => t.url.includes("i.ytimg.com"))?.url;
	return url ?? thumbnailUrl(videoId, "hqdefault");
}

export function buildVideoDetails(
	videoId: string,
	player: PlayerInfo | null,
	next: NextInfo | null,
	exactComments: { value: number; exact: boolean } | null,
	level: VideoDetailsLevel,
): VideoDetails {
	if (!player && !next) {
		throw new YouTubeError(
			"NOT_FOUND",
			`Video ${videoId} not found or unavailable`,
		);
	}
	const durationSec = player?.durationSec ?? 0;
	const isShort =
		player?.isShortsEligible === true &&
		durationSec > 0 &&
		durationSec <= SHORTS_MAX_SECONDS;
	const comments =
		exactComments ??
		(next?.commentsApprox != null
			? { value: next.commentsApprox, exact: false }
			: null);
	const thumbnails = player?.thumbnails ?? [];
	return {
		videoId,
		title: player?.title || next?.title || "",
		description: player?.description || next?.description || "",
		channelId: player?.channelId || next?.channelId || "",
		channelTitle: player?.channelTitle || next?.channelTitle || "",
		channelHandle: player?.channelHandle ?? next?.channelHandle ?? null,
		views: player?.views ?? next?.views ?? 0,
		likes: player?.likes ?? next?.likes ?? null,
		comments: next?.commentsDisabled ? null : (comments?.value ?? null),
		commentsExact: comments?.exact ?? false,
		publishedAt:
			player?.publishedAt ??
			(next?.dateText ? toIso(`${next.dateText}T00:00:00Z`) : null),
		durationSec,
		isShort,
		isLive: player?.isLive ?? next?.isLive ?? false,
		isLiveContent: player?.isLiveContent ?? false,
		isUpcoming: player?.isUpcoming ?? false,
		isUnlisted: player?.isUnlisted ?? false,
		isPrivate: player?.isPrivate ?? false,
		// Without player data the listing is unknown: treat it as not public.
		isPublic:
			!!player &&
			player.listingKnown &&
			!player.isUnlisted &&
			!player.isPrivate,
		isFamilySafe: player?.isFamilySafe ?? null,
		keywords: player?.keywords ?? [],
		category: player?.category ?? null,
		thumbnails,
		thumbnailUrl: bestThumb(videoId, thumbnails),
		captionTracks: player?.captionTracks ?? [],
		channelSubscribers: next?.channelSubscribers ?? null,
		level,
		fetchedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchPlayer(
	videoId: string,
	signal?: AbortSignal,
): Promise<PlayerInfo | null> {
	const resp = await innertube(
		"player",
		{ videoId, contentCheckOk: true, racyCheckOk: true },
		{ signal },
	);
	return parsePlayer(resp);
}

export async function fetchNext(
	videoId: string,
	signal?: AbortSignal,
): Promise<NextInfo | null> {
	return parseNext(await innertube("next", { videoId }, { signal }));
}

export async function fetchExactComments(
	token: string,
	signal?: AbortSignal,
): Promise<{ value: number; exact: boolean } | null> {
	return parseCommentsHeader(
		await innertube("next", { continuation: token }, { signal }),
	);
}

export type VideoSeed = {
	/** Parsed from the page's ytInitialPlayerResponse / movie_player */
	player?: PlayerInfo | null;
	/** Parsed from the page's ytInitialData (only when the page UI is English) */
	next?: NextInfo | null;
};

export type GetVideoDetailsOptions = {
	/** "full" (default): + likes/comments/owner via `next`; "basic": player only (1 request) */
	level?: VideoDetailsLevel;
	/** Already-loaded page data to reuse instead of fetching */
	seed?: VideoSeed;
	/** Bypass the cache */
	force?: boolean;
	signal?: AbortSignal;
};

const videoKey = (level: VideoDetailsLevel, id: string) =>
	`video:${level}:${id}`;

/**
 * Exact views, likes, publish time, tags, category… for one video.
 * Cached 10 minutes. A cached "full" result also satisfies "basic" requests.
 */
export async function getVideoDetails(
	videoId: string,
	opts: GetVideoDetailsOptions = {},
): Promise<VideoDetails> {
	if (!isVideoId(videoId))
		throw new YouTubeError("NOT_FOUND", `Invalid video id: ${videoId}`);
	const level = opts.level ?? "full";
	if (level === "basic" && !opts.force) {
		const full = await cacheGet<VideoDetails>(videoKey("full", videoId));
		if (full) return full;
	}
	return cached(
		videoKey(level, videoId),
		TTL.videoDetails,
		async () => {
			// A seed missing the essentials (e.g. a SPA player response without
			// microformat) is ignored rather than producing worse data.
			const sp = opts.seed?.player;
			const seedPlayer =
				sp?.videoId === videoId &&
				sp.publishedAt &&
				sp.views != null &&
				sp.channelId
					? sp
					: null;
			const seedNext =
				opts.seed?.next?.videoId === videoId ? opts.seed.next : null;
			const [player, next] = await Promise.all([
				seedPlayer
					? Promise.resolve(seedPlayer)
					: fetchPlayer(videoId, opts.signal),
				level === "full"
					? seedNext
						? Promise.resolve(seedNext)
						: fetchNext(videoId, opts.signal).catch(() => null)
					: Promise.resolve(null),
			]);
			let exact: { value: number; exact: boolean } | null = null;
			if (level === "full" && next?.commentsToken && !next.commentsDisabled) {
				exact = await fetchExactComments(next.commentsToken, opts.signal).catch(
					() => null,
				);
			}
			if (!player && !next) {
				throw new YouTubeError("NOT_FOUND", `Video ${videoId} is unavailable`);
			}
			return buildVideoDetails(videoId, player, next, exact, level);
		},
		{ force: opts.force },
	);
}

/**
 * Many videos at once (e.g. feed badges). Uses "basic" level by default;
 * failed ids map to null. Requests are throttled by the shared limiter.
 */
export async function getVideoDetailsBatch(
	videoIds: string[],
	opts: { level?: VideoDetailsLevel } = {},
): Promise<Record<string, VideoDetails | null>> {
	const ids = [...new Set(videoIds.filter(isVideoId))];
	const settled = await Promise.allSettled(
		ids.map((id) => getVideoDetails(id, { level: opts.level ?? "basic" })),
	);
	const out: Record<string, VideoDetails | null> = {};
	ids.forEach((id, i) => {
		const r = settled[i];
		out[id] = r?.status === "fulfilled" ? r.value : null;
	});
	return out;
}
