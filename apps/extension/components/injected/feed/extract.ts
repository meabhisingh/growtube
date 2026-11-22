/**
 * Reads what a feed card already shows (video id, approximate views and age,
 * channel link) without any network request. Pure DOM reads, no writes.
 */
import {
	extractChannelRef,
	extractVideoId,
	isShortsUrl,
} from "@growtube/shared/youtube";

import { parseAgo, parseCount } from "@/lib/youtube/parse";
import type { ChannelRef } from "@/lib/youtube/types";

import {
	AD_CONTAINER,
	CARD_LINK_SELECTOR,
	CARD_SELECTOR,
	CHANNEL_LINK_SELECTOR,
	LEGACY_METADATA_LINE,
	LOCKUP_COLLECTION,
	LOCKUP_METADATA,
	SHORTS_LOCKUP_SUBHEAD,
	THUMBNAIL_BADGE,
} from "../selectors";

export type CardKind = "video" | "short" | "playlist";

export type CardInfo = {
	/** Stable identity of what the card shows (video id or playlist id) */
	key: string;
	kind: CardKind;
	videoId: string | null;
	/** From the card text (rounded, e.g. "7.9K"); null when unknown */
	views: number | null;
	/** Approximate publish time (ms epoch) from "3h ago"; null when unknown */
	publishedAt: number | null;
	isLive: boolean;
	isUpcoming: boolean;
	/** From a channel link on the card, or the channel page being viewed */
	channelRef: ChannelRef | null;
	/** "86 videos" / "Mix" for playlists */
	playlistSize: string | null;
};

const LIVE_RE = /\b(watching|live now)\b/i;
const UPCOMING_RE = /\b(scheduled for|premieres?|waiting|upcoming)\b/i;
const VIEWS_RE = /\bviews?\b/i;
const BARE_COUNT_RE = /^\d[\d.,]*\s*[KMB]?$/i;
const SEPARATOR_RE = /\s*[·•]\s*/;
const PLAYLIST_SIZE_RE = /^\d[\d,]*\s+(videos?|episodes?|lessons?)$/i;

/** YouTube's UI language; card text is only parsed when it is English. */
function uiIsEnglish(): boolean {
	return (document.documentElement.lang || "en").toLowerCase().startsWith("en");
}

/** The outermost matching card (ignores renderers nested inside another card). */
export function isTopLevelCard(el: Element): boolean {
	return !el.parentElement?.closest(CARD_SELECTOR);
}

/** Playlist id, or for mixes linked as a plain watch URL, "mix-<videoId>". */
function collectionIdFrom(href: string): string | null {
	try {
		const list = new URL(href, location.origin).searchParams.get("list");
		if (list) return list;
	} catch {
		return null;
	}
	const videoId = extractVideoId(href);
	return videoId ? `mix-${videoId}` : null;
}

function primaryHref(card: Element): string | null {
	const tag = card.tagName.toLowerCase();
	if (tag === "ytd-video-renderer" || tag === "ytd-compact-video-renderer") {
		const a =
			card.querySelector<HTMLAnchorElement>("a#thumbnail[href]") ??
			card.querySelector<HTMLAnchorElement>("a#video-title[href]");
		if (a) return a.getAttribute("href");
	}
	return (
		card
			.querySelector<HTMLAnchorElement>(CARD_LINK_SELECTOR)
			?.getAttribute("href") ?? null
	);
}

function isCollection(card: Element): boolean {
	if (card.tagName.toLowerCase() !== "yt-lockup-view-model") return false;
	if (card.querySelector(LOCKUP_COLLECTION)) return true;
	const cls = card.firstElementChild?.className;
	return typeof cls === "string" && /Collection/.test(cls);
}

function badgeTexts(card: Element): string[] {
	const out: string[] = [];
	for (const b of card.querySelectorAll(THUMBNAIL_BADGE)) {
		const t = (b.textContent ?? "").trim();
		if (t && t.length < 40) out.push(t);
	}
	return out;
}

/** Leaf text spans of the metadata area, as [aria-label, text] pairs. */
function metadataParts(
	card: Element,
): { label: string; text: string; bare: boolean }[] {
	const tag = card.tagName.toLowerCase();
	const parts: { label: string; text: string; bare: boolean }[] = [];
	const push = (el: Element, bare: boolean) => {
		const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
		const label = (el.getAttribute("aria-label") ?? "").trim();
		if (!label && SEPARATOR_RE.test(text)) {
			// "48K views · 2y ago" in a single node: classify each piece.
			for (const piece of text.split(SEPARATOR_RE)) {
				if (piece) parts.push({ label: "", text: piece, bare });
			}
		} else if (text || label) {
			parts.push({ label, text, bare });
		}
	};
	if (tag === "yt-lockup-view-model") {
		const meta = card.querySelector(LOCKUP_METADATA);
		if (meta) {
			// Spans carrying views / age have an aria-label with the long form
			// ("7.9 thousand views", "3 hours ago"); channel names don't.
			for (const span of meta.querySelectorAll("span[aria-label]"))
				push(span, false);
			if (!parts.length) {
				for (const span of meta.querySelectorAll('[role="text"]'))
					push(span, false);
			}
		}
		return parts;
	}
	if (tag === "ytm-shorts-lockup-view-model") {
		const sub = card.querySelector(SHORTS_LOCKUP_SUBHEAD);
		if (sub) push(sub, false);
		return parts;
	}
	const line = card.querySelector(LEGACY_METADATA_LINE);
	if (line) {
		const items = line.querySelectorAll(
			":scope > span, span.inline-metadata-item",
		);
		if (items.length) for (const s of items) push(s, true);
		else push(line, false);
	}
	return parts;
}

