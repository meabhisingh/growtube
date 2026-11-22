/**
 * Minimal InnerTube client (the private JSON API youtube.com itself uses).
 * No API key or quota. Works from:
 *  - the background service worker / extension pages (cross-origin, allowed
 *    by the youtube.com host permission), and
 *  - Node (scripts/live-check.ts).
 * Content scripts should not call this directly: they go through the
 * background (`yt` in lib/client.ts) so every tab shares one cache and one
 * rate limiter.
 *
 * Requests are always anonymous (`credentials: "omit"`) and always ask for
 * English (`hl=en`) so our text parsers work for every user.
 */
import {
	createLimiter,
	HttpError,
	parseRetryAfter,
	withRetry,
} from "../limiter";
import type { YtConfig } from "./types";
import { type AnyObj, isObj } from "./walk";

export const YT_ORIGIN = "https://www.youtube.com";

/** Known-good fallback; InnerTube accepts stale versions for months. */
const DEFAULT_WEB_CLIENT_VERSION = "2.20261119.07.00";

export const DEFAULT_YT_CONFIG: YtConfig = {
	apiKey: null,
	clientName: "WEB",
	clientVersion: DEFAULT_WEB_CLIENT_VERSION,
	hl: "en",
	gl: "US",
	visitorData: null,
	source: "default",
};

let config: YtConfig = { ...DEFAULT_YT_CONFIG };

// The page-provided identity is persisted in chrome.storage.session so it
// survives the MV3 worker going to sleep (the module state doesn't).
const SESSION_KEY = "ovqYtConfig";
type PersistedConfig = Pick<
	YtConfig,
	"apiKey" | "clientVersion" | "gl" | "hl" | "source"
>;
type SessionArea = {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
};

function sessionArea(): SessionArea | null {
	try {
		const chromeApi = (
			globalThis as { chrome?: { storage?: { session?: SessionArea } } }
		).chrome;
		return chromeApi?.storage?.session ?? null;
	} catch {
		return null;
	}
}

let restored: Promise<void> | null = null;

/** Loads the persisted page config once per worker lifetime. */
function restoreConfig(): Promise<void> {
	restored ??= (async () => {
		const area = sessionArea();
		if (!area) return;
		try {
			const raw = (await area.get(SESSION_KEY))[SESSION_KEY] as
				| Partial<PersistedConfig>
				| undefined;
			// Values set by a page after startup win over the stored ones.
			if (raw && config.source !== "page") {
				config = {
					...config,
					...(typeof raw.clientVersion === "string"
						? { clientVersion: raw.clientVersion }
						: {}),
					...(typeof raw.apiKey === "string" ? { apiKey: raw.apiKey } : {}),
					...(typeof raw.gl === "string" ? { gl: raw.gl } : {}),
					...(typeof raw.hl === "string" ? { hl: raw.hl } : {}),
					source: raw.source === "page" ? "page" : config.source,
				};
			}
		} catch {
			// No session storage (content script without access, Node): defaults.
		}
	})();
	return restored;
}

/** Current config used for requests (page-provided values win over defaults). */
export function getInnertubeConfig(): YtConfig {
	return config;
}

/** Like getInnertubeConfig, after the persisted page config was restored. */
export async function loadInnertubeConfig(): Promise<YtConfig> {
	await restoreConfig();
	return config;
}

/**
 * Merges a ytcfg read from a youtube.com page (via the bridge). Only the
 * public client identity is kept; we never forward session/auth data.
 */
export function setInnertubeConfig(partial: Partial<YtConfig>): YtConfig {
	const next = { ...config };
	if (partial.clientName === "WEB" && partial.clientVersion) {
		next.clientVersion = partial.clientVersion;
	}
	if (partial.apiKey) next.apiKey = partial.apiKey;
	if (partial.gl) next.gl = partial.gl;
	if (partial.visitorData) next.visitorData = partial.visitorData;
	if (partial.hl) next.hl = partial.hl;
	next.source = partial.source ?? next.source;
	config = next;
	if (next.source === "page") {
		const persisted: PersistedConfig = {
			apiKey: next.apiKey,
			clientVersion: next.clientVersion,
			gl: next.gl,
			hl: next.hl,
			source: next.source,
		};
		void sessionArea()
			?.set({ [SESSION_KEY]: persisted })
			.catch(() => {});
	}
	return config;
}

