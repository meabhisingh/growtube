/**
 * TTL cache: in-memory LRU + optional chrome.storage.local persistence, with
 * in-flight request de-duplication.
 *
 * The persistent layer is owned by the background service worker (every
 * YouTube/server call is routed there), so one cache serves every tab. In
 * other contexts (or in Node, for scripts/live-check.ts) it degrades to
 * memory-only.
 */
import { browser } from "wxt/browser";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Default TTLs used by lib/youtube and lib/api. */
export const TTL = {
	videoDetails: 10 * MINUTE,
	channel: 6 * HOUR,
	channelVideos: 1 * HOUR,
	baseline: 6 * HOUR,
	search: 30 * MINUTE,
	suggestions: 24 * HOUR,
	transcript: 24 * HOUR,
	serverHistory: 10 * MINUTE,
	trending: 10 * MINUTE,
} as const;

type Entry = { v: unknown; exp: number };
/** index value: [expiresAt, lastAccess, approxBytes] */
type IndexRow = [number, number, number];

const MEM_MAX_ENTRIES = 500;
const PERSIST_MAX_ENTRIES = 2_000;
const PERSIST_MAX_BYTES = 40 * 1024 * 1024;
/** Expired entries are kept this long as a fallback when a refresh fails. */
const STALE_GRACE_MS = 3 * 24 * HOUR;
const STORAGE_PREFIX = "ovq:cache:";
const INDEX_KEY = "ovq:cache-index";

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

type LocalArea = {
	get(keys: string | string[] | null): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(keys: string | string[]): Promise<void>;
};

function localArea(): LocalArea | null {
	try {
		// `browser` is undefined outside extension contexts (e.g. Node scripts)
		const area = (
			browser as unknown as { storage?: { local?: LocalArea } } | undefined
		)?.storage?.local;
		return area ?? null;
	} catch {
		return null;
	}
}

function memGet(key: string): Entry | undefined {
	const e = mem.get(key);
	if (!e) return undefined;
	// refresh LRU position
	mem.delete(key);
	mem.set(key, e);
	return e;
}

function memSet(key: string, entry: Entry) {
	mem.delete(key);
	mem.set(key, entry);
	while (mem.size > MEM_MAX_ENTRIES) {
		const oldest = mem.keys().next().value;
		if (oldest === undefined) break;
		mem.delete(oldest);
	}
}

// ---------------------------------------------------------------------------
// Persistent index (LRU-ish pruning)
// ---------------------------------------------------------------------------

let indexPromise: Promise<Map<string, IndexRow>> | null = null;
let indexSaveTimer: ReturnType<typeof setTimeout> | null = null;

function loadIndex(area: LocalArea): Promise<Map<string, IndexRow>> {
	if (!indexPromise) {
		indexPromise = area
			.get(INDEX_KEY)
			.then((r) => {
				const raw = r[INDEX_KEY];
				return new Map<string, IndexRow>(
					raw && typeof raw === "object"
						? Object.entries(raw as Record<string, IndexRow>)
						: [],
				);
			})
			.catch(() => new Map<string, IndexRow>());
	}
	return indexPromise;
}

function scheduleIndexSave(area: LocalArea) {
	if (indexSaveTimer) return;
	indexSaveTimer = setTimeout(async () => {
		indexSaveTimer = null;
		const index = await loadIndex(area);
		await prune(area, index);
		await area.set({ [INDEX_KEY]: Object.fromEntries(index) }).catch(() => {});
	}, 1_000);
}

async function prune(area: LocalArea, index: Map<string, IndexRow>) {
	const now = Date.now();
	const doomed: string[] = [];
	let bytes = 0;
	for (const [key, [exp, , size]] of index) {
		if (exp + STALE_GRACE_MS < now) doomed.push(key);
		else bytes += size;
	}
	for (const key of doomed) index.delete(key);
	if (index.size > PERSIST_MAX_ENTRIES || bytes > PERSIST_MAX_BYTES) {
		// Least-recently-accessed first, until we're at 80% of the limits.
		const byAccess = [...index.entries()].sort((a, b) => a[1][1] - b[1][1]);
		for (const [key, [, , size]] of byAccess) {
			if (
				index.size <= PERSIST_MAX_ENTRIES * 0.8 &&
				bytes <= PERSIST_MAX_BYTES * 0.8
			)
				break;
			index.delete(key);
			bytes -= size;
			doomed.push(key);
		}
	}
	if (doomed.length) {
		await area.remove(doomed.map((k) => STORAGE_PREFIX + k)).catch(() => {});
	}
}

