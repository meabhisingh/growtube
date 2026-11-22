/**
 * open-vidiq server client. BACKGROUND ONLY (service worker): content scripts
 * and pages call these through `server` in `@/lib/client`, which avoids CORS
 * and Chrome's private-network checks for http://localhost.
 *
 * Every /v1 call needs an account: it carries `Authorization: Bearer <token>`
 * (lib/auth-session.ts). Signed out, nothing is sent at all (only the public
 * /health check) and the ingest queue is dropped and stays empty. A 401
 * `AUTH_REQUIRED` answer signs the user out locally.
 *
 * Only public videos ever reach the server (see lib/youtube/visibility.ts).
 * Every response is validated with the shared zod schemas.
 */

import {
	API_ROUTES,
	type ChannelHistoryResponse,
	type ChannelSnapshotInput,
	channelHistoryResponse,
	channelSnapshotInput,
	type HistoryRange,
	type IngestResponse,
	ingestResponse,
	MAX_VIDEO_STATS_IDS,
	type TrendingQuery,
	type TrendingResponse,
	trendingResponse,
	type VideoHistoryResponse,
	type VideoSnapshotInput,
	type VideoStatsResponse,
	videoHistoryResponse,
	videoSnapshotInput,
	videoStatsPath,
	videoStatsResponse,
} from "@open-vidiq/shared";
import { isAuthRequiredError } from "@open-vidiq/shared/auth";
import { browser } from "wxt/browser";
import type { z } from "zod";

import { bearerFor, hasSession, onSessionRejected } from "./auth-session";
import { cached, TTL } from "./cache";
import { HttpError, withRetry } from "./limiter";
import { hasOriginPermission, originOf } from "./permissions";
import { crowdsourceStats, serverUrl } from "./settings";
import type { ChannelInfo, SearchResult, VideoDetails } from "./youtube/types";
import { isPublicVideo } from "./youtube/visibility";

export class ServerError extends Error {
	readonly status: number | null;
	readonly code:
		| "NETWORK"
		| "HTTP"
		| "INVALID_RESPONSE"
		| "PERMISSION"
		| "AUTH_REQUIRED"
		| "PRIVATE_VIDEO";
	constructor(
		code: ServerError["code"],
		message: string,
		status: number | null = null,
	) {
		super(message);
		this.name = "ServerError";
		this.code = code;
		this.status = status;
	}
}

async function baseUrl(): Promise<string> {
	return (await serverUrl.getValue()).replace(/\/+$/, "");
}

/**
 * Cache key of a server answer. It names the server: an answer still in
 * flight when the user switches servers (or signs out) lands under the old
 * server's key after `cacheClear("srv:")`, and is never served for the new
 * one.
 */
const srvKey = (base: string, key: string) => `srv:${base}|${key}`;

const signInRequired = () =>
	new ServerError(
		"AUTH_REQUIRED",
		"Sign in to open-vidiq to use history, trends and live stats (Settings → Account).",
		401,
	);

/** 401 with `{ code: "AUTH_REQUIRED" }`: the server no longer knows the session. */
function isSessionRejected(error: HttpError): boolean {
	if (error.status !== 401) return false;
	try {
		return isAuthRequiredError(JSON.parse(error.body));
	} catch {
		return false;
	}
}

