/** YouTube search via InnerTube, plus rank lookup for tag/keyword badges. */
import { isChannelId } from "@growtube/shared/youtube";

import { cached, TTL } from "../cache";
import { innertube, loadInnertubeConfig } from "./innertube";
import {
	channelIdFromParams,
	cleanThumbnail,
	handleFromUrl,
	parseAgo,
	parseClock,
	parseCount,
	parseSpokenDuration,
	toInt,
} from "./parse";
import type {
	SearchResponse,
	SearchResult,
	SearchSort,
	SearchType,
} from "./types";
import {
	type AnyObj,
	a11yOf,
	bestImage,
	findAll,
	findAllEntries,
	findContinuationTokens,
	findFirst,
	get,
	textOf,
} from "./walk";

// ---------------------------------------------------------------------------
// Search filter params (protobuf: 1 = sort, 2 = { 2 = type })
// ---------------------------------------------------------------------------

const SORT_CODE: Record<SearchSort, number | null> = {
	relevance: null,
	date: 2,
	views: 3,
};
const TYPE_CODE: Record<SearchType, number | null> = {
	all: null,
	video: 1,
	short: 9,
};

export function buildSearchParams(
	type: SearchType,
	sort: SearchSort,
): string | undefined {
	const bytes: number[] = [];
	const sortCode = SORT_CODE[sort];
	const typeCode = TYPE_CODE[type];
	if (sortCode != null) bytes.push(0x08, sortCode);
	if (typeCode != null) bytes.push(0x12, 0x02, 0x10, typeCode);
	if (!bytes.length) return undefined;
	return btoa(String.fromCharCode(...bytes));
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type ResultItem = Omit<SearchResult, "position">;

function ownerOf(v: AnyObj) {
	const run =
		get<AnyObj>(v, "ownerText", "runs", 0) ??
		get<AnyObj>(v, "longBylineText", "runs", 0);
	const be = get<AnyObj>(run, "navigationEndpoint", "browseEndpoint");
	return {
		channelId: isChannelId(be?.browseId) ? (be?.browseId as string) : null,
		channelTitle: textOf(run) ?? null,
		channelHandle: handleFromUrl(be?.canonicalBaseUrl),
	};
}

function fromVideoRenderer(v: AnyObj, now: number): ResultItem | null {
	if (typeof v.videoId !== "string") return null;
	const isShort =
		Boolean(get(v, "navigationEndpoint", "reelWatchEndpoint")) ||
		/^\/shorts\//.test(
			get<string>(
				v,
				"navigationEndpoint",
				"commandMetadata",
				"webCommandMetadata",
				"url",
			) ?? "",
		) ||
		findAll<AnyObj>(
			v.thumbnailOverlays,
			"thumbnailOverlayTimeStatusRenderer",
		).some((o) => o?.style === "SHORTS");
	const viewText = textOf(v.viewCountText);
	const views =
		parseCount(viewText) ?? parseCount(textOf(v.shortViewCountText));
	const isLive =
		/watching/i.test(viewText ?? "") ||
		findAll<AnyObj>(v.badges, "metadataBadgeRenderer").some(
			(b) => b?.style === "BADGE_STYLE_TYPE_LIVE_NOW",
		);
	const publishedText = textOf(v.publishedTimeText);
	const published = parseAgo(publishedText, now);
	return {
		videoId: v.videoId,
		title: textOf(v.title) ?? "",
		...ownerOf(v),
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: published?.toISOString() ?? null,
		publishedApprox: true,
		publishedText,
		durationSec:
			parseClock(textOf(v.lengthText)) ??
			parseSpokenDuration(a11yOf(v.lengthText)),
		isShort,
		isLive,
		thumbnail: cleanThumbnail(bestImage(v.thumbnail), v.videoId),
		source: "video",
	};
}