export type InnertubeClient = "WEB" | "ANDROID";

const CLIENTS: Record<
	InnertubeClient,
	{ id: number; context: () => AnyObj; version: () => string }
> = {
	WEB: {
		id: 1,
		version: () => config.clientVersion,
		context: () => ({
			clientName: "WEB",
			clientVersion: config.clientVersion,
			platform: "DESKTOP",
		}),
	},
	// The Android client returns caption tracks whose timedtext URLs work
	// without a PoToken (web-client URLs now return empty bodies without one).
	ANDROID: {
		id: 3,
		version: () => "20.10.38",
		context: () => ({
			clientName: "ANDROID",
			clientVersion: "20.10.38",
			androidSdkVersion: 30,
			osName: "Android",
			osVersion: "11",
			platform: "MOBILE",
		}),
	},
};

export class YouTubeError extends Error {
	readonly code:
		| "NOT_FOUND"
		| "UNAVAILABLE"
		| "RATE_LIMITED"
		| "NETWORK"
		| "PARSE"
		| "HTTP";
	readonly status: number | null;
	constructor(
		code: YouTubeError["code"],
		message: string,
		status: number | null = null,
	) {
		super(message);
		this.name = "YouTubeError";
		this.code = code;
		this.status = status;
	}
}

/** Max 4 concurrent InnerTube requests per context. */
const limit = createLimiter(4);

// InnerTube answers POSTs whose Origin is `chrome-extension://…` (every
// request from the service worker) with a 403 "Sorry…" page. A session DNR
// rule rewrites Origin/Referer for this extension's own InnerTube requests.
// Needs the "declarativeNetRequestWithHostAccess" manifest permission; it is a
// no-op without it, in content scripts (page origin already) and in Node.
const ORIGIN_RULE_ID = 4_201;
let originRule: Promise<void> | null = null;

type DnrApi = {
	updateSessionRules(options: {
		removeRuleIds?: number[];
		addRules?: unknown[];
	}): Promise<void>;
};

function ensureOriginRule(): Promise<void> {
	originRule ??= (async () => {
		const chromeApi = (
			globalThis as {
				chrome?: {
					runtime?: { id?: string };
					declarativeNetRequest?: DnrApi;
				};
			}
		).chrome;
		const dnr = chromeApi?.declarativeNetRequest;
		const extensionId = chromeApi?.runtime?.id;
		if (!dnr?.updateSessionRules || !extensionId) return;
		// Content scripts have chrome.runtime but not declarativeNetRequest.
		await dnr.updateSessionRules({
			removeRuleIds: [ORIGIN_RULE_ID],
			addRules: [
				{
					id: ORIGIN_RULE_ID,
					priority: 1,
					action: {
						type: "modifyHeaders",
						requestHeaders: [
							{ header: "origin", operation: "set", value: YT_ORIGIN },
							{ header: "referer", operation: "set", value: `${YT_ORIGIN}/` },
						],
					},
					condition: {
						urlFilter: "||www.youtube.com/youtubei/",
						initiatorDomains: [extensionId],
						resourceTypes: ["xmlhttprequest"],
					},
				},
			],
		});
	})().catch((error: unknown) => {
		console.warn(
			"[GrowTube] could not install the InnerTube origin rule",
			error,
		);
	});
	return originRule;
}

export type InnertubeOptions = {
	client?: InnertubeClient;
	signal?: AbortSignal;
	retries?: number;
};

/**
 * POST https://www.youtube.com/youtubei/v1/{endpoint}. Retries 429/5xx and
 * network errors with exponential backoff.
 */