async function request<S extends z.ZodType>(
	path: string,
	schema: S,
	init: RequestInit & { retries?: number; base?: string } = {},
): Promise<z.infer<S>> {
	const { retries, base: knownBase, ...rest } = init;
	// Callers that built a cache key from the base pass it, so the key and
	// the request always name the same server.
	const base = knownBase ?? (await baseUrl());
	const url = `${base}${path}`;
	const token = await bearerFor(base);
	if (!token) throw signInRequired();
	if (!(await hasOriginPermission(base))) {
		throw new ServerError(
			"PERMISSION",
			`open-vidiq needs permission to reach ${originOf(base) ?? base}. Open Settings and save the server URL to grant it.`,
		);
	}
	const res = await withRetry(
		async () => {
			let r: Response;
			try {
				r = await fetch(url, {
					...rest,
					headers: {
						Accept: "application/json",
						...(rest.headers ?? {}),
						Authorization: `Bearer ${token}`,
					},
					credentials: "omit",
				});
			} catch (error) {
				throw new TypeError(String(error));
			}
			if (!r.ok) {
				const body = await r.text().catch(() => "");
				let message = `Server responded ${r.status}`;
				try {
					const parsed = JSON.parse(body) as { error?: string };
					if (parsed.error) message = parsed.error;
				} catch {
					// not JSON
				}
				throw new HttpError(r.status, message, body.slice(0, 500));
			}
			return r;
		},
		{ retries: retries ?? 2 },
	).catch(async (error: unknown) => {
		if (error instanceof HttpError && isSessionRejected(error)) {
			await onSessionRejected(token);
			throw new ServerError(
				"AUTH_REQUIRED",
				"Your open-vidiq session has ended. Sign in again (Settings → Account).",
				401,
			);
		}
		if (error instanceof HttpError)
			throw new ServerError("HTTP", error.message, error.status);
		throw new ServerError(
			"NETWORK",
			`Can't reach the open-vidiq server at ${base}. Check Settings → Server URL.`,
		);
	});
	const json: unknown = await res.json().catch(() => null);
	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		throw new ServerError(
			"INVALID_RESPONSE",
			`Unexpected response from ${path}`,
			res.status,
		);
	}
	return parsed.data;
}

// ---------------------------------------------------------------------------
// Videos that must never reach the server
// ---------------------------------------------------------------------------

/**
 * Ids the background saw as unlisted or private. They are never uploaded
 * and never looked up (stats / history), even when a caller asks for them.
 * Kept in storage.session too (debounced), so a service-worker restart
 * doesn't forget them; every path also checks the details itself.
 */
const restrictedVideoIds = new Set<string>();
const MAX_RESTRICTED = 5_000;
const RESTRICTED_KEY = "ovqRestrictedVideoIds";
let restrictedLoading: Promise<void> | null = null;
let restrictedSaveTimer: ReturnType<typeof setTimeout> | null = null;

function addRestricted(videoId: string) {
	restrictedVideoIds.delete(videoId);
	restrictedVideoIds.add(videoId);
	while (restrictedVideoIds.size > MAX_RESTRICTED) {
		const oldest = restrictedVideoIds.values().next().value;
		if (oldest === undefined) break;
		restrictedVideoIds.delete(oldest);
	}
}

/** Loads the ids remembered before a worker restart (once). */
function loadRestricted(): Promise<void> {
	restrictedLoading ??= (async () => {
		const raw: Record<string, unknown> =
			(await sessionArea()
				?.get(RESTRICTED_KEY)
				.catch(() => ({}))) ?? {};
		const stored = raw[RESTRICTED_KEY];
		if (!Array.isArray(stored)) return;
		// Ids noted since startup are newer than the stored ones.
		const newer = [...restrictedVideoIds];
		restrictedVideoIds.clear();
		for (const id of [...stored, ...newer])
			if (typeof id === "string") addRestricted(id);
	})();
	return restrictedLoading;
}

function saveRestrictedSoon() {
	if (restrictedSaveTimer) return;
	restrictedSaveTimer = setTimeout(() => {
		restrictedSaveTimer = null;
		void loadRestricted().then(() =>
			sessionArea()
				?.set({ [RESTRICTED_KEY]: [...restrictedVideoIds] })
				.catch(() => {}),
		);
	}, SAVE_DELAY_MS);
}

export function markVideoRestricted(videoId: string): void {
	if (restrictedVideoIds.has(videoId)) return;
	addRestricted(videoId);
	saveRestrictedSoon();
}

/** Sync check; async callers `await loadRestricted()` first. */
export const isVideoRestricted = (videoId: string) =>
	restrictedVideoIds.has(videoId);

