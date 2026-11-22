import type { Redis } from "ioredis";

import { tryRedis } from "./redis";

/** Redis cache keys (the client adds the global `ovq:` prefix). */
export const cacheKeys = {
	videoHistory: (videoId: string, range: string) =>
		`cache:vh:${videoId}:${range}`,
	channelHistory: (channelId: string) => `cache:ch:${channelId}`,
	trending: (normalizedQuery: string) => `cache:tr:${normalizedQuery}`,
} as const;

export type Cached<T> = { value: T; hit: boolean };

/**
 * Read-through JSON cache. Redis failures degrade to an uncached load; a
 * corrupt entry is treated as a miss and overwritten.
 */
export async function cachedJson<T>(
	redis: Redis,
	key: string,
	ttlSeconds: number,
	load: () => Promise<T>,
): Promise<Cached<T>> {
	const hit = await tryRedis(() => redis.get(key));
	if (hit.ok && hit.value != null) {
		try {
			return { value: JSON.parse(hit.value) as T, hit: true };
		} catch {
			// fall through and refresh the entry
		}
	}
	const value = await load();
	if (hit.ok) {
		// Only write back when Redis answered the read: don't wait on a dead
		// server twice in one request.
		await tryRedis(() =>
			redis.set(key, JSON.stringify(value), "EX", ttlSeconds),
		);
	}
	return { value, hit: false };
}

/** Best-effort invalidation; a stale entry expires on its own anyway. */
export async function invalidate(redis: Redis, keys: string[]): Promise<void> {
	if (keys.length === 0) return;
	await tryRedis(() => redis.del(...keys));
}
