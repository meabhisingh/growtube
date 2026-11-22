import type { Context, MiddlewareHandler } from "hono";

import type { AppEnv } from "../types";
import { opaqueId } from "./hash";
import { clientIp } from "./http";
import { tryRedis } from "./redis";

export type RateLimitOptions = {
	/** Requests allowed per subject per fixed window. */
	limit: number;
	/** Key namespace (lowercase letters), so route groups get separate budgets. */
	name: string;
	/** Window length; default one minute. */
	windowSeconds?: number;
	/**
	 * When Redis can't count: "open" lets the request through (data API),
	 * "memory" counts in this isolate instead (auth endpoints, so an
	 * unreachable or overloaded Redis never means unlimited password guesses).
	 */
	whenRedisDown?: "open" | "memory";
};

const DEFAULT_WINDOW_SECONDS = 60;

/**
 * Who a request counts against, before hashing ("user:<id>" / "ip:<bucket>"
 * / "email:<address>"). null: this limiter doesn't apply to the request.
 */
type Subject = (c: Context<AppEnv>) => string | null | Promise<string | null>;

// ---------------------------------------------------------------------------
// In-isolate fallback counters
// ---------------------------------------------------------------------------

/**
 * Fallback counters for limiters with `whenRedisDown: "memory"`. Workers
 * reuse an isolate for many requests, so this still caps each isolate when
 * Redis is down. Keys are the same opaque hashes as in Redis, and the map is
 * bounded.
 */
const memoryCounts = new Map<string, { count: number; expiresAt: number }>();
const MAX_MEMORY_KEYS = 10_000;

function countInMemory(key: string, ttlSeconds: number): number {
	const now = Date.now();
	const hit = memoryCounts.get(key);
	if (hit && hit.expiresAt > now) {
		hit.count += 1;
		return hit.count;
	}
	if (memoryCounts.size >= MAX_MEMORY_KEYS) {
		for (const [k, v] of memoryCounts)
			if (v.expiresAt <= now) memoryCounts.delete(k);
		// Still full: drop the oldest entries (insertion order).
		for (const k of memoryCounts.keys()) {
			if (memoryCounts.size < MAX_MEMORY_KEYS) break;
			memoryCounts.delete(k);
		}
	}
	memoryCounts.set(key, { count: 1, expiresAt: now + ttlSeconds * 1000 });
	return 1;
}

// ---------------------------------------------------------------------------

/**
 * Fixed-window rate limit backed by Redis `INCR` + `EXPIRE` on
 * `ovq:rl:<name>:<hmac>:<window>`. The subject is HMAC-SHA256'd with
 * BETTER_AUTH_SECRET and truncated to 16 hex characters, so Redis never holds
 * a raw IP, email address or user id; counters expire after two windows.
 * If Redis is unreachable: see `whenRedisDown`.
 */
export function rateLimit(
	subject: Subject,
	{
		limit,
		name,
		windowSeconds = DEFAULT_WINDOW_SECONDS,
		whenRedisDown = "open",
	}: RateLimitOptions,
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		if (c.req.method === "OPTIONS") return next();
		const who = await subject(c);
		if (who == null) return next();
		const nowSec = Math.floor(Date.now() / 1000);
		const window = Math.floor(nowSec / windowSeconds);
		const resetIn = (window + 1) * windowSeconds - nowSec;
		const key = `rl:${name}:${await opaqueId(who)}:${window}`;
		const ttl = windowSeconds * 2;
		const redis = c.var.redis;

		const result = await tryRedis(() =>
			redis.multi().incr(key).expire(key, ttl).exec(),
		);
		const counted = result.ok ? result.value?.[0] : undefined;
		let used: number;
		if (counted && !counted[0] && typeof counted[1] === "number") {
			used = counted[1];
		} else if (whenRedisDown === "memory") {
			console.warn(`rate-limit ${name}: redis unavailable, counting in memory`);
			used = countInMemory(key, ttl);
		} else {
			console.warn(`rate-limit ${name}: redis unavailable, failing open`);
			return next();
		}

		c.header("RateLimit-Limit", String(limit));
		c.header("RateLimit-Remaining", String(Math.max(limit - used, 0)));
		c.header("RateLimit-Reset", String(resetIn));
		if (used > limit) {
			c.header("Retry-After", String(resetIn));
			return c.json(
				{
					error: "Too many requests",
					// better-auth clients read `code` / `message`.
					code: "RATE_LIMITED",
					message: "Too many requests. Wait a little, then try again.",
					details: { limit, windowSeconds, retryAfter: resetIn },
				},
				429,
			);
		}
		return next();
	};
}

/**
 * Per signed-in user: `c.var.userId` from `requireUser` (/v1/*), the API
 * key's owner (/mcp) or `resolveSessionUser` (auth endpoints). Falls back to
 * the client IP if no user was set.
 */
export function rateLimitPerUser(
	options: RateLimitOptions,
): MiddlewareHandler<AppEnv> {
	return rateLimit(
		(c) => (c.var.userId ? `user:${c.var.userId}` : `ip:${clientIp(c)}`),
		options,
	);
}

/** Per client IP (IPv6 by /64), for endpoints that run before sign-in. */
export function rateLimitPerIp(
	options: RateLimitOptions,
): MiddlewareHandler<AppEnv> {
	return rateLimit((c) => `ip:${clientIp(c)}`, options);
}

/**
 * Per target account: the (trimmed, lowercased) `email` of a JSON body, so
 * spreading guesses over many IPs doesn't multiply the budget for one
 * account. Requests without an email aren't counted here (better-auth
 * rejects them anyway). Reads a clone: the body stays readable.
 */
export function rateLimitPerEmail(
	options: RateLimitOptions,
): MiddlewareHandler<AppEnv> {
	return rateLimit(async (c) => {
		try {
			const body: unknown = await c.req.raw.clone().json();
			const email =
				body && typeof body === "object" && "email" in body ? body.email : null;
			if (typeof email !== "string") return null;
			const normalized = email.trim().toLowerCase();
			return normalized ? `email:${normalized}` : null;
		} catch {
			return null;
		}
	}, options);
}