// Background start: bring back the ids remembered before a restart.
void loadRestricted();

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getVideoHistory(
	videoId: string,
	range: HistoryRange = "24h",
	opts: { force?: boolean } = {},
): Promise<VideoHistoryResponse> {
	await loadRestricted();
	if (isVideoRestricted(videoId))
		throw new ServerError(
			"PRIVATE_VIDEO",
			"View history isn't available for unlisted or private videos.",
		);
	const base = await baseUrl();
	return cached(
		srvKey(base, `vh:${videoId}:${range}`),
		TTL.serverHistory,
		() =>
			request(
				`${API_ROUTES.videoHistory(videoId)}?range=${encodeURIComponent(range)}`,
				videoHistoryResponse,
				{ base },
			),
		{ persist: false, force: opts.force },
	);
}

export async function getChannelHistory(
	channelId: string,
	opts: { force?: boolean } = {},
): Promise<ChannelHistoryResponse> {
	const base = await baseUrl();
	return cached(
		srvKey(base, `ch:${channelId}`),
		TTL.serverHistory,
		() =>
			request(API_ROUTES.channelHistory(channelId), channelHistoryResponse, {
				base,
			}),
		{ persist: false, force: opts.force },
	);
}

export async function getTrending(
	query: Partial<TrendingQuery> = {},
	opts: { force?: boolean } = {},
): Promise<TrendingResponse> {
	const params = new URLSearchParams();
	if (query.window) params.set("window", query.window);
	if (query.type) params.set("type", query.type);
	if (query.q?.trim()) params.set("q", query.q.trim());
	if (query.limit) params.set("limit", String(query.limit));
	const qs = params.toString();
	const base = await baseUrl();
	return cached(
		srvKey(base, `trending:${qs}`),
		TTL.trending,
		() =>
			request(`${API_ROUTES.trending}${qs ? `?${qs}` : ""}`, trendingResponse, {
				base,
			}),
		{ persist: false, force: opts.force },
	);
}

/** Latest server-side stats (incl. recent VPH) for up to any number of ids (chunked by 50). */
export async function getVideosStats(
	videoIds: string[],
): Promise<VideoStatsResponse> {
	await loadRestricted();
	const unique = [...new Set(videoIds)];
	// Restricted ids are reported as unknown without asking the server.
	const restricted = unique.filter(isVideoRestricted);
	const ids = unique.filter((id) => !isVideoRestricted(id));
	const chunks: string[][] = [];
	for (let i = 0; i < ids.length; i += MAX_VIDEO_STATS_IDS) {
		chunks.push(ids.slice(i, i + MAX_VIDEO_STATS_IDS));
	}
	if (!chunks.length)
		return {
			generatedAt: new Date().toISOString(),
			videos: [],
			missing: restricted,
		};
	const base = await baseUrl();
	const parts = await Promise.all(
		chunks.map((chunk) =>
			cached(
				srvKey(base, `stats:${chunk.join(",")}`),
				60_000,
				() => request(videoStatsPath(chunk), videoStatsResponse, { base }),
				{
					persist: false,
				},
			),
		),
	);
	return {
		generatedAt: parts[0]?.generatedAt ?? new Date().toISOString(),
		videos: parts.flatMap((p) => p.videos),
		missing: [...parts.flatMap((p) => p.missing), ...restricted],
	};
}

export async function health(): Promise<{
	ok: boolean;
	serverUrl: string;
	error?: string;
}> {
	const base = await baseUrl();
	try {
		const res = await fetch(`${base}${API_ROUTES.health}`, {
			credentials: "omit",
		});
		return {
			ok: res.ok,
			serverUrl: base,
			...(res.ok ? {} : { error: `HTTP ${res.status}` }),
		};
	} catch (error) {
		return { ok: false, serverUrl: base, error: String(error) };
	}
}

// ---------------------------------------------------------------------------
// Ingest queue (batched, debounced; survives service-worker restarts)
// ---------------------------------------------------------------------------
//
// The queue must stay cheap when nobody is listening: it is capped (oldest
// entries dropped), persisted with a debounce, and after failed flushes it
// backs off exponentially. While the server is known to be unreachable (or
// not permitted) new snapshots are not queued at all until a retry succeeds.
// Signed out, it is empty: nothing is queued and anything left is dropped.

