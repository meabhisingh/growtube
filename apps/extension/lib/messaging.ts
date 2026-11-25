/**
 * Typed request/response messaging between content scripts / extension pages
 * and the background service worker.
 *
 *   const details = await sendToBackground("yt.getVideoDetails", { videoId });
 *
 * Every handler runs in the background (one cache, one rate limiter for the
 * whole browser). Errors come back as `{ ok: false, error, code }` and are
 * re-thrown on the caller side as `BackgroundError`.
 *
 * Prefer the friendlier facades in `@/lib/client` (`yt`, `server`, `ai`, `ext`).
 */
import type {
	ChannelHistoryResponse,
	ChannelSnapshotInput,
	HistoryRange,
	TrendingQuery,
	TrendingResponse,
	VideoHistoryResponse,
	VideoSnapshotInput,
	VideoStatsResponse,
} from "@growtube/shared";
import { type Browser, browser } from "wxt/browser";

import type { GenerateImageResult, TestResult } from "./ai/complete";
import type { GeneratorKind } from "./ai/prompts";
import type {
	AiErrorCode,
	AiModelInfo,
	ChatMessage,
	ImageQuality,
	ImageSize,
	ReasoningEffortSetting,
} from "./ai/types";
import type { SignedInUser } from "./auth";
import type { AlertRunResult } from "./competitor-alerts";
import type { CurrentContext } from "./context";
import { keepAliveWhile } from "./keepalive";
import type { RankCheckResult } from "./rank-tracker";
import type {
	CaptionTrack,
	ChannelBaseline,
	ChannelInfo,
	ChannelRef,
	ChannelTab,
	ChannelVideo,
	ChannelVideosPage,
	SearchResponse,
	SearchSort,
	SearchType,
	Transcript,
	VideoDetails,
	VideoDetailsLevel,
} from "./youtube/types";
import type { VideoSeed } from "./youtube/video";

type Empty = Record<string, never>;

export type AiStatus = {
	configured: boolean;
	/** Host permission for the provider origin is granted */
	hasPermission: boolean;
	/** Ready to call (configured && hasPermission) */
	ready: boolean;
	presetId: string;
	providerLabel: string;
	baseURL: string;
	origin: string | null;
	model: string;
	imageModel: string;
	/** "" = provider default (not sent) */
	reasoningEffort: ReasoningEffortSetting;
	/** Why it's not ready (actionable), null when ready */
	problem: string | null;
};

/**
 * The protocol: message type -> request payload / response data.
 * Add a handler in lib/background-handlers.ts for every entry.
 */
export interface Protocol {
	// ---- Account (lib/auth-session) ----
	// Extension pages only (content scripts are refused). Responses never
	// contain the login token. Every message below the auth block needs a
	// signed-in user, except api.health and the extension plumbing ones.
	"auth.signIn": {
		req: { email: string; password: string };
		res: SignedInUser;
	};
	"auth.signUp": {
		req: { name: string; email: string; password: string };
		res: SignedInUser;
	};
	/** Signs out locally at once, then revokes the session on the server. */
	"auth.signOut": { req: Empty; res: { ok: true } };
	/** Re-validates the session with the server; null = signed out. */
	"auth.refresh": { req: Empty; res: SignedInUser | null };
	/** Deletes the account (user, sessions, API keys) after a password check. */
	"auth.deleteAccount": {
		req: { password: string };
		res: { deleted: boolean; emailConfirmation: boolean };
	};