async function persistGet(key: string): Promise<Entry | undefined> {
	const area = localArea();
	if (!area) return undefined;
	try {
		const r = await area.get(STORAGE_PREFIX + key);
		const e = r[STORAGE_PREFIX + key] as Entry | undefined;
		if (!e || typeof e.exp !== "number") return undefined;
		const index = await loadIndex(area);
		const row = index.get(key);
		if (row) {
			row[1] = Date.now();
			scheduleIndexSave(area);
		}
		return e;
	} catch {
		return undefined;
	}
}

async function persistSet(key: string, entry: Entry) {
	const area = localArea();
	if (!area) return;
	try {
		const size = JSON.stringify(entry.v)?.length ?? 0;
		await area.set({ [STORAGE_PREFIX + key]: entry });
		const index = await loadIndex(area);
		index.set(key, [entry.exp, Date.now(), size]);
		scheduleIndexSave(area);
	} catch {
		// Quota or serialization problems must never break the caller.
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CacheReadOptions = {
	/** Also store in chrome.storage.local (default true) */
	persist?: boolean;
	/** Skip fresh cached values and reload (in-flight requests are still shared) */
	force?: boolean;
	/** Return an expired value if the loader fails (default true) */
	staleOnError?: boolean;
};

/** Returns a fresh cached value or undefined. */
export async function cacheGet<T>(
	key: string,
	opts: { persist?: boolean } = {},
): Promise<T | undefined> {
	const now = Date.now();
	const m = memGet(key);
	if (m && m.exp > now) return m.v as T;
	if (opts.persist === false) return undefined;
	const p = await persistGet(key);
	if (p && p.exp > now) {
		memSet(key, p);
		return p.v as T;
	}
	return undefined;
}

export async function cacheSet<T>(
	key: string,
	value: T,
	ttlMs: number,
	opts: { persist?: boolean } = {},
): Promise<void> {
	const entry: Entry = { v: value, exp: Date.now() + ttlMs };
	memSet(key, entry);
	if (opts.persist !== false) await persistSet(key, entry);
}

export async function cacheDelete(key: string): Promise<void> {
	mem.delete(key);
	const area = localArea();
	if (!area) return;
	await area.remove(STORAGE_PREFIX + key).catch(() => {});
	const index = await loadIndex(area);
	if (index.delete(key)) scheduleIndexSave(area);
}

/** Clears every cache entry (optionally only keys starting with `prefix`). */
export async function cacheClear(prefix = ""): Promise<number> {
	let removed = 0;
	for (const key of [...mem.keys()]) {
		if (key.startsWith(prefix)) {
			mem.delete(key);
			removed++;
		}
	}
	const area = localArea();
	if (!area) return removed;
	const index = await loadIndex(area);
	const keys = [...index.keys()].filter((k) => k.startsWith(prefix));
	for (const k of keys) index.delete(k);
	await area.remove(keys.map((k) => STORAGE_PREFIX + k)).catch(() => {});
	await area.set({ [INDEX_KEY]: Object.fromEntries(index) }).catch(() => {});
	return Math.max(removed, keys.length);
}

/**
 * Read-through cache with in-flight de-duplication: concurrent calls for the
 * same key share one loader invocation.
 */
export async function cached<T>(
	key: string,
	ttlMs: number,
	loader: () => Promise<T>,
	opts: CacheReadOptions = {},
): Promise<T> {
	const persist = opts.persist !== false;
	if (!opts.force) {
		const hit = await cacheGet<T>(key, { persist });
		if (hit !== undefined) return hit;
	}
	const pending = inflight.get(key);
	if (pending) return pending as Promise<T>;
	const run = (async () => {
		try {
			const value = await loader();
			await cacheSet(key, value, ttlMs, { persist });
			return value;
		} catch (error) {
			if (opts.staleOnError !== false) {
				const stale =
					mem.get(key) ?? (persist ? await persistGet(key) : undefined);
				if (stale && stale.exp + STALE_GRACE_MS > Date.now())
					return stale.v as T;
			}
			throw error;
		} finally {
			inflight.delete(key);
		}
	})();
	inflight.set(key, run);
	return run;
}

/** Short stable hash (53-bit cyrb53) for long cache-key parts like continuation tokens. */
export function hashKey(input: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Shares one in-flight promise per key without caching the result. */
export function dedupe<T>(key: string, loader: () => Promise<T>): Promise<T> {
	const pending = inflight.get(`dedupe:${key}`);
	if (pending) return pending as Promise<T>;
	const run = loader().finally(() => inflight.delete(`dedupe:${key}`));
	inflight.set(`dedupe:${key}`, run);
	return run;
}