const FLUSH_DELAY_MS = 5_000;
const BATCH_SIZE = 50;
/** Don't re-send the same video more often than this. */
const RESEND_AFTER_MS = 10 * 60_000;
const MAX_QUEUED_VIDEOS = 3_000;
const MAX_QUEUED_CHANNELS = 1_000;
const SAVE_DELAY_MS = 1_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/** Consecutive failed flushes after which the server counts as down. */
const DOWN_AFTER_FAILURES = 2;
const LAST_SENT_MAX = 10_000;
const QUEUE_KEY = "ovqIngestQueue";
export const INGEST_ALARM = "ovq:ingest-flush";

type StoredQueue = {
	videos?: VideoSnapshotInput[];
	channels?: ChannelSnapshotInput[];
	failures?: number;
	backoffUntil?: number;
};

/** Insertion-ordered (oldest first); re-reporting an id moves it to the end. */
const videoQueue = new Map<string, VideoSnapshotInput>();
const channelQueue = new Map<string, ChannelSnapshotInput>();
let failures = 0;
let backoffUntil = 0;
let loading: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;
const lastSent = new Map<string, number>();

type SessionArea = {
	get(key: string): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
};

function sessionArea(): SessionArea | null {
	return (
		(browser as unknown as { storage?: { session?: SessionArea } } | undefined)
			?.storage?.session ?? null
	);
}

/** Inserts/moves `id` to the newest end, dropping the oldest beyond `max`. */
function put<T>(map: Map<string, T>, id: string, item: T, max: number) {
	map.delete(id);
	map.set(id, item);
	while (map.size > max) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

function loadQueue(): Promise<void> {
	loading ??= (async () => {
		const raw: Record<string, unknown> =
			(await sessionArea()
				?.get(QUEUE_KEY)
				.catch(() => ({}))) ?? {};
		const stored = raw[QUEUE_KEY] as StoredQueue | undefined;
		if (!stored) return;
		// Stored entries are older than anything queued since startup.
		const newerVideos = [...videoQueue.values()];
		const newerChannels = [...channelQueue.values()];
		videoQueue.clear();
		channelQueue.clear();
		for (const v of [...(stored.videos ?? []), ...newerVideos])
			put(videoQueue, v.videoId, v, MAX_QUEUED_VIDEOS);
		for (const c of [...(stored.channels ?? []), ...newerChannels])
			put(channelQueue, c.channelId, c, MAX_QUEUED_CHANNELS);
		failures = Math.max(failures, stored.failures ?? 0);
		backoffUntil = Math.max(backoffUntil, stored.backoffUntil ?? 0);
	})();
	return loading;
}

async function saveNow() {
	if (saveTimer) clearTimeout(saveTimer);
	saveTimer = null;
	const state: StoredQueue = {
		videos: [...videoQueue.values()],
		channels: [...channelQueue.values()],
		failures,
		backoffUntil,
	};
	await sessionArea()
		?.set({ [QUEUE_KEY]: state })
		.catch(() => {});
}

/** Coalesces storage writes: at most one serialization per second. */
function scheduleSave() {
	if (saveTimer) return;
	saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS);
}

const inBackoff = () => Date.now() < backoffUntil;
/** The last flushes failed and the retry delay hasn't passed yet. */
const serverDown = () => failures >= DOWN_AFTER_FAILURES && inBackoff();

function schedule() {
	if (inBackoff()) return; // the alarm retries once the backoff is over
	if (videoQueue.size >= BATCH_SIZE || channelQueue.size >= BATCH_SIZE) {
		void flushIngestQueue();
		return;
	}
	if (flushTimer) return;
	flushTimer = setTimeout(() => {
		flushTimer = null;
		void flushIngestQueue();
	}, FLUSH_DELAY_MS);
}

function recentlySent(id: string, now: number): boolean {
	return (lastSent.get(id) ?? 0) + RESEND_AFTER_MS > now;
}

function markSent(ids: string[], now: number) {
	for (const id of ids) {
		lastSent.delete(id);
		lastSent.set(id, now);
	}
	while (lastSent.size > LAST_SENT_MAX) {
		const oldest = lastSent.keys().next().value;
		if (oldest === undefined) break;
		lastSent.delete(oldest);
	}
}

const clip = (s: string | null | undefined, max: number) =>
	s ? (s.length > max ? s.slice(0, max) : s) : undefined;

