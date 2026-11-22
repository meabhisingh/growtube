/** Channel info, uploads and performance baselines via InnerTube `browse`. */
import { computeChannelBaseline, hoursSince } from "@growtube/shared/metrics";
import { isChannelId } from "@growtube/shared/youtube";

import { cached, cacheSet, hashKey, TTL } from "../cache";
import { innertube, YouTubeError } from "./innertube";
import {
	cleanThumbnail,
	handleFromUrl,
	normalizeHandle,
	parseAgo,
	parseClock,
	parseCount,
	parseEnglishDate,
	parseKeywordString,
	parseSpokenDuration,
} from "./parse";
import type {
	ChannelBaseline,
	ChannelInfo,
	ChannelRef,
	ChannelTab,
	ChannelVideo,
	ChannelVideosPage,
} from "./types";
import { getVideoDetails } from "./video";
import {
	type AnyObj,
	a11yOf,
	bestImage,
	findAll,
	findAllEntries,
	findContinuationTokens,
	findFirst,
	get,
	isObj,
	textOf,
} from "./walk";

/** browse `params` for channel tabs (fallbacks; the live tab list wins). */
const TAB_PARAMS: Record<ChannelTab, string> = {
	videos: "EgZ2aWRlb3PyBgQKAjoA",
	shorts: "EgZzaG9ydHPyBgUKA5oBAA%3D%3D",
	streams: "EgdzdHJlYW1z8gYECgJ6AA%3D%3D",
};

// ---------------------------------------------------------------------------
// Handle resolution
// ---------------------------------------------------------------------------

/** "@carandbike" -> "UCGRIgtqal_cC7V_cD-Zylkg" (cached 6h). */
export async function resolveHandle(handle: string): Promise<string> {
	const h = normalizeHandle(handle);
	return cached(`handle:${h.toLowerCase()}`, TTL.channel, async () => {
		const resp = await innertube("navigation/resolve_url", {
			url: `https://www.youtube.com/${encodeURIComponent(h).replace(/%40/g, "@")}`,
		});
		const id =
			get<string>(resp, "endpoint", "browseEndpoint", "browseId") ??
			findFirst<AnyObj>(resp, "browseEndpoint")?.browseId;
		if (!isChannelId(id))
			throw new YouTubeError("NOT_FOUND", `Channel ${h} not found`);
		return id;
	});
}

export async function resolveChannelId(ref: ChannelRef): Promise<string> {
	if ("channelId" in ref) {
		if (!isChannelId(ref.channelId)) {
			throw new YouTubeError(
				"NOT_FOUND",
				`Invalid channel id: ${ref.channelId}`,
			);
		}
		return ref.channelId;
	}
	return resolveHandle(ref.handle);
}

// ---------------------------------------------------------------------------
// Channel header + About
// ---------------------------------------------------------------------------

type HeaderInfo = Omit<
	ChannelInfo,
	"fetchedAt" | "links" | "totalViews" | "joinedAt" | "country"
> & {
	aboutToken: string | null;
};