function fromLockup(l: AnyObj, now: number): ResultItem | null {
	if (l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") return null;
	const videoId = typeof l.contentId === "string" ? l.contentId : null;
	if (!videoId) return null;
	const meta = get<AnyObj>(l, "metadata", "lockupMetadataViewModel");
	const rows = (get<AnyObj[]>(
		meta,
		"metadata",
		"contentMetadataViewModel",
		"metadataRows",
	) ?? []) as AnyObj[];
	let channelTitle: string | null = null;
	let channelId: string | null = null;
	let channelHandle: string | null = null;
	let views: { value: number; exact: boolean } | null = null;
	let publishedText: string | null = null;
	let isLive = false;
	for (const row of rows) {
		for (const part of (row?.metadataParts as AnyObj[] | undefined) ?? []) {
			const text = textOf(part?.text) ?? "";
			const label = a11yOf(part) ?? text;
			const be = findFirst<AnyObj>(part, "browseEndpoint");
			if (be && isChannelId(be.browseId)) {
				channelId = be.browseId;
				channelTitle = text;
				channelHandle = handleFromUrl(be.canonicalBaseUrl);
			} else if (/ago\b/i.test(label)) publishedText = label;
			else if (/watching/i.test(label)) {
				isLive = true;
				views = parseCount(text);
			} else if (/\bviews?\b/i.test(label))
				views = parseCount(text) ?? parseCount(label);
			else if (!channelTitle && rows.indexOf(row) === 0)
				channelTitle = text || null;
		}
	}
	const badge = findFirst<AnyObj>(l.contentImage, "thumbnailBadgeViewModel");
	const badgeText = textOf(badge?.text) ?? "";
	if (/live/i.test(badgeText)) isLive = true;
	const avatarBe = findFirst<AnyObj>(get(meta, "image"), "browseEndpoint");
	if (!channelId && avatarBe && isChannelId(avatarBe.browseId)) {
		channelId = avatarBe.browseId;
		channelHandle ??= handleFromUrl(avatarBe.canonicalBaseUrl);
	}
	return {
		videoId,
		title: textOf(meta?.title) ?? "",
		channelId,
		channelTitle,
		channelHandle,
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: parseAgo(publishedText, now)?.toISOString() ?? null,
		publishedApprox: true,
		publishedText,
		durationSec: parseClock(badgeText),
		isShort: false,
		isLive,
		thumbnail: cleanThumbnail(
			bestImage(findFirst<AnyObj>(l.contentImage, "image")),
			videoId,
		),
		source: "lockup",
	};
}

function fromShortsLockup(s: AnyObj): ResultItem | null {
	const reel = get<AnyObj>(s, "onTap", "innertubeCommand", "reelWatchEndpoint");
	const videoId =
		(reel?.videoId as string | undefined) ??
		(typeof s.entityId === "string"
			? s.entityId.replace(/^shorts-shelf-item-/, "")
			: undefined);
	if (typeof videoId !== "string" || videoId.length !== 11) return null;
	const views =
		parseCount(textOf(get(s, "overlayMetadata", "secondaryText"))) ??
		parseCount(
			String(s.accessibilityText ?? "")
				.split(",")
				.pop(),
		);
	return {
		videoId,
		title: textOf(get(s, "overlayMetadata", "primaryText")) ?? "",
		channelId: channelIdFromParams(reel?.params),
		channelTitle: null,
		channelHandle: null,
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: null,
		publishedApprox: true,
		publishedText: null,
		durationSec: null,
		isShort: true,
		isLive: false,
		thumbnail: cleanThumbnail(
			bestImage(findFirst<AnyObj>(s.thumbnailViewModel, "image")),
			videoId,
		),
		source: "short",
	};
}

function fromReelItem(r: AnyObj): ResultItem | null {
	if (typeof r.videoId !== "string") return null;
	const views = parseCount(textOf(r.viewCountText));
	return {
		videoId: r.videoId,
		title: textOf(r.headline) ?? "",
		channelId: channelIdFromParams(
			get(r, "navigationEndpoint", "reelWatchEndpoint", "params"),
		),
		channelTitle: null,
		channelHandle: null,
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: null,
		publishedApprox: true,
		publishedText: null,
		durationSec: null,
		isShort: true,
		isLive: false,
		thumbnail: cleanThumbnail(bestImage(r.thumbnail), r.videoId),
		source: "short",
	};
}

/** Parses every video-like result in page order (ads/playlists/channels skipped). */
export function parseSearchResults(
	resp: unknown,
	now: number = Date.now(),
): ResultItem[] {
	const entries = findAllEntries(resp, [
		"videoRenderer",
		"lockupViewModel",
		"shortsLockupViewModel",
		"reelItemRenderer",
	]);
	const out: ResultItem[] = [];
	for (const { key, value } of entries) {
		const r =
			key === "videoRenderer"
				? fromVideoRenderer(value, now)
				: key === "lockupViewModel"
					? fromLockup(value, now)
					: key === "shortsLockupViewModel"
						? fromShortsLockup(value)
						: fromReelItem(value);
		if (r) out.push(r);
	}
	return out;
}

function correctedQueryOf(resp: unknown): string | null {
	const r = findFirst<AnyObj>(resp, "showingResultsForRenderer");
	return textOf(r?.correctedQuery) ?? null;
}

export type SearchOptions = {
	/** Max results (default 20, max 100) */
	limit?: number;
	type?: SearchType;
	sort?: SearchSort;
	force?: boolean;
	signal?: AbortSignal;
};

/** YouTube search results, newest renderer shapes included. Cached 30 min. */
export async function search(
	query: string,
	opts: SearchOptions = {},
): Promise<SearchResponse> {
	const q = query.trim();
	const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
	const type = opts.type ?? "all";
	const sort = opts.sort ?? "relevance";
	if (!q)
		return { query: q, estimatedResults: 0, results: [], correctedQuery: null };
	// Results (and so ranks) depend on the region the request is made for.
	const { gl } = await loadInnertubeConfig();
	return cached(
		`search:${gl || "US"}:${type}:${sort}:${limit}:${q.toLowerCase()}`,
		TTL.search,
		async () => {
			const params = buildSearchParams(type, sort);
			const now = Date.now();
			const first = await innertube(
				"search",
				{ query: q, ...(params ? { params } : {}) },
				{ signal: opts.signal },
			);
			const results: SearchResult[] = [];
			const seen = new Set<string>();
			const push = (items: ResultItem[]) => {
				for (const item of items) {
					if (seen.has(item.videoId)) continue;
					if (type === "short" && !item.isShort) continue;
					seen.add(item.videoId);
					results.push({ ...item, position: results.length + 1 });
				}
			};
			push(parseSearchResults(first, now));
			let token = findContinuationTokens(first).at(-1) ?? null;
			for (let page = 0; results.length < limit && token && page < 5; page++) {
				const more = await innertube(
					"search",
					{ continuation: token },
					{ signal: opts.signal },
				);
				const before = results.length;
				push(parseSearchResults(more, now));
				token = findContinuationTokens(more).at(-1) ?? null;
				if (results.length === before) break;
			}
			return {
				query: q,
				estimatedResults: toInt((first as AnyObj).estimatedResults),
				results: results.slice(0, limit),
				correctedQuery: correctedQueryOf(first),
			};
		},
		{ force: opts.force },
	);
}

/**
 * 1-based position of `videoId` in the results for `query`, or null when it
 * isn't in the first `depth` results (default 40, clamped to 10–100).
 */
export async function findVideoRank(
	query: string,
	videoId: string,
	depth = 40,
	opts: { signal?: AbortSignal } = {},
): Promise<number | null> {
	const limit = Math.max(10, Math.min(depth, 100));
	const res = await search(query, { limit, signal: opts.signal });
	return res.results.find((r) => r.videoId === videoId)?.position ?? null;
}