export async function innertube<T = AnyObj>(
	endpoint: string,
	body: AnyObj,
	opts: InnertubeOptions = {},
): Promise<T> {
	await restoreConfig();
	const clientKey = opts.client ?? "WEB";
	const client = CLIENTS[clientKey];
	const url = new URL(`${YT_ORIGIN}/youtubei/v1/${endpoint}`);
	url.searchParams.set("prettyPrint", "false");
	if (config.apiKey && clientKey === "WEB")
		url.searchParams.set("key", config.apiKey);

	const payload = {
		context: {
			client: {
				...client.context(),
				hl: "en",
				gl: config.gl || "US",
				...(config.visitorData ? { visitorData: config.visitorData } : {}),
			},
			user: { lockedSafetyMode: false },
		},
		...body,
	};
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		"X-Youtube-Client-Name": String(client.id),
		"X-Youtube-Client-Version": client.version(),
	};
	if (config.visitorData) headers["X-Goog-Visitor-Id"] = config.visitorData;

	await ensureOriginRule();
	return limit(() =>
		withRetry(
			async () => {
				let res: Response;
				try {
					res = await fetch(url, {
						method: "POST",
						headers,
						body: JSON.stringify(payload),
						credentials: "omit",
						signal: opts.signal,
					});
				} catch (error) {
					if (opts.signal?.aborted) throw error;
					throw new TypeError(
						`Network error calling YouTube ${endpoint}: ${String(error)}`,
					);
				}
				if (!res.ok) {
					const text = await res.text().catch(() => "");
					throw new HttpError(
						res.status,
						`YouTube ${endpoint} responded ${res.status}`,
						text.slice(0, 500),
						parseRetryAfter(res.headers.get("retry-after")),
					);
				}
				const json = (await res.json()) as AnyObj;
				captureVisitorData(json);
				return json as T;
			},
			{ retries: opts.retries ?? 3, signal: opts.signal },
		),
	).catch((error: unknown) => {
		throw toYouTubeError(error, endpoint);
	});
}

function captureVisitorData(json: AnyObj) {
	if (config.visitorData) return;
	const vd = json?.responseContext?.visitorData;
	if (typeof vd === "string" && vd.length > 10)
		config = { ...config, visitorData: vd };
}

function toYouTubeError(error: unknown, endpoint: string): unknown {
	if (error instanceof YouTubeError) return error;
	if (error instanceof HttpError) {
		if (error.status === 404)
			return new YouTubeError("NOT_FOUND", error.message, 404);
		if (error.status === 429) {
			return new YouTubeError(
				"RATE_LIMITED",
				"YouTube is rate limiting requests. Try again in a minute.",
				429,
			);
		}
		return new YouTubeError("HTTP", error.message, error.status);
	}
	if (error instanceof TypeError)
		return new YouTubeError("NETWORK", error.message);
	if (isObj(error) && (error as { name?: string }).name === "AbortError")
		return error;
	return new YouTubeError("PARSE", `YouTube ${endpoint}: ${String(error)}`);
}

/** Plain GET with the same limiter/retry policy (timedtext, suggestions…). */
export async function ytFetch(
	input: string,
	init: RequestInit & { retries?: number } = {},
): Promise<Response> {
	const { retries, ...rest } = init;
	return limit(() =>
		withRetry(
			async () => {
				let res: Response;
				try {
					res = await fetch(input, { credentials: "omit", ...rest });
				} catch (error) {
					if (rest.signal?.aborted) throw error;
					throw new TypeError(`Network error: ${String(error)}`);
				}
				if (!res.ok) {
					throw new HttpError(
						res.status,
						`GET ${new URL(input).pathname} responded ${res.status}`,
						"",
						parseRetryAfter(res.headers.get("retry-after")),
					);
				}
				return res;
			},
			{ retries: retries ?? 2, signal: rest.signal ?? undefined },
		),
	).catch((error: unknown) => {
		throw toYouTubeError(error, new URL(input).pathname);
	});
}
