import { and, count, describeError, eq, pgErrorCode } from "@growtube/db";
import { apikey, user } from "@growtube/db/schema/auth";
import {
	AUTH_TOKEN_RESPONSE_HEADER,
	MCP_API_KEY_HEADER,
} from "@growtube/shared/auth";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";

import { DAILY_CRON, runScheduledRefresh } from "./cron/refresh";
import type { Executor } from "./data/sql";
import { ENV } from "./env.server";
import {
	AUTH_REQUIRED_BODY,
	requireApiKey,
	requireUser,
	resolveSessionUser,
} from "./lib/auth";
import { matchedRoute, requestLogger } from "./lib/logger";
import {
	rateLimitPerEmail,
	rateLimitPerIp,
	rateLimitPerUser,
} from "./lib/rate-limit";
import { closeRedis } from "./lib/redis";
import { channelRoutes } from "./routes/channels";
import { ingestRoutes } from "./routes/ingest";
import { mcpRoutes } from "./routes/mcp";
import { trendingRoutes } from "./routes/trending";
import { videoRoutes } from "./routes/videos";
import { authFor, getDb, getRedis } from "./services";
import type { AppEnv } from "./types";

// Not exported: a Worker entry module's named exports are read as entrypoints.
/** Data API reads (history, stats, trending, resolve) per user per minute. */
const READ_RATE_LIMIT = 600;
/** MCP requests per API-key owner per minute. */
const MCP_RATE_LIMIT = 120;
/** Sign-in, sign-up and account deletion attempts per client IP (IPv6: /64) per minute. */
const AUTH_RATE_LIMIT = 10;
/** Password checks (sign-in per email, delete-user per user) per 15 minutes. */
const PASSWORD_RATE_LIMIT = 10;
const PASSWORD_WINDOW_SECONDS = 15 * 60;
/** API key creations per user per minute. */
const API_KEY_CREATE_RATE_LIMIT = 20;
/**
 * Abuse protection, not a plan limit: nobody needs more MCP keys than this,
 * and it keeps one account from filling the apikey table.
 */
const MAX_API_KEYS_PER_USER = 50;
/** Auth request bodies are a few hundred bytes. */
const MAX_AUTH_BODY_BYTES = 16 * 1024;

const RATE_LIMIT_HEADERS = [
	"Retry-After",
	"RateLimit-Limit",
	"RateLimit-Remaining",
	"RateLimit-Reset",
];

const app = new Hono<AppEnv>();

// Method, route pattern, status and duration only (see lib/logger.ts).
app.use(requestLogger);

// Auth and the data API: only the web app's origin, with credentials (the
// session cookie). Extension pages and the background worker have host
// permissions for the server, so CORS doesn't apply to them; they send
// `Authorization: Bearer <token>` with credentials "omit".
const webAppCors = cors({
	// Exact-match origin: a trailing slash in CORS_ORIGIN would never match.
	origin: ENV.CORS_ORIGIN.trim().replace(/\/+$/, ""),
	allowMethods: ["GET", "POST", "OPTIONS"],
	allowHeaders: ["Content-Type", "Authorization"],
	// Not set-auth-token: the web app uses the httpOnly cookie, and exposing
	// the bearer token would let any script on its origin read it. This list
	// replaces the Access-Control-Expose-Headers the bearer plugin sets.
	exposeHeaders: [...RATE_LIMIT_HEADERS, "X-Cache"],
	credentials: true,
	maxAge: 86_400,
});
app.use("/api/auth/*", webAppCors);
app.use("/v1/*", webAppCors);

// MCP clients authenticate with an API key, never with cookies: any origin,
// no credentials.
app.use(
	"/mcp",
	cors({
		origin: "*",
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: [
			"Content-Type",
			"Accept",
			"Authorization",
			MCP_API_KEY_HEADER,
			"Mcp-Session-Id",
			"Mcp-Protocol-Version",
			"Last-Event-ID",
		],
		exposeHeaders: [
			"Mcp-Session-Id",
			"WWW-Authenticate",
			...RATE_LIMIT_HEADERS,
		],
		maxAge: 86_400,
	}),
);

