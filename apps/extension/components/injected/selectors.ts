/**
 * Every YouTube DOM selector the injected UIs rely on, in one place.
 * Verified against live youtube.com markup (Nov 2026); see SELECTORS.md for
 * the structure each one targets and the fallbacks used when it changes.
 *
 * YouTube's newer view-model components use camelCase class names
 * (`ytLockupViewModelHost`, `shortsLockupViewModelHostOutsideMetadataSubhead`)
 * that are regenerated from time to time, so prefer tag names, ids, hrefs and
 * aria attributes, and only match classes by substring as a last resort.
 */

// ---------------------------------------------------------------------------
// Feed cards (badges)
// ---------------------------------------------------------------------------

/** Card renderers that get a badge row. Nested matches are ignored. */
export const CARD_TAGS = [
	"yt-lockup-view-model",
	"ytm-shorts-lockup-view-model",
	"ytd-rich-grid-media",
	"ytd-video-renderer",
	"ytd-compact-video-renderer",
	"ytd-grid-video-renderer",
	"ytd-reel-item-renderer",
] as const;

export const CARD_SELECTOR = CARD_TAGS.join(",");

/** Links that identify what a card points to. */
export const CARD_LINK_SELECTOR =
	'a[href*="/watch?v="], a[href^="/shorts/"], a[href*="/playlist?list="]';

/** Channel links inside a card (absent on related videos and channel pages). */
export const CHANNEL_LINK_SELECTOR = 'a[href^="/@"], a[href^="/channel/"]';

/** Lockup (new view-model) metadata block: channel / views / age rows. */
export const LOCKUP_METADATA = "yt-content-metadata-view-model";

/** Playlists and mixes rendered as lockups have a stacked collection thumbnail. */
export const LOCKUP_COLLECTION =
	"yt-collection-thumbnail-view-model, yt-collections-stack";

/** Shorts lockup: "60K views" line under the title. */
export const SHORTS_LOCKUP_SUBHEAD = '[class*="Subhead"]';

/** Legacy renderers: views + age line. */
export const LEGACY_METADATA_LINE = "#metadata-line";

/** Thumbnail badges ("9:54", "LIVE", "86 videos", "Mix"). */
export const THUMBNAIL_BADGE =
	"badge-shape, ytd-thumbnail-overlay-time-status-renderer";

/** Ad slots render lockups too: never badge them. */
export const AD_CONTAINER =
	"ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer";

/** Our own feed badge host element (custom element name, never registered). */
export const FEED_BADGES_TAG = "ovq-feed-badges";

// ---------------------------------------------------------------------------
// Live feed preview (fake card from the Thumbnails tool)
// ---------------------------------------------------------------------------

/** Home grid: the cells' container (`ytd-browse` pages stay in the DOM, hidden). */
export const HOME_GRID_CONTENTS =
	'ytd-browse[page-subtype="home"]:not([hidden]) ytd-rich-grid-renderer > #contents';
/** One home grid cell (holds a lockup / ytd-rich-grid-media). */
export const HOME_GRID_ITEM = "ytd-rich-item-renderer";
/** Search results: each section's list of results. */
export const SEARCH_SECTION_CONTENTS =
	"ytd-search:not([hidden]) ytd-item-section-renderer > #contents";
/** Search result rows we place the fake card between. */
export const SEARCH_RESULT_ITEMS = [
	"ytd-video-renderer",
	"yt-lockup-view-model",
];
/** A search row's thumbnail (its width is mirrored). */
export const SEARCH_RESULT_THUMB = "ytd-thumbnail, a#thumbnail";
/** Our fake card (sibling of YouTube's cells) and its floating control. */
export const FEED_PREVIEW_TAG = "ovq-feed-preview";
export const FEED_PREVIEW_BAR_TAG = "ovq-feed-preview-bar";

// ---------------------------------------------------------------------------
// Watch page
// ---------------------------------------------------------------------------

/** The watch page container; persists across watch -> watch navigations. */
export const WATCH_FLEXY = "ytd-watch-flexy";
/** Right column (two-column layout). Hidden (0px wide) in single-column mode. */
export const WATCH_SECONDARY = "#secondary";
export const WATCH_SECONDARY_INNER = "#secondary-inner";
/** Under the player (holds the title block in single-column mode). */
export const WATCH_BELOW = "#below";
export const WATCH_METADATA = "ytd-watch-metadata";
/** Attributes of ytd-watch-flexy that change the layout. */
export const WATCH_LAYOUT_ATTRS = [
	"is-single-column",
	"theater",
	"fullscreen",
	"hidden",
];

export const WATCH_PANEL_TAG = "ovq-watch-panel";

// ---------------------------------------------------------------------------
// Shorts
// ---------------------------------------------------------------------------

/** Old layout: one renderer per Short, the visible one has [is-active]. */
export const SHORTS_ACTIVE_RENDERER = "ytd-reel-video-renderer[is-active]";
/**
 * New layout (2026): a single ytd-reel-video-renderer that YouTube moves into
 * the active `.reel-video-in-sequence-new` slot, with one reused player.
 */
export const SHORTS_RENDERER = "ytd-reel-video-renderer";
export const SHORTS_PLAYER = "#shorts-player";
export const SHORTS_VIDEO = "video.html5-main-video, video";
/** "Next Short" button (right rail). */
export const SHORTS_NEXT_BUTTON =
	"#navigation-button-down button, #navigation-button-down";

export const SHORTS_CONTROLS_TAG = "ovq-shorts-controls";
