/**
 * YouTube data layer (InnerTube). These functions do the actual fetching and
 * run in the background service worker. From content scripts and extension
 * pages, call them through `yt` in `@/lib/client` so every context shares the
 * background's cache and rate limiter.
 */
export {
	getChannel,
	getChannelBaseline,
	getChannelVideos,
	getChannelVideosPage,
	parseAbout,
	parseChannelHeader,
	parseChannelVideosPage,
	resolveChannelId,
	resolveHandle,
} from "./channel";
export {
	DEFAULT_YT_CONFIG,
	getInnertubeConfig,
	innertube,
	setInnertubeConfig,
	YouTubeError,
} from "./innertube";
export {
	handleFromUrl,
	normalizeHandle,
	parseAgo,
	parseCount,
	parseCountValue,
	parseEnglishDate,
	parseKeywordString,
} from "./parse";
export {
	buildSearchParams,
	findVideoRank,
	parseSearchResults,
	search,
} from "./search";
export { getSearchSuggestions, parseSuggestionsJsonp } from "./suggest";
export {
	chooseCaptionTrack,
	getCaptionTracks,
	getTranscript,
	parseJson3,
	transcriptToText,
} from "./transcript";
export type * from "./types";
export {
	buildVideoDetails,
	getVideoDetails,
	getVideoDetailsBatch,
	type NextInfo,
	type PlayerInfo,
	parseCommentsHeader,
	parseNext,
	parsePlayer,
	SHORTS_MAX_SECONDS,
	type VideoSeed,
} from "./video";
export { findAll, findAllEntries, findFirst, textOf } from "./walk";