	// ---- YouTube (lib/youtube) ----
	"yt.getVideoDetails": {
		/** `crowdsource: false`: don't queue a snapshot (YouTube Studio). */
		req: {
			videoId: string;
			level?: VideoDetailsLevel;
			seed?: VideoSeed;
			force?: boolean;
			crowdsource?: boolean;
		};
		res: VideoDetails;
	};
	"yt.getVideoDetailsBatch": {
		/** `crowdsource: false`: don't queue snapshots (personal pages). */
		req: {
			videoIds: string[];
			level?: VideoDetailsLevel;
			crowdsource?: boolean;
		};
		res: Record<string, VideoDetails | null>;
	};
	"yt.getChannel": {
		/** `crowdsource: false`: don't queue a snapshot (personal pages). */
		req: { ref: ChannelRef; force?: boolean; crowdsource?: boolean };
		res: ChannelInfo;
	};
	"yt.resolveHandle": { req: { handle: string }; res: string };
	"yt.getChannelVideos": {
		req: { channelId: string; tab?: ChannelTab; limit?: number };
		res: ChannelVideo[];
	};
	"yt.getChannelVideosPage": {
		req: { channelId: string; tab?: ChannelTab; continuation?: string | null };
		res: ChannelVideosPage;
	};
	"yt.getChannelBaseline": {
		req: { channelId: string; format?: "long" | "short"; force?: boolean };
		res: ChannelBaseline;
	};
	"yt.search": {
		/** `crowdsource: false`: don't queue the results (YouTube Studio tag ranks). */
		req: {
			query: string;
			limit?: number;
			type?: SearchType;
			sort?: SearchSort;
			force?: boolean;
			crowdsource?: boolean;
		};
		res: SearchResponse;
	};
	"yt.findVideoRank": {
		req: { query: string; videoId: string; depth?: number };
		res: number | null;
	};
	/** Rank of one video for many queries (tag rank badges). Sequential-ish, cached per query. */
	"yt.findVideoRanks": {
		req: { videoId: string; queries: string[]; depth?: number };
		res: Record<string, number | null>;
	};
	"yt.getSearchSuggestions": {
		req: { query: string; hl?: string; gl?: string };
		res: string[];
	};
	"yt.getTranscript": {
		req: { videoId: string; lang?: string; extraTracks?: CaptionTrack[] };
		res: Transcript | null;
	};
	/** Content scripts forward the page's public ytcfg (client version, gl). */
	"yt.setConfig": {
		req: {
			clientVersion?: string;
			clientName?: string;
			apiKey?: string | null;
			gl?: string;
		};
		res: { ok: true };
	};

	// ---- GrowTube server (lib/api) ----
	"api.health": {
		req: Empty;
		res: { ok: boolean; serverUrl: string; error?: string };
	};
	"api.ingestVideos": {
		req: { videos: VideoSnapshotInput[] };
		res: { queued: number };
	};
	"api.ingestChannels": {
		req: { channels: ChannelSnapshotInput[] };
		res: { queued: number };
	};
	"api.getVideoHistory": {
		req: { videoId: string; range?: HistoryRange; force?: boolean };
		res: VideoHistoryResponse;
	};
	"api.getChannelHistory": {
		req: { channelId: string; force?: boolean };
		res: ChannelHistoryResponse;
	};
	"api.getTrending": {
		req: Partial<TrendingQuery> & { force?: boolean };
		res: TrendingResponse;
	};
	"api.getVideosStats": {
		req: { videoIds: string[] };
		res: VideoStatsResponse;
	};

	// ---- AI (lib/ai) ----
	"ai.status": { req: Empty; res: AiStatus };
	"ai.complete": {
		req: {
			messages: ChatMessage[];
			/** Ask for JSON and return it parsed (unvalidated) in `json` */
			json?: boolean;
			model?: string;
			temperature?: number;
			/** Output cap; reasoning tokens count against it on reasoning models */
			maxTokens?: number;
			/** Override the configured effort ("" = not sent) */
			reasoningEffort?: ReasoningEffortSetting;
		};
		res: { text: string; json?: unknown };
	};
	/** Structured generators from lib/ai/prompts.ts (validated). Use `ai.generate()` in lib/client for types. */
	"ai.generate": {
		req: {
			kind: GeneratorKind;
			input: unknown;
			model?: string;
			temperature?: number;
		};
		res: unknown;
	};
	"ai.listModels": {
		req: { baseURL?: string; apiKey?: string; presetId?: string };
		/** Sorted by id; shutdownDate from the provider when announced */
		res: AiModelInfo[];
	};
	"ai.test": { req: Empty; res: TestResult };
	"ai.generateImage": {
		req: {
			prompt: string;
			/**
			 * Omitted / "auto" = not sent (provider default). "1280x720" (YouTube
			 * 16:9, what the UI uses) falls back to 1536x1024, then the provider default.
			 */
			size?: ImageSize;
			/** "auto"/omitted = not sent; dropped automatically if rejected */
			quality?: ImageQuality;
			model?: string;
			n?: number;
		};
		res: GenerateImageResult;
	};