function channelRefFrom(card: Element): ChannelRef | null {
	for (const a of card.querySelectorAll<HTMLAnchorElement>(
		CHANNEL_LINK_SELECTOR,
	)) {
		const ref = extractChannelRef(a.getAttribute("href") ?? "");
		if (ref) return ref;
	}
	return null;
}

/** On a channel page, cards without a channel link belong to that channel. */
function pageChannelRef(): ChannelRef | null {
	if (!/^\/(@[^/]+|channel\/[^/]+)/.test(location.pathname)) return null;
	return extractChannelRef(location.href);
}

/** Extracts what the card shows. Null for cards that aren't videos/playlists. */
export function extractCard(card: Element): CardInfo | null {
	const href = primaryHref(card);
	if (!href || card.closest(AD_CONTAINER)) return null;
	const tag = card.tagName.toLowerCase();
	const collection = isCollection(card);
	const badges = badgeTexts(card);
	if (badges.some((t) => /^sponsored$/i.test(t))) return null;

	if (collection) {
		const listId = collectionIdFrom(href);
		if (!listId) return null;
		const size =
			badges.find((t) => PLAYLIST_SIZE_RE.test(t)) ??
			badges.find((t) => /^mix$/i.test(t)) ??
			null;
		return {
			key: `list:${listId}`,
			kind: "playlist",
			videoId: null,
			views: null,
			publishedAt: null,
			isLive: false,
			isUpcoming: false,
			channelRef: channelRefFrom(card),
			playlistSize: size,
		};
	}

	const videoId = extractVideoId(href);
	if (!videoId) return null;
	const isShort =
		isShortsUrl(href) ||
		tag === "ytm-shorts-lockup-view-model" ||
		tag === "ytd-reel-item-renderer";

	let views: number | null = null;
	let publishedAt: number | null = null;
	let isLive = badges.some((t) => /^live$/i.test(t));
	let isUpcoming = badges.some((t) => /^(upcoming|premiere)$/i.test(t));

	if (uiIsEnglish()) {
		for (const { label, text, bare } of metadataParts(card)) {
			const s = label || text;
			if (LIVE_RE.test(s)) {
				isLive = true;
				continue;
			}
			if (UPCOMING_RE.test(s) && !/\bago\b/i.test(s)) {
				isUpcoming = true;
				continue;
			}
			const ago = parseAgo(s) ?? parseAgo(text);
			if (ago) {
				publishedAt ??= ago.getTime();
				continue;
			}
			if (
				views == null &&
				(VIEWS_RE.test(s) || (bare && BARE_COUNT_RE.test(text)))
			) {
				views = parseCount(s)?.value ?? parseCount(text)?.value ?? null;
			}
		}
	}

	return {
		key: `video:${videoId}`,
		kind: isShort ? "short" : "video",
		videoId,
		views,
		publishedAt,
		isLive,
		isUpcoming,
		channelRef: channelRefFrom(card) ?? pageChannelRef(),
		playlistSize: null,
	};
}

/** Cheap identity check used on every DOM mutation (no metadata parsing). */
export function cardKey(card: Element): string | null {
	const href = primaryHref(card);
	if (!href || card.closest(AD_CONTAINER)) return null;
	if (isCollection(card)) {
		const listId = collectionIdFrom(href);
		return listId ? `list:${listId}` : null;
	}
	const videoId = extractVideoId(href);
	return videoId ? `video:${videoId}` : null;
}

/**
 * Where the badge row goes: right under the views/age line, aligned with the
 * title (never inside a link, never over the thumbnail).
 */
export function badgeAnchor(
	card: Element,
): { parent: Element; after: Element | null } | null {
	const tag = card.tagName.toLowerCase();
	if (tag === "yt-lockup-view-model") {
		const meta = card.querySelector(LOCKUP_METADATA);
		if (meta?.parentElement) return { parent: meta.parentElement, after: meta };
		const text = card.querySelector('[class*="TextContainer"]');
		return text ? { parent: text, after: text.lastElementChild } : null;
	}
	if (tag === "ytm-shorts-lockup-view-model") {
		const sub = card.querySelector(SHORTS_LOCKUP_SUBHEAD);
		if (sub?.parentElement) return { parent: sub.parentElement, after: sub };
		const title = card.querySelector("h3");
		if (title?.parentElement)
			return { parent: title.parentElement, after: title };
		return null;
	}
	const line = card.querySelector(LEGACY_METADATA_LINE);
	if (line?.parentElement) return { parent: line.parentElement, after: line };
	const details = card.querySelector("#details, #meta, #metadata");
	return details ? { parent: details, after: details.lastElementChild } : null;
}
