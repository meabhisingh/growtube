/**
 * Live feed preview: the side panel's Thumbnails tool asks the background
 * (`tab.feedPreview`, extension pages only) to forward a fake video card to
 * a youtube.com tab's content script, which inserts it into the home grid or
 * the search results. Shared, DOM-free types + limits (any context).
 *
 * Privacy: the card (image, title, channel, avatar) only travels side panel
 * -> background -> that tab's content script over runtime messaging. It is
 * never uploaded or stored.
 */
import type { YtPageType } from "./youtube/types";

/** The fake card. Images are small data URLs (JPEG/PNG/WebP). */
export type FeedPreviewCard = {
	/** Thumbnail, at most 1280x720 (`FEED_PREVIEW_MAX_IMAGE_CHARS`) */
	image: string;
	title: string;
	channel: string;
	/** Square avatar data URL, null = placeholder initial */
	avatar: string | null;
	/** "12:34" or null (no duration badge) */
	duration: string | null;
	/** "1.2K views • 2 hours ago" */
	meta: string;
};

export type FeedPreviewStatus =
	/** Card inserted (or replaced) in the page */
	| "shown"
	/** Card removed (or there was none) */
	| "removed"
	/** A YouTube tab, but not the home page or search results */
	| "unsupported-page"
	/** Home/search, but no video grid appeared in time */
	| "no-grid"
	/** Not a youtube.com tab (or its URL can't be read) */
	| "not-youtube"
	/** No GrowTube content script answered (tab still loading, or opened before install) */
	| "no-content-script";

export type FeedPreviewResult = {
	status: FeedPreviewStatus;
	pageType: YtPageType | null;
};

/** Message the background forwards with `tabs.sendMessage` (content scripts only). */
export type FeedPreviewTabMessage =
	| { __ovqTab: 1; type: "feedPreview.show"; card: FeedPreviewCard }
	| { __ovqTab: 1; type: "feedPreview.remove" };

/** ~1280x720 JPEG at q≈0.85 is 150-400 KB; anything larger is refused. */
export const FEED_PREVIEW_MAX_IMAGE_CHARS = 3_000_000;
export const FEED_PREVIEW_MAX_AVATAR_CHARS = 200_000;
export const FEED_PREVIEW_PAGE_TYPES: ReadonlySet<YtPageType> = new Set([
	"home",
	"search",
]);

const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** Validates + trims a card received over messaging; null when unusable. */
export function sanitizeFeedPreviewCard(
	value: unknown,
): FeedPreviewCard | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const text = (x: unknown, max: number) =>
		typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "";
	if (
		typeof v.image !== "string" ||
		v.image.length > FEED_PREVIEW_MAX_IMAGE_CHARS ||
		!IMAGE_DATA_URL.test(v.image)
	)
		return null;
	const avatar =
		typeof v.avatar === "string" &&
		v.avatar.length <= FEED_PREVIEW_MAX_AVATAR_CHARS &&
		IMAGE_DATA_URL.test(v.avatar)
			? v.avatar
			: null;
	return {
		image: v.image,
		title: text(v.title, 100) || "Your video title",
		channel: text(v.channel, 60) || "Your channel",
		avatar,
		duration: text(v.duration, 12) || null,
		meta: text(v.meta, 80),
	};
}
