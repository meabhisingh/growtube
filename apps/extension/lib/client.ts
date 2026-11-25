/**
 * Typed facades over `sendToBackground` for content scripts and extension
 * pages. Everything executes in the background service worker.
 *
 *   import { yt, server, ai, ext, account } from "@/lib/client";
 *   const video = await yt.getVideoDetails("dQw4w9WgXcQ");
 *   const ch = await yt.getChannel({ handle: "@carandbike" });
 *   const { titles } = await ai.generate("titleIdeas", { topic: "budget travel" });
 */
import type {
	ChannelSnapshotInput,
	HistoryRange,
	TrendingQuery,
	VideoSnapshotInput,
} from "@growtube/shared";

import type {
	GeneratorInput,
	GeneratorKind,
	GeneratorOutput,
} from "./ai/prompts";
import type {
	ChatMessage,
	ImageQuality,
	ImageSize,
	ReasoningEffortSetting,
} from "./ai/types";
import type { CurrentContext } from "./context";
import type { FeedPreviewCard } from "./feed-preview";
import { sendToBackground } from "./messaging";
import type {
	CaptionTrack,
	ChannelRef,
	ChannelTab,
	SearchSort,
	SearchType,
	VideoDetailsLevel,
} from "./youtube/types";
import type { VideoSeed } from "./youtube/video";

export { BackgroundError, sendToBackground } from "./messaging";

/** YouTube data (InnerTube), cached in the background. */
export const yt = {
	/**
	 * Exact views/likes/publish date/tags… "full" (default) adds exact comments
	 * + owner info. `crowdsource: false` (YouTube Studio): nothing is uploaded.
	 */
	getVideoDetails: (
		videoId: string,
		opts: {
			level?: VideoDetailsLevel;
			seed?: VideoSeed;
			force?: boolean;
			crowdsource?: boolean;
		} = {},
	) => sendToBackground("yt.getVideoDetails", { videoId, ...opts }),
	/**
	 * Many videos (feed badges); "basic" level by default; failures map to
	 * null. `crowdsource: false` (personal pages): nothing is uploaded.
	 */
	getVideoDetailsBatch: (
		videoIds: string[],
		level: VideoDetailsLevel = "basic",
		opts: { crowdsource?: boolean } = {},
	) =>
		sendToBackground("yt.getVideoDetailsBatch", { videoIds, level, ...opts }),
	/** `crowdsource: false` (personal pages): nothing is uploaded. */
	getChannel: (
		ref: ChannelRef,
		opts: { force?: boolean; crowdsource?: boolean } = {},
	) => sendToBackground("yt.getChannel", { ref, ...opts }),
	resolveHandle: (handle: string) =>
		sendToBackground("yt.resolveHandle", { handle }),
	getChannelVideos: (
		channelId: string,
		opts: { tab?: ChannelTab; limit?: number } = {},
	) => sendToBackground("yt.getChannelVideos", { channelId, ...opts }),
	getChannelVideosPage: (
		channelId: string,
		opts: { tab?: ChannelTab; continuation?: string | null } = {},
	) => sendToBackground("yt.getChannelVideosPage", { channelId, ...opts }),
	getChannelBaseline: (
		channelId: string,
		format: "long" | "short" = "long",
		opts: { force?: boolean } = {},
	) =>
		sendToBackground("yt.getChannelBaseline", { channelId, format, ...opts }),
	/** `crowdsource: false` (YouTube Studio): the results are not uploaded. */
	search: (
		query: string,
		opts: {
			limit?: number;
			type?: SearchType;
			sort?: SearchSort;
			force?: boolean;
			crowdsource?: boolean;
		} = {},
	) => sendToBackground("yt.search", { query, ...opts }),
	findVideoRank: (query: string, videoId: string, depth = 40) =>
		sendToBackground("yt.findVideoRank", { query, videoId, depth }),
	findVideoRanks: (videoId: string, queries: string[], depth = 40) =>
		sendToBackground("yt.findVideoRanks", { videoId, queries, depth }),
	getSearchSuggestions: (
		query: string,
		opts: { hl?: string; gl?: string } = {},
	) => sendToBackground("yt.getSearchSuggestions", { query, ...opts }),
	getTranscript: (
		videoId: string,
		opts: { lang?: string; extraTracks?: CaptionTrack[] } = {},
	) => sendToBackground("yt.getTranscript", { videoId, ...opts }),
};