// Public liveness check.
app.use(
	"/health",
	cors({ origin: "*", allowMethods: ["GET", "OPTIONS"], maxAge: 86_400 }),
);

// Per-request Postgres + Redis clients. Workers can't reuse sockets across
// requests; both clients connect lazily, so routes that don't touch them
// open no connections. They're closed after the response is sent.
app.use("*", async (c, next) => {
	const db = getDb();
	const redis = getRedis();
	c.set("db", db);
	c.set("redis", redis);
	try {
		await next();
	} finally {
		c.executionCtx.waitUntil(
			Promise.allSettled([db.$client.end(), closeRedis(redis)]),
		);
	}
});

// Auth endpoints take a few small JSON fields. better-auth's schema has no
// length limits on `name` and `image` (packages/auth checks those).
app.use(
	"/api/auth/*",
	bodyLimit({
		maxSize: MAX_AUTH_BODY_BYTES,
		onError: (c) =>
			c.json(
				{
					error: "Payload too large",
					code: "PAYLOAD_TOO_LARGE",
					message: "Request body too large.",
				},
				413,
			),
	}),
);

// Password guessing and account farming. Every subject (IP bucket, email,
// user id) is only HMAC input for the Redis key (lib/rate-limit.ts). When
// Redis is down these count in memory instead of failing open.
// - Per client IP (IPv6 by /64): sign-in, sign-up, delete-user.
app.on(
	"POST",
	["/api/auth/sign-in/*", "/api/auth/sign-up/*", "/api/auth/delete-user"],
	rateLimitPerIp({
		limit: AUTH_RATE_LIMIT,
		name: "auth",
		whenRedisDown: "memory",
	}),
);
// - Per target account, however many IPs the attempts come from.
app.post(
	"/api/auth/sign-in/email",
	rateLimitPerEmail({
		limit: PASSWORD_RATE_LIMIT,
		name: "account",
		windowSeconds: PASSWORD_WINDOW_SECONDS,
		whenRedisDown: "memory",
	}),
);
// - Per signed-in user: delete-user checks a session holder's password.
//   Both need a session; without one they get 401 here, before better-auth.
app.on(
	"POST",
	["/api/auth/delete-user", "/api/auth/api-key/create"],
	resolveSessionUser,
);
app.post(
	"/api/auth/delete-user",
	rateLimitPerUser({
		limit: PASSWORD_RATE_LIMIT,
		name: "deluser",
		windowSeconds: PASSWORD_WINDOW_SECONDS,
		whenRedisDown: "memory",
	}),
);

async function apiKeyCount(db: Executor, userId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(apikey)
		.where(eq(apikey.referenceId, userId));
	return row?.n ?? 0;
}

const TOO_MANY_API_KEYS_BODY = {
	error: "Too many API keys",
	code: "TOO_MANY_API_KEYS",
	message: `You already have ${MAX_API_KEYS_PER_USER} API keys. Delete one you no longer use, then create a new one.`,
};

/**
 * At most MAX_API_KEYS_PER_USER keys per account (abuse protection only).
 * Concurrent creates all pass the first count (the insert happens later,
 * inside the api-key plugin), so it is checked again once this request's
 * key exists, one request per user at a time (a row lock on the user): if
 * the user is over the cap now, this key is deleted before anyone saw it
 * and the request gets the same 400. Every kept key saw at most 50 keys
 * after all earlier kept ones were inserted, so at most 50 stay, and of a
 * burst at least one request succeeds when there is room.
 */