export function parseChannelHeader(
	resp: unknown,
	channelId: string,
): HeaderInfo {
	const meta = get<AnyObj>(resp, "metadata", "channelMetadataRenderer") ?? {};
	const pageHeader = findFirst<AnyObj>(
		get(resp, "header"),
		"pageHeaderViewModel",
	);
	const legacy = findFirst<AnyObj>(
		get(resp, "header"),
		"c4TabbedHeaderRenderer",
	);

	let handle: string | null = handleFromUrl(meta.vanityChannelUrl) ?? null;
	let subscribers: number | null = null;
	let videoCount: number | null = null;
	for (const part of findAll<AnyObj>(
		pageHeader?.metadata,
		"metadataParts",
	).flat()) {
		const text = textOf(part?.text) ?? "";
		if (!handle && text.startsWith("@")) handle = text.trim();
		if (/subscriber/i.test(text)) subscribers = parseCount(text)?.value ?? null;
		if (/\bvideos?\b/i.test(text)) videoCount = parseCount(text)?.value ?? null;
	}
	if (legacy) {
		handle ??= textOf(legacy.channelHandleText);
		subscribers ??=
			parseCount(textOf(legacy.subscriberCountText))?.value ?? null;
		videoCount ??= parseCount(textOf(legacy.videosCountText))?.value ?? null;
	}

	const titleNode = pageHeader?.title;
	const isVerified =
		/CHECK_CIRCLE|BADGE_STYLE_TYPE_VERIFIED/.test(
			JSON.stringify(titleNode ?? legacy?.badges ?? ""),
		) || false;

	const aboutToken =
		findFirst<AnyObj>(pageHeader?.description, "continuationCommand")?.token ??
		findFirst<AnyObj>(get(resp, "header"), "continuationCommand")?.token ??
		null;

	return {
		channelId: (isChannelId(meta.externalId)
			? meta.externalId
			: channelId) as string,
		handle: handle && handle.length > 1 ? handle : null,
		title: String(
			meta.title ?? textOf(titleNode) ?? textOf(legacy?.title) ?? "",
		),
		avatarUrl:
			bestImage(meta.avatar) ??
			bestImage(findFirst<AnyObj>(pageHeader?.image, "image")) ??
			bestImage(legacy?.avatar),
		bannerUrl:
			bestImage(findFirst<AnyObj>(pageHeader?.banner, "image")) ??
			bestImage(legacy?.banner),
		subscribers,
		videoCount,
		keywords: parseKeywordString(meta.keywords),
		description: typeof meta.description === "string" ? meta.description : "",
		isVerified,
		aboutToken: typeof aboutToken === "string" ? aboutToken : null,
	};
}

export type AboutInfo = {
	description: string | null;
	country: string | null;
	subscribers: number | null;
	totalViews: number | null;
	videoCount: number | null;
	joinedAt: string | null;
	handle: string | null;
	links: { title: string; url: string }[];
};

export function parseAbout(resp: unknown): AboutInfo | null {
	const vm = findFirst<AnyObj>(resp, "aboutChannelViewModel");
	if (!vm) return null;
	const links = findAll<AnyObj>(vm.links, "channelExternalLinkViewModel")
		.map((l) => {
			const raw = textOf(l?.link) ?? "";
			return {
				title: textOf(l?.title) ?? raw,
				url: raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw,
			};
		})
		.filter((l) => l.url);
	return {
		description: typeof vm.description === "string" ? vm.description : null,
		country: typeof vm.country === "string" ? vm.country : null,
		subscribers: parseCount(textOf(vm.subscriberCountText))?.value ?? null,
		totalViews: parseCount(textOf(vm.viewCountText))?.value ?? null,
		videoCount: parseCount(textOf(vm.videoCountText))?.value ?? null,
		joinedAt: parseEnglishDate(textOf(vm.joinedDateText)),
		handle: handleFromUrl(
			vm.canonicalChannelUrl ?? vm.displayCanonicalChannelUrl,
		),
		links,
	};
}

/** Tab params as advertised by the channel itself. */
function tabParamsFrom(resp: unknown): Partial<Record<ChannelTab, string>> {
	const out: Partial<Record<ChannelTab, string>> = {};
	for (const tab of findAll<AnyObj>(resp, "tabRenderer")) {
		const url =
			get<string>(
				tab,
				"endpoint",
				"commandMetadata",
				"webCommandMetadata",
				"url",
			) ?? "";
		const params = get<string>(tab, "endpoint", "browseEndpoint", "params");
		if (!params) continue;
		const name = url.split("/").pop();
		if (name === "videos" || name === "shorts" || name === "streams")
			out[name] = params;
	}
	return out;
}

const tabParamsCache = new Map<string, Partial<Record<ChannelTab, string>>>();

async function browseTab(
	channelId: string,
	tab: ChannelTab,
	signal?: AbortSignal,
) {
	const params = tabParamsCache.get(channelId)?.[tab] ?? TAB_PARAMS[tab];
	const resp = await innertube(
		"browse",
		{ browseId: channelId, params },
		{ signal },
	);
	const learned = tabParamsFrom(resp);
	if (Object.keys(learned).length) tabParamsCache.set(channelId, learned);
	return resp;
}