/** GrowTube server (crowdsourced history, trending). */
export const server = {
	health: () => sendToBackground("api.health", {}),
	getVideoHistory: (
		videoId: string,
		range: HistoryRange = "24h",
		opts: { force?: boolean } = {},
	) => sendToBackground("api.getVideoHistory", { videoId, range, ...opts }),
	getChannelHistory: (channelId: string, opts: { force?: boolean } = {}) =>
		sendToBackground("api.getChannelHistory", { channelId, ...opts }),
	getTrending: (query: Partial<TrendingQuery> & { force?: boolean } = {}) =>
		sendToBackground("api.getTrending", query),
	getVideosStats: (videoIds: string[]) =>
		sendToBackground("api.getVideosStats", { videoIds }),
	/** Usually unnecessary: the background ingests every video/channel it fetches. */
	ingestVideos: (videos: VideoSnapshotInput[]) =>
		sendToBackground("api.ingestVideos", { videos }),
	ingestChannels: (channels: ChannelSnapshotInput[]) =>
		sendToBackground("api.ingestChannels", { channels }),
};

/** AI provider calls (the user's own OpenAI-compatible provider). */
export const ai = {
	status: () => sendToBackground("ai.status", {}),
	complete: (
		messages: ChatMessage[],
		opts: {
			json?: boolean;
			model?: string;
			temperature?: number;
			maxTokens?: number;
			reasoningEffort?: ReasoningEffortSetting;
		} = {},
	) => sendToBackground("ai.complete", { messages, ...opts }),
	/** Structured, validated output (see GENERATORS in lib/ai/prompts.ts). */
	generate: <K extends GeneratorKind>(
		kind: K,
		input: GeneratorInput<K>,
		opts: { model?: string; temperature?: number } = {},
	) =>
		sendToBackground("ai.generate", { kind, input, ...opts }) as Promise<
			GeneratorOutput<K>
		>,
	/** `{ id, shutdownDate }[]`. Pass unsaved settings to list models before saving them. */
	listModels: (
		override: { baseURL?: string; apiKey?: string; presetId?: string } = {},
	) => sendToBackground("ai.listModels", override),
	test: () => sendToBackground("ai.test", {}),
	/** `{ images: dataUrl[], size, adjustments }` */
	generateImage: (
		prompt: string,
		opts: {
			size?: ImageSize;
			quality?: ImageQuality;
			model?: string;
			n?: number;
		} = {},
	) => sendToBackground("ai.generateImage", { prompt, ...opts }),
};

/**
 * The GrowTube account (EXTENSION PAGES only: the background refuses these
 * from content scripts). Results never contain the login token; watch
 * `authUser` from `@/lib/auth` for the signed-in state.
 */
export const account = {
	signIn: (email: string, password: string) =>
		sendToBackground("auth.signIn", { email, password }),
	signUp: (name: string, email: string, password: string) =>
		sendToBackground("auth.signUp", { name, email, password }),
	signOut: () => sendToBackground("auth.signOut", {}),
	/** Re-validates the session with the server (null = signed out). */
	refresh: () => sendToBackground("auth.refresh", {}),
	/** Deletes the account, its logins and API keys after a password check. */
	deleteAccount: (password: string) =>
		sendToBackground("auth.deleteAccount", { password }),
};

/** Extension UI plumbing. */
export const ext = {
	/** Opens the side panel on the sender tab, optionally on a tool/prompt. Call from a click handler. */
	openSidePanel: (context?: CurrentContext | null) =>
		sendToBackground("sidepanel.open", { context }),
	setContext: (context: CurrentContext | null) =>
		sendToBackground("context.set", { context }),
	getContext: () => sendToBackground("context.get", {}),
	openOptions: (hash?: string) => sendToBackground("options.open", { hash }),
	clearCache: (prefix?: string) => sendToBackground("cache.clear", { prefix }),
	tabSelf: () => sendToBackground("tab.self", {}),
	/** Extension pages: show (`card`) or remove (`null`) the live feed preview in a YouTube tab. */
	feedPreview: (tabId: number, card: FeedPreviewCard | null) =>
		sendToBackground("tab.feedPreview", { tabId, card }),
};