/** Nothing is queued while signed out or opted out. */
async function mayQueue(): Promise<boolean> {
	return (await crowdsourceStats.getValue()) && (await hasSession());
}

/**
 * Queues crowdsourced video snapshots (no-op when signed out, opted out or
 * the server is down). Snapshots of restricted videos are dropped.
 */
export async function ingestVideos(
	videos: VideoSnapshotInput[],
): Promise<{ queued: number }> {
	if (!videos.length || !(await mayQueue())) return { queued: 0 };
	await Promise.all([loadQueue(), loadRestricted()]);
	if (serverDown()) return { queued: 0 };
	const now = Date.now();
	let queued = 0;
	for (const raw of videos) {
		if (isVideoRestricted(raw.videoId)) continue;
		const parsed = videoSnapshotInput.safeParse({
			...raw,
			title: clip(raw.title, 300),
			channelTitle: clip(raw.channelTitle, 200),
		});
		if (!parsed.success) continue;
		const v = parsed.data;
		if (recentlySent(v.videoId, now)) continue;
		put(videoQueue, v.videoId, v, MAX_QUEUED_VIDEOS);
		queued++;
	}
	if (queued) {
		scheduleSave();
		schedule();
	}
	return { queued };
}

/** Queues crowdsourced channel snapshots (no-op when signed out, opted out or the server is down). */
export async function ingestChannels(
	channels: ChannelSnapshotInput[],
): Promise<{ queued: number }> {
	if (!channels.length || !(await mayQueue())) return { queued: 0 };
	await loadQueue();
	if (serverDown()) return { queued: 0 };
	const now = Date.now();
	let queued = 0;
	for (const raw of channels) {
		const parsed = channelSnapshotInput.safeParse({
			...raw,
			handle: clip(raw.handle, 100),
			title: clip(raw.title, 200),
			country: clip(raw.country, 80),
			keywords: raw.keywords?.slice(0, 100).map((k) => k.slice(0, 100)),
		});
		if (!parsed.success) continue;
		const c = parsed.data;
		if (recentlySent(c.channelId, now)) continue;
		put(channelQueue, c.channelId, c, MAX_QUEUED_CHANNELS);
		queued++;
	}
	if (queued) {
		scheduleSave();
		schedule();
	}
	return { queued };
}

async function post(path: string, body: unknown): Promise<IngestResponse> {
	return request(path, ingestResponse, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		retries: 1,
	});
}

/**
 * A 4xx rejects that batch's content, not the server. Not 401/403 (the
 * session) and not 429 (rate limit): those stop the whole flush.
 */
function isBatchRejected(error: unknown): boolean {
	return (
		error instanceof ServerError &&
		error.code === "HTTP" &&
		error.status != null &&
		error.status >= 400 &&
		error.status < 500 &&
		error.status !== 401 &&
		error.status !== 403 &&
		error.status !== 429
	);
}

async function sendBatches<T>(
	queue: Map<string, T>,
	path: string,
	wrap: (batch: T[]) => unknown,
): Promise<void> {
	while (queue.size) {
		const entries = [...queue.entries()].slice(0, BATCH_SIZE);
		const ids = entries.map(([id]) => id);
		try {
			await post(path, wrap(entries.map(([, item]) => item)));
		} catch (error) {
			// Drop only the rejected batch so one bad item can't wedge the queue.
			if (!isBatchRejected(error)) throw error;
			console.debug(
				"[open-vidiq] ingest batch rejected:",
				error instanceof Error ? error.message : error,
			);
		}
		markSent(ids, Date.now());
		for (const id of ids) queue.delete(id);
		scheduleSave();
	}
}

/**
 * Sends everything queued, 50 at a time. Safe to call often (alarm, idle):
 * while backing off after failures it does nothing unless `force` is set.
 */