	// ---- Background jobs (local only: results go to chrome.storage.local) ----
	/** Runs the competitor outlier alert check now (lib/competitor-alerts). */
	"alerts.checkNow": { req: Empty; res: AlertRunResult };
	/**
	 * Re-checks tracked search ranks now (lib/rank-tracker): the given track
	 * ids, or every tracked pair when `ids` is omitted.
	 */
	"ranks.check": { req: { ids?: string[] }; res: RankCheckResult };

	// ---- Extension ----
	/** Opens the side panel for the sender's tab (call from a click handler). */
	"sidepanel.open": {
		req: { context?: CurrentContext | null };
		res: { ok: true };
	};
	"context.set": {
		req: { context: CurrentContext | null };
		res: CurrentContext | null;
	};
	"context.get": { req: Empty; res: CurrentContext | null };
	"options.open": { req: { hash?: string }; res: { ok: true } };
	"cache.clear": { req: { prefix?: string }; res: { removed: number } };
	/** Tab id of the sender (content scripts can't know it otherwise). */
	"tab.self": {
		req: Empty;
		res: { tabId: number | null; windowId: number | null };
	};
}

export type MessageType = keyof Protocol;
export type Req<T extends MessageType> = Protocol[T]["req"];
export type Res<T extends MessageType> = Protocol[T]["res"];

/** Discriminated union of every request envelope, keyed by `type`. */
export type RequestEnvelope = {
	[K in MessageType]: { __ovq: 1; type: K; payload: Req<K> };
}[MessageType];

export type ResponseEnvelope<T = unknown> =
	| { __ovq: 1; ok: true; data: T }
	| { __ovq: 1; ok: false; error: string; code?: string; status?: number };

export type ErrorCode =
	| AiErrorCode
	/** Signed out: show the sign-in screen / open Settings → Account */
	| "AUTH_REQUIRED"
	| "NOT_FOUND"
	| "UNAVAILABLE"
	| "RATE_LIMITED"
	| "NETWORK"
	| "PARSE"
	| "HTTP"
	| "PERMISSION"
	| "INVALID_RESPONSE"
	| "BAD_REQUEST"
	| "INTERNAL"
	| (string & {});

export class BackgroundError extends Error {
	readonly code: ErrorCode | undefined;
	readonly status: number | undefined;
	readonly type: string;
	constructor(type: string, message: string, code?: string, status?: number) {
		super(message);
		this.name = "BackgroundError";
		this.type = type;
		this.code = code;
		this.status = status;
	}
}

function isResponseEnvelope(value: unknown): value is ResponseEnvelope {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { __ovq?: unknown }).__ovq === 1 &&
		"ok" in value
	);
}

/** The message was never delivered (worker starting up): always safe to resend. */
const NOT_DELIVERED =
	/Receiving end does not exist|Could not establish connection/i;
/** Delivered, but the worker stopped before answering. */
const PORT_CLOSED = /message port closed/i;
/**
 * Requests that must not run twice: AI calls are slow and may be billed per
 * request; account changes aren't repeatable; the others open tabs/panels.
 */
const NOT_IDEMPOTENT =
	/^ai\.|^auth\.(signIn|signUp|deleteAccount)$|^options\.open$|^sidepanel\.open$/;

/**
 * Sends a typed request to the background and resolves with its data.
 * Throws BackgroundError (with `code`) when the handler fails.
 */
