/**
 * Normalized YouTube data shapes returned by `lib/youtube/*`.
 *
 * Everything here is JSON-safe (no Date objects) because it crosses the
 * runtime-messaging boundary and is persisted in chrome.storage. Timestamps
 * are ISO-8601 strings in UTC; "unknown" is always `null`, never `undefined`.
 */

export type Thumbnail = { url: string; width?: number; height?: number };

export type CaptionTrack = {
	/** timedtext URL. Web-client URLs may need a PoToken; see getTranscript. */
	baseUrl: string;
	languageCode: string;
	/** Human label, e.g. "English (auto-generated)" */
	name: string;
	kind: "manual" | "asr";
	vssId: string | null;
	isTranslatable: boolean;
};

export type VideoDetails = {
	videoId: string;
	title: string;
	description: string;
	channelId: string;
	channelTitle: string;
	/** "@handle" when known */
	channelHandle: string | null;
	/** Exact lifetime views (videoDetails.viewCount) */
	views: number;
	/** Exact when available (microformat likeCount), null when hidden */
	likes: number | null;
	/** Exact when `commentsExact`, otherwise rounded ("2.4M"); null when off/unknown */
	comments: number | null;
	commentsExact: boolean;
	/** Exact publish time (microformat publishDate), ISO UTC */
	publishedAt: string | null;
	durationSec: number;
	isShort: boolean;
	/** Currently live */
	isLive: boolean;
	/** Was / is a live stream or premiere */
	isLiveContent: boolean;
	isUpcoming: boolean;
	isUnlisted: boolean;
	/** Private video (only its uploader can watch it) */
	isPrivate: boolean;
	/**
	 * YouTube's player data confirms a public, listed video. False when
	 * unlisted, private or unknown (no player data). Only public videos are
	 * sent to (or looked up on) the open-vidiq server: check it with
	 * `isPublicVideo()` from `@/lib/youtube/visibility`.
	 */
	isPublic: boolean;
	isFamilySafe: boolean | null;
	/** Video tags */
	keywords: string[];
	category: string | null;
	thumbnails: Thumbnail[];
	/** Best thumbnail URL (i.ytimg.com) */
	thumbnailUrl: string;
	/** May be empty even if captions exist; use getTranscript() for text. */
	captionTracks: CaptionTrack[];
	/** Rounded public subscriber count of the uploader (from the watch page) */
	channelSubscribers: number | null;
	/** "basic" = player only, "full" = player + watch-next + comments header */
	level: VideoDetailsLevel;
	fetchedAt: string;
};

export type VideoDetailsLevel = "basic" | "full";

export type ChannelRef = { channelId: string } | { handle: string };

export type ChannelInfo = {
	channelId: string;
	/** "@handle" */
	handle: string | null;
	title: string;
	avatarUrl: string | null;
	bannerUrl: string | null;
	/** Rounded public count ("685K" -> 685000); null when hidden */
	subscribers: number | null;
	/** Exact lifetime channel views from the About panel */
	totalViews: number | null;
	/** Exact public video count from the About panel */
	videoCount: number | null;
	/** YYYY-MM-DD */
	joinedAt: string | null;
	country: string | null;
	/** Channel keywords (tags) */
	keywords: string[];
	description: string;
	isVerified: boolean;
	links: { title: string; url: string }[];
	fetchedAt: string;
};

export type ChannelTab = "videos" | "shorts" | "streams";

export type ChannelVideo = {
	videoId: string;
	title: string;
	/** Usually rounded on channel tabs ("6.3K") */
	views: number | null;
	viewsExact: boolean;
	/** Approximate, derived from relative text ("11 hours ago"); null for Shorts */
	publishedAt: string | null;
	publishedApprox: true;
	publishedText: string | null;
	durationSec: number | null;
	isShort: boolean;
	isLive: boolean;
	isUpcoming: boolean;
	thumbnail: string;
};

export type ChannelVideosPage = {
	channelId: string;
	tab: ChannelTab;
	videos: ChannelVideo[];
	/** Pass back as `continuation` to fetch more; null when exhausted */
	continuation: string | null;
};

export type ChannelBaseline = {
	channelId: string;
	format: "long" | "short";
	/** Median views of recent uploads of that format, null if not enough data */
	baseline: number | null;
	/** How many uploads the median was computed over */
	sampleSize: number;
	computedAt: string;
};

export type SearchType = "all" | "video" | "short";
export type SearchSort = "relevance" | "date" | "views";

export type SearchResult = {
	/** 1-based position among video results (shelves flattened in page order) */
	position: number;
	videoId: string;
	title: string;
	channelId: string | null;
	channelTitle: string | null;
	channelHandle: string | null;
	views: number | null;
	viewsExact: boolean;
	publishedAt: string | null;
	publishedApprox: boolean;
	publishedText: string | null;
	durationSec: number | null;
	isShort: boolean;
	isLive: boolean;
	thumbnail: string;
	/** Where it came from: "video" | "lockup" | "short" */
	source: "video" | "lockup" | "short";
};

export type SearchResponse = {
	query: string;
	estimatedResults: number | null;
	results: SearchResult[];
	/** Spelling correction YouTube applied ("Showing results for …"), if any */
	correctedQuery: string | null;
};

export type TranscriptSegment = {
	/** seconds */
	start: number;
	/** seconds */
	dur: number;
	text: string;
};

export type Transcript = {
	videoId: string;
	languageCode: string;
	kind: "manual" | "asr";
	segments: TranscriptSegment[];
};

/** InnerTube configuration (ytcfg) as seen by the extension. */
export type YtConfig = {
	apiKey: string | null;
	clientName: string;
	clientVersion: string;
	/** UI language of the user (we always *request* "en" for parsing) */
	hl: string;
	gl: string;
	visitorData: string | null;
	loggedIn: boolean;
	delegatedSessionId: string | null;
	/** Raw INNERTUBE_CONTEXT when read from the page */
	context: Record<string, unknown> | null;
	/** Where this config came from */
	source: "page" | "default";
};

export type YtPageType =
	| "watch"
	| "shorts"
	| "channel"
	| "search"
	| "home"
	| "browse"
	| "studio"
	| "other";

/** Raw page data captured by the main-world bridge. */
export type YtPageData = {
	url: string;
	pageType: YtPageType;
	videoId: string | null;
	/** Raw player response for the current video, if the page has one */
	playerResponse: unknown | null;
	/** Raw ytInitialData / navigation response */
	initialData: unknown | null;
	/** ms epoch when the bridge captured it */
	capturedAt: number;
};