/** The tab YouTube actually rendered (it falls back to Home for missing tabs). */
function selectedTabName(resp: unknown): string | null {
	const tab = findAll<AnyObj>(resp, "tabRenderer").find((t) => t?.selected);
	const url =
		get<string>(
			tab,
			"endpoint",
			"commandMetadata",
			"webCommandMetadata",
			"url",
		) ?? "";
	return url.split("/").pop() ?? null;
}

/**
 * Channel profile: subscribers, exact total views & video count, join date,
 * country, keywords… Accepts `{ channelId }` or `{ handle }`. Cached 6h.
 */
export async function getChannel(
	ref: ChannelRef,
	opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<ChannelInfo> {
	const channelId = await resolveChannelId(ref);
	return cached(
		`channel:${channelId}`,
		TTL.channel,
		async () => {
			// The Videos tab carries the same header/metadata as Home but is ~3x
			// smaller, and its first page seeds the uploads cache.
			const resp = await browseTab(channelId, "videos", opts.signal);
			if (
				!get(resp, "metadata", "channelMetadataRenderer") &&
				!get(resp, "header")
			) {
				throw new YouTubeError("NOT_FOUND", `Channel ${channelId} not found`);
			}
			const header = parseChannelHeader(resp, channelId);
			if (selectedTabName(resp) === "videos") {
				const page = parseChannelVideosPage(resp, channelId, "videos");
				await cacheSet(
					`chvids-page:${channelId}:videos:first`,
					page,
					TTL.channelVideos,
				);
			}
			let about: AboutInfo | null = null;
			if (header.aboutToken) {
				about = await innertube(
					"browse",
					{ continuation: header.aboutToken },
					{ signal: opts.signal },
				)
					.then(parseAbout)
					.catch(() => null);
			}
			const info: ChannelInfo = {
				channelId: header.channelId,
				handle: about?.handle ?? header.handle,
				title: header.title,
				avatarUrl: header.avatarUrl,
				bannerUrl: header.bannerUrl,
				subscribers: header.subscribers ?? about?.subscribers ?? null,
				totalViews: about?.totalViews ?? null,
				videoCount: about?.videoCount ?? header.videoCount,
				joinedAt: about?.joinedAt ?? null,
				country: about?.country ?? null,
				keywords: header.keywords,
				description: about?.description || header.description,
				isVerified: header.isVerified,
				links: about?.links ?? [],
				fetchedAt: new Date().toISOString(),
			};
			return info;
		},
		{ force: opts.force },
	);
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

function lockupToVideo(
	l: AnyObj,
	tab: ChannelTab,
	now: number,
): ChannelVideo | null {
	if (l.contentType && l.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO")
		return null;
	const videoId =
		(typeof l.contentId === "string" ? l.contentId : null) ??
		findFirst<AnyObj>(l, "watchEndpoint")?.videoId;
	if (typeof videoId !== "string") return null;
	const meta = get<AnyObj>(l, "metadata", "lockupMetadataViewModel");
	const parts = findAll<AnyObj>(meta?.metadata, "metadataParts").flat();
	let views: { value: number; exact: boolean } | null = null;
	let publishedText: string | null = null;
	let publishedAt: Date | null = null;
	let isLive = false;
	let isUpcoming = false;
	for (const p of parts) {
		const text = textOf(p?.text) ?? "";
		const label = a11yOf(p) ?? text;
		if (/ago\b/i.test(label)) {
			publishedText = label;
			publishedAt = parseAgo(label, now);
		} else if (/\bwatching\b/i.test(label)) {
			isLive = true;
			views = parseCount(text) ?? parseCount(label);
		} else if (/scheduled|premieres|waiting/i.test(label)) {
			isUpcoming = true;
		} else if (
			/\bviews?\b/i.test(label) ||
			/^\d[\d.,]*\s*[kmb]?$/i.test(text.trim())
		) {
			// Prefer the compact text ("6.3K") — the a11y label rounds to words.
			views = parseCount(text) ?? parseCount(label);
		}
	}
	const badge = findFirst<AnyObj>(l.contentImage, "thumbnailBadgeViewModel");
	const badgeText = textOf(badge?.text) ?? "";
	const durationSec =
		parseClock(badgeText) ??
		parseSpokenDuration(
			a11yOf(get(badge, "rendererContext", "accessibilityContext")),
		);
	if (
		/live/i.test(badgeText) ||
		badge?.badgeStyle === "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE"
	)
		isLive = true;
	if (/upcoming/i.test(badgeText)) isUpcoming = true;
	return {
		videoId,
		title: textOf(meta?.title) ?? "",
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: publishedAt?.toISOString() ?? null,
		publishedApprox: true,
		publishedText,
		durationSec,
		isShort: tab === "shorts",
		isLive,
		isUpcoming,
		thumbnail: cleanThumbnail(
			bestImage(findFirst<AnyObj>(l.contentImage, "image")),
			videoId,
		),
	};
}

function shortsLockupToVideo(s: AnyObj): ChannelVideo | null {
	const videoId =
		get<string>(
			s,
			"onTap",
			"innertubeCommand",
			"reelWatchEndpoint",
			"videoId",
		) ??
		(typeof s.entityId === "string"
			? s.entityId.replace(/^shorts-shelf-item-/, "")
			: null);
	if (typeof videoId !== "string" || videoId.length !== 11) return null;
	const viewsText = textOf(get(s, "overlayMetadata", "secondaryText"));
	const views =
		parseCount(viewsText) ??
		parseCount(
			(typeof s.accessibilityText === "string" ? s.accessibilityText : "")
				.split(",")
				.pop(),
		);
	return {
		videoId,
		title: textOf(get(s, "overlayMetadata", "primaryText")) ?? "",
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: null,
		publishedApprox: true,
		publishedText: null,
		durationSec: null,
		isShort: true,
		isLive: false,
		isUpcoming: false,
		thumbnail: cleanThumbnail(
			bestImage(findFirst<AnyObj>(s.thumbnailViewModel, "image")),
			videoId,
		),
	};
}

/** Legacy renderers still served in some experiments. */
function legacyToVideo(
	key: string,
	v: AnyObj,
	tab: ChannelTab,
	now: number,
): ChannelVideo | null {
	const videoId = v.videoId;
	if (typeof videoId !== "string") return null;
	const isReel = key === "reelItemRenderer";
	const viewText = textOf(v.viewCountText) ?? textOf(v.shortViewCountText);
	const views = parseCount(viewText);
	const publishedText = textOf(v.publishedTimeText);
	const durationSec = parseClock(textOf(v.lengthText));
	return {
		videoId,
		title: textOf(v.title) ?? textOf(v.headline) ?? "",
		views: views?.value ?? null,
		viewsExact: views?.exact ?? false,
		publishedAt: parseAgo(publishedText, now)?.toISOString() ?? null,
		publishedApprox: true,
		publishedText,
		durationSec,
		isShort: isReel || tab === "shorts",
		isLive: /watching/i.test(viewText ?? ""),
		isUpcoming: Boolean(v.upcomingEventData),
		thumbnail: cleanThumbnail(bestImage(v.thumbnail), videoId),
	};
}

export function parseChannelVideosPage(
	resp: unknown,
	channelId: string,
	tab: ChannelTab,
	now: number = Date.now(),
): ChannelVideosPage {
	const entries = findAllEntries(resp, [
		"lockupViewModel",
		"shortsLockupViewModel",
		"videoRenderer",
		"gridVideoRenderer",
		"reelItemRenderer",
	]);
	const seen = new Set<string>();
	const videos: ChannelVideo[] = [];
	for (const { key, value } of entries) {
		const v =
			key === "lockupViewModel"
				? lockupToVideo(value, tab, now)
				: key === "shortsLockupViewModel"
					? shortsLockupToVideo(value)
					: legacyToVideo(key, value, tab, now);
		if (v && !seen.has(v.videoId)) {
			seen.add(v.videoId);
			videos.push(v);
		}
	}
	const tokens = findContinuationTokens(resp);
	return { channelId, tab, videos, continuation: tokens.at(-1) ?? null };
}

/**
 * One page (~30 items) of a channel tab. Pass `continuation` from the
 * previous page to get the next one.
 */
export async function getChannelVideosPage(
	channelId: string,
	opts: {
		tab?: ChannelTab;
		continuation?: string | null;
		signal?: AbortSignal;
	} = {},
): Promise<ChannelVideosPage> {
	const tab = opts.tab ?? "videos";
	if (!isChannelId(channelId))
		throw new YouTubeError("NOT_FOUND", `Invalid channel id: ${channelId}`);
	const key = `chvids-page:${channelId}:${tab}:${opts.continuation ? hashKey(opts.continuation) : "first"}`;
	return cached(key, TTL.channelVideos, async () => {
		if (opts.continuation) {
			const resp = await innertube(
				"browse",
				{ continuation: opts.continuation },
				{ signal: opts.signal },
			);
			return parseChannelVideosPage(resp, channelId, tab);
		}
		const resp = await browseTab(channelId, tab, opts.signal);
		const selected = selectedTabName(resp);
		if (selected && selected !== tab) {
			// Channel has no such tab (YouTube fell back to Home).
			return { channelId, tab, videos: [], continuation: null };
		}
		return parseChannelVideosPage(resp, channelId, tab);
	});
}

/**
 * Recent uploads of a channel tab, newest first, paging until `limit`.
 * `publishedAt` is approximate (from "3 days ago"), and null for Shorts.
 */
export async function getChannelVideos(
	channelId: string,
	opts: { tab?: ChannelTab; limit?: number; signal?: AbortSignal } = {},
): Promise<ChannelVideo[]> {
	const tab = opts.tab ?? "videos";
	const limit = Math.max(1, Math.min(opts.limit ?? 30, 300));
	const out: ChannelVideo[] = [];
	const seen = new Set<string>();
	let continuation: string | null = null;
	for (let page = 0; page < Math.ceil(limit / 20) + 2; page++) {
		const res: ChannelVideosPage = await getChannelVideosPage(channelId, {
			tab,
			continuation,
			signal: opts.signal,
		});
		for (const v of res.videos) {
			if (seen.has(v.videoId)) continue;
			seen.add(v.videoId);
			out.push(v);
		}
		continuation = res.continuation;
		if (out.length >= limit || !continuation || res.videos.length === 0) break;
	}
	return out.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

const BASELINE_SAMPLE = 30;
const MIN_AGE_HOURS = 24;

/**
 * Median views of the channel's ~30 most recent uploads of one format,
 * excluding uploads younger than 24h (they haven't settled yet), live and
 * upcoming streams. Cached 6h. Use with computeOutlierScore().
 */
export async function getChannelBaseline(
	channelId: string,
	format: "long" | "short" = "long",
	opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<ChannelBaseline> {
	return cached(
		`baseline:${channelId}:${format}`,
		TTL.baseline,
		async () => {
			const tab: ChannelTab = format === "short" ? "shorts" : "videos";
			const videos = await getChannelVideos(channelId, {
				tab,
				limit: BASELINE_SAMPLE + 8,
				signal: opts.signal,
			});
			let candidates = videos.filter(
				(v) => !v.isLive && !v.isUpcoming && v.views != null,
			);
			if (format === "long") {
				candidates = candidates.filter(
					(v) =>
						v.publishedAt == null || hoursSince(v.publishedAt) >= MIN_AGE_HOURS,
				);
			} else {
				// Shorts tabs carry no dates: check the newest few until one is old enough
				// (the list is newest-first, so everything after it is older).
				let skip = 0;
				for (const v of candidates.slice(0, 5)) {
					const d = await getVideoDetails(v.videoId, {
						level: "basic",
						signal: opts.signal,
					}).catch(() => null);
					if (d?.publishedAt && hoursSince(d.publishedAt) < MIN_AGE_HOURS)
						skip++;
					else break;
				}
				candidates = candidates.slice(skip);
			}
			const sample = candidates.slice(0, BASELINE_SAMPLE);
			return {
				channelId,
				format,
				baseline: computeChannelBaseline(sample.map((v) => v.views ?? 0)),
				sampleSize: sample.length,
				computedAt: new Date().toISOString(),
			} satisfies ChannelBaseline;
		},
		{ force: opts.force },
	);
}

export function isChannelInfo(value: unknown): value is ChannelInfo {
	return (
		isObj(value) &&
		typeof value.channelId === "string" &&
		typeof value.title === "string"
	);
}
