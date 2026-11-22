import { Redis } from "ioredis";

export type RedisConfig = {
	REDIS_URL: string;
};

/** Every key this app writes is namespaced so it can share a Redis instance. */
export const REDIS_KEY_PREFIX = "ovq:";

/** Redis is an optimization (cache, throttles, rate limits), never a hard dependency. */
const REDIS_OP_TIMEOUT_MS = 1_500;

/**
 * Creates an ioredis client over TCP (via `nodejs_compat` sockets on Workers).
 *
 * On Cloudflare Workers, sockets can't be shared across requests, so create
 * one client per request and release it with `closeRedis()` when done.
 * `lazyConnect` means no socket is opened until the first command.
 */
export function createRedis(env: RedisConfig) {
	const redis = new Redis(env.REDIS_URL, {
		lazyConnect: true,
		keyPrefix: REDIS_KEY_PREFIX,
		connectTimeout: 3_000,
		maxRetriesPerRequest: 1,
		// One connection per request: skip the INFO ready check and the two
		// CLIENT SETINFO calls, which cost a round trip (and Upstash commands)
		// before every first command.
		enableReadyCheck: false,
		disableClientInfo: true,
		// Give up quickly instead of reconnecting forever inside one request.
		retryStrategy: (times) => (times > 2 ? null : times * 100),
	});
	// Errors surface through the failing command (see `tryRedis`); without a
	// listener ioredis would also log every connection error as unhandled.
	redis.on("error", () => {});
	return redis;
}

/** Gracefully closes the client if it ever connected; no-op otherwise. */
export async function closeRedis(redis: Redis) {
	if (redis.status === "wait" || redis.status === "end") return;
	if (redis.status !== "ready") {
		redis.disconnect();
		return;
	}
	try {
		await redis.quit();
	} catch {
		redis.disconnect();
	}
}

export type RedisResult<T> =
	| { ok: true; value: T }
	| { ok: false; error: unknown };

/**
 * Runs a Redis operation with a short timeout and never throws: callers get
 * `{ ok: false }` when Redis is down or slow and fall back (fail open).
 */
export async function tryRedis<T>(
	op: () => Promise<T>,
	timeoutMs = REDIS_OP_TIMEOUT_MS,
): Promise<RedisResult<T>> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const value = await Promise.race([
			op(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`redis timeout after ${timeoutMs}ms`)),
					timeoutMs,
				);
			}),
		]);
		return { ok: true, value };
	} catch (error) {
		return { ok: false, error };
	} finally {
		clearTimeout(timer);
	}
}