export async function flushIngestQueue(
	opts: { force?: boolean } = {},
): Promise<void> {
	if (flushing) return flushing;
	flushing = (async () => {
		try {
			await loadQueue();
			if (!(await mayQueue())) {
				// Opted out or signed out: nothing is kept for later.
				if (videoQueue.size || channelQueue.size) {
					videoQueue.clear();
					channelQueue.clear();
					await saveNow();
				}
				return;
			}
			if (!videoQueue.size && !channelQueue.size) return;
			if (inBackoff() && !opts.force) return;
			await sendBatches(videoQueue, API_ROUTES.ingestVideos, (videos) => ({
				videos,
			}));
			await sendBatches(
				channelQueue,
				API_ROUTES.ingestChannels,
				(channels) => ({
					channels,
				}),
			);
			failures = 0;
			backoffUntil = 0;
			await saveNow();
		} catch (error) {
			if (error instanceof ServerError && error.code === "AUTH_REQUIRED") {
				// Signed out (or the server ended the session): drop everything.
				clearQueueState();
				await saveNow();
				return;
			}
			// Unreachable, not permitted, 5xx or 429: keep the queue, back off.
			failures++;
			backoffUntil =
				Date.now() +
				Math.min(BACKOFF_BASE_MS * 2 ** (failures - 1), BACKOFF_MAX_MS);
			scheduleSave();
			console.debug(
				"[open-vidiq] ingest flush deferred:",
				error instanceof Error ? error.message : error,
			);
		} finally {
			flushing = null;
		}
	})();
	return flushing;
}

/**
 * Forgets past failures and retries now. Call when the server URL or its
 * host permission changes, so ingestion resumes without waiting out the
 * backoff.
 */
export async function resetIngestBackoff(): Promise<void> {
	await loadQueue();
	failures = 0;
	backoffUntil = 0;
	scheduleSave();
	await flushIngestQueue({ force: true });
}

/** Sign-out, a 401 and a server switch: the next server starts from scratch. */
function clearQueueState() {
	videoQueue.clear();
	channelQueue.clear();
	// Ids sent to the previous server (or account) must not be skipped as
	// "recently sent" for the next one.
	lastSent.clear();
	failures = 0;
	backoffUntil = 0;
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = null;
}

/** Sign-out: forgets everything queued (memory and storage.session). */
export async function dropIngestQueue(): Promise<void> {
	await loadQueue();
	clearQueueState();
	await saveNow();
}

export async function pendingIngestCount(): Promise<number> {
	await loadQueue();
	return videoQueue.size + channelQueue.size;
}

// ---------------------------------------------------------------------------
// Snapshot builders from lib/youtube types
// ---------------------------------------------------------------------------

/** null for upcoming, unlisted, private or unknown-listing videos. */
export function snapshotFromVideo(d: VideoDetails): VideoSnapshotInput | null {
	if (!d.videoId || d.isUpcoming || !isPublicVideo(d)) return null;
	if (isVideoRestricted(d.videoId)) return null;
	return {
		videoId: d.videoId,
		channelId: d.channelId || undefined,
		title: d.title || undefined,
		channelTitle: d.channelTitle || undefined,
		publishedAt: d.publishedAt ?? undefined,
		durationSec: d.durationSec || undefined,
		isShort: d.isShort,
		views: d.views,
		likes: d.likes ?? undefined,
		comments: d.commentsExact ? (d.comments ?? undefined) : undefined,
	};
}

/** Only search results whose view count is exact ("6,387 views"). */
export function snapshotFromSearchResult(
	r: SearchResult,
): VideoSnapshotInput | null {
	if (!r.viewsExact || r.views == null || r.isLive) return null;
	if (isVideoRestricted(r.videoId)) return null;
	return {
		videoId: r.videoId,
		channelId: r.channelId ?? undefined,
		title: r.title || undefined,
		channelTitle: r.channelTitle ?? undefined,
		durationSec: r.durationSec ?? undefined,
		isShort: r.isShort,
		views: r.views,
	};
}

export function snapshotFromChannel(c: ChannelInfo): ChannelSnapshotInput {
	return {
		channelId: c.channelId,
		handle: c.handle ?? undefined,
		title: c.title || undefined,
		avatarUrl: c.avatarUrl ?? undefined,
		subscribers: c.subscribers ?? undefined,
		totalViews: c.totalViews ?? undefined,
		videoCount: c.videoCount ?? undefined,
		joinedAt: c.joinedAt ?? undefined,
		country: c.country ?? undefined,
		keywords: c.keywords.length ? c.keywords : undefined,
	};
}