const capApiKeys: MiddlewareHandler<AppEnv> = async (c, next) => {
	const userId = c.var.userId;
	if (!userId) return c.json(AUTH_REQUIRED_BODY, 401);
	if ((await apiKeyCount(c.var.db, userId)) >= MAX_API_KEYS_PER_USER)
		return c.json(TOO_MANY_API_KEYS_BODY, 400);
	await next();
	if (c.res.status !== 200) return;
	const created: unknown = await c.res
		.clone()
		.json()
		.catch(() => null);
	const id =
		created && typeof created === "object" && "id" in created
			? created.id
			: null;
	if (typeof id !== "string") return;
	const overCap = await c.var.db.transaction(async (tx) => {
		await tx
			.select({ id: user.id })
			.from(user)
			.where(eq(user.id, userId))
			.for("no key update");
		if ((await apiKeyCount(tx, userId)) <= MAX_API_KEYS_PER_USER) return false;
		await tx
			.delete(apikey)
			.where(and(eq(apikey.id, id), eq(apikey.referenceId, userId)));
		return true;
	});
	if (overCap) c.res = c.json(TOO_MANY_API_KEYS_BODY, 400);
};
app.post(
	"/api/auth/api-key/create",
	rateLimitPerUser({
		limit: API_KEY_CREATE_RATE_LIMIT,
		name: "apikey",
		whenRedisDown: "memory",
	}),
	capApiKeys,
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => {
	// delete-user / api-key create: only the credential the limiters counted
	// (see resolveSessionUser).
	const authHeaders = c.var.authHeaders;
	const res = await authFor(c).handler(
		authHeaders ? new Request(c.req.raw, { headers: authHeaders }) : c.req.raw,
	);
	// The bearer plugin adds the session token to every response that sets
	// the session cookie. Only the extension reads it; the web app (and any
	// other web page) gets the httpOnly cookie alone.
	const origin = c.req.header("origin");
	if (
		origin &&
		!origin.startsWith("chrome-extension://") &&
		res.headers.has(AUTH_TOKEN_RESPONSE_HEADER)
	) {
		const headers = new Headers(res.headers);
		headers.delete(AUTH_TOKEN_RESPONSE_HEADER);
		return new Response(res.body, {
			status: res.status,
			statusText: res.statusText,
			headers,
		});
	}
	return res;
});

// Everything under /v1 needs a signed-in user (401 AUTH_REQUIRED otherwise).
app.use("/v1/*", requireUser);
// Reads share one per-user budget; ingest has its own (routes/ingest.ts).
const readRateLimit = rateLimitPerUser({
	limit: READ_RATE_LIMIT,
	name: "read",
});
app.use("/v1/videos/*", readRateLimit);
app.use("/v1/channels/*", readRateLimit);
app.use("/v1/trending", readRateLimit);

// MCP needs an API key (401 + WWW-Authenticate otherwise).
app.use(
	"/mcp",
	requireApiKey,
	rateLimitPerUser({ limit: MCP_RATE_LIMIT, name: "mcp" }),
);

app.get("/", (c) => {
	return c.text("OK");
});

/** A dependency that hangs must not hang the (public) health check. */
const HEALTH_TIMEOUT_MS = 3_000;
/**
 * The public health check reuses its last result (per isolate) for a few
 * seconds, and while one request re-checks, the others get the previous
 * result: a flood of /health requests can't open a Postgres and a Redis
 * connection each. On a fresh isolate (no result yet) only the first
 * request checks; the others wait for its result (polling, each in its own
 * request context) and answer 503 "unknown" if it doesn't come in time.
 */