export async function sendToBackground<T extends MessageType>(
	type: T,
	payload: Req<T>,
): Promise<Res<T>> {
	const envelope = { __ovq: 1 as const, type, payload };
	const idempotent = !NOT_IDEMPOTENT.test(type);
	let response: unknown;
	for (let attempt = 0; ; attempt++) {
		try {
			response = await browser.runtime.sendMessage(envelope);
			break;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (/context invalidated/i.test(message)) {
				throw new BackgroundError(
					type,
					"GrowTube was updated or reloaded. Refresh this page to keep using it.",
					"CONTEXT_INVALIDATED",
				);
			}
			// The service worker may be (re)starting: retry briefly. A request
			// that was already delivered is only resent when repeating it is
			// harmless (reads), never for AI calls.
			const retryable =
				NOT_DELIVERED.test(message) ||
				(idempotent && PORT_CLOSED.test(message));
			if (attempt < 2 && retryable) {
				await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
				continue;
			}
			if (PORT_CLOSED.test(message)) {
				throw new BackgroundError(
					type,
					"The extension's background worker stopped before it could answer. Try again.",
					"NETWORK",
				);
			}
			throw new BackgroundError(type, message, "NETWORK");
		}
	}
	if (!isResponseEnvelope(response)) {
		throw new BackgroundError(
			type,
			`No handler answered "${type}"`,
			"INTERNAL",
		);
	}
	if (!response.ok)
		throw new BackgroundError(
			type,
			response.error,
			response.code,
			response.status,
		);
	return response.data as Res<T>;
}

// ---------------------------------------------------------------------------
// Background router
// ---------------------------------------------------------------------------

export type HandlerContext = {
	sender: Browser.runtime.MessageSender;
	/** Sender tab id, when the message came from a content script */
	tabId: number | null;
};

export type Handlers = {
	[K in MessageType]: (
		payload: Req<K>,
		ctx: HandlerContext,
	) => Promise<Res<K>> | Res<K>;
};

/** Normalizes any thrown value to `{ error, code, status }`. */
export function serializeError(error: unknown): {
	error: string;
	code?: string;
	status?: number;
} {
	if (error instanceof Error) {
		const e = error as Error & { code?: unknown; status?: unknown };
		return {
			error: e.message || e.name,
			code: typeof e.code === "string" ? e.code : undefined,
			status: typeof e.status === "number" ? e.status : undefined,
		};
	}
	return { error: String(error) };
}

/**
 * Installs the runtime.onMessage router (call once in the background).
 * Unknown messages are ignored so other listeners keep working.
 */
export function registerBackgroundRouter(handlers: Handlers): void {
	browser.runtime.onMessage.addListener(
		(message: unknown, sender, sendResponse) => {
			const env = message as RequestEnvelope | null;
			if (env?.__ovq !== 1 || typeof env.type !== "string") return false;
			// Only our own extension's contexts may call us.
			if (sender.id && sender.id !== browser.runtime.id) return false;
			const handler = (
				handlers as Record<string, (p: unknown, c: HandlerContext) => unknown>
			)[env.type];
			if (!handler) {
				sendResponse({
					__ovq: 1,
					ok: false,
					error: `Unknown message type "${env.type}"`,
					code: "BAD_REQUEST",
				});
				return false;
			}
			const ctx: HandlerContext = { sender, tabId: sender.tab?.id ?? null };
			// Invoke synchronously: APIs that need the sender's user gesture
			// (sidePanel.open) must be called inside this dispatch.
			let result: unknown;
			try {
				result = handler(env.payload ?? {}, ctx);
			} catch (error) {
				result = Promise.reject(error);
			}
			// Long handlers (AI, many rank lookups) must not be cut off by the
			// worker's idle / slow-fetch shutdown.
			keepAliveWhile(Promise.resolve(result)).then(
				(data) =>
					sendResponse({
						__ovq: 1,
						ok: true,
						data: data ?? null,
					} satisfies ResponseEnvelope),
				(error: unknown) => {
					console.warn(`[GrowTube] ${env.type} failed:`, error);
					sendResponse({
						__ovq: 1,
						ok: false,
						...serializeError(error),
					} satisfies ResponseEnvelope);
				},
			);
			return true; // keep the channel open for the async response
		},
	);
}