const HEALTH_CACHE_MS = 5_000;
const HEALTH_POLL_MS = 50;
type HealthResult = { at: number; db: boolean; redis: boolean };
let lastHealth: HealthResult | null = null;
/** When the running re-check started (0: none). Expires, in case it never finishes. */
let healthCheckStartedAt = 0;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${ms}ms`)),
			ms,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

// Public and CORS-open: report only up/down. A one-line failure summary goes
// to the logs, never to the caller.
app.get("/health", async (c) => {
	const now = Date.now();
	let health = lastHealth;
	const fresh = health != null && now - health.at <= HEALTH_CACHE_MS;
	const checking = now - healthCheckStartedAt < 2 * HEALTH_TIMEOUT_MS;
	if (!health && checking) {
		// A first check is running: never open connections of our own.
		const until = now + 2 * HEALTH_TIMEOUT_MS;
		while (!lastHealth && Date.now() < until)
			await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_MS));
		health = lastHealth;
		if (!health)
			return c.json({ ok: false, db: "unknown", redis: "unknown" }, 503);
	} else if (!health || (!fresh && !checking)) {
		healthCheckStartedAt = now;
		try {
			const [db, redis] = await Promise.allSettled([
				withTimeout(c.var.db.$client.query("select 1"), HEALTH_TIMEOUT_MS),
				withTimeout(c.var.redis.ping(), HEALTH_TIMEOUT_MS),
			]);
			if (db.status === "rejected")
				console.error(
					`health: database check failed: ${describeError(db.reason)}`,
				);
			if (redis.status === "rejected")
				console.error(
					`health: redis check failed: ${describeError(redis.reason)}`,
				);
			health = {
				at: Date.now(),
				db: db.status === "fulfilled",
				redis: redis.status === "fulfilled",
			};
			lastHealth = health;
		} finally {
			healthCheckStartedAt = 0;
		}
	}
	const ok = health.db && health.redis;
	return c.json(
		{
			ok,
			db: health.db ? "up" : "down",
			redis: health.redis ? "up" : "down",
		},
		ok ? 200 : 503,
	);
});

app.route("/v1/ingest", ingestRoutes);
app.route("/v1/videos", videoRoutes);
app.route("/v1/channels", channelRoutes);
app.route("/v1/trending", trendingRoutes);
app.route("/mcp", mcpRoutes);

app.notFound((c) =>
	c.json({ error: "Not found", details: { path: c.req.path } }, 404),
);

// Logs name, Postgres code and a params-free message (describeError), never
// the error object: drizzle's message and stack list every bound value.
app.onError((err, c) => {
	const route = `${c.req.method} ${matchedRoute(c)}`;
	if (err instanceof HTTPException) {
		// Some libraries (e.g. the MCP transport) attach a ready-made response.
		if (err.res) return err.getResponse();
		return c.json({ error: err.message || "Request failed" }, err.status);
	}
	// Class 22 = data exception: the client sent a value the column can't
	// hold. That's a bad request, not a server failure (so clients drop it
	// instead of retrying forever).
	// apikey.reference_id references the user: a key created while its
	// account is being deleted fails the foreign key. The session is gone.
	if (
		pgErrorCode(err) === "23503" &&
		c.req.path === "/api/auth/api-key/create"
	) {
		console.warn(`${route}: account deleted while creating a key`);
		return c.json(AUTH_REQUIRED_BODY, 401);
	}
	if (pgErrorCode(err)?.startsWith("22")) {
		console.warn(`${route} rejected bad data: ${describeError(err)}`);
		return c.json({ error: "Invalid value in request" }, 400);
	}
	console.error(`${route} failed: ${describeError(err)}`);
	return c.json({ error: "Internal server error" }, 500);
});

async function scheduled(
	controller: ScheduledController,
	_env: unknown,
	ctx: ExecutionContext,
): Promise<void> {
	const db = getDb();
	const redis = getRedis();
	try {
		const report = await runScheduledRefresh(
			{ db, redis },
			{
				now: new Date(controller.scheduledTime),
				// Optional binding: typed as string by InferEnv, but may be unset.
				apiKey: (ENV as { YOUTUBE_API_KEY?: string }).YOUTUBE_API_KEY,
				forceDaily: controller.cron === DAILY_CRON,
			},
		);
		console.log(`cron ${controller.cron}:`, JSON.stringify(report));
		if (report.errors.length > 0) {
			// Surface as a failed invocation in Cloudflare's cron dashboard.
			throw new Error(
				`scheduled refresh finished with ${report.errors.length} error(s)`,
			);
		}
	} finally {
		ctx.waitUntil(Promise.allSettled([db.$client.end(), closeRedis(redis)]));
	}
}

export default {
	fetch: app.fetch,
	scheduled,
} satisfies ExportedHandler;

export type { AppEnv } from "./types";
