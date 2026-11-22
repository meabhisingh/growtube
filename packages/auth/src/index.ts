import { apiKey } from "@better-auth/api-key";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { type Database, describeError, eq } from "@growtube/db";
import * as schema from "@growtube/db/schema/auth";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { bearer } from "better-auth/plugins";
import type { BetterAuthPlugin } from "better-auth/types";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
	/**
	 * Optional, comma-separated `chrome-extension://<id>` origins allowed to
	 * sign in / sign up without cookies (see `extensionOrigins`). Unset: any
	 * `chrome-extension://` origin, still only for those two endpoints.
	 */
	EXTENSION_ORIGINS?: string | undefined;
};

/** Same value as `AUTH_BASE_PATH` in `@growtube/shared/auth` (better-auth's default). */
const AUTH_BASE_PATH = "/api/auth";

/** Every new API key starts with this, so a leaked key is easy to recognise. */
export const API_KEY_PREFIX = "gt_";

/**
 * Prefixes of keys created before the GrowTube rename. They still verify, so
 * existing MCP setups keep working, but no new key is created with them.
 */
export const LEGACY_API_KEY_PREFIXES: readonly string[] = ["ovq_"];

/** Longest display name accepted at sign-up (the clients use the same cap). */
export const MAX_NAME_LENGTH = 100;

/**
 * The only better-auth endpoints served over HTTP (under AUTH_BASE_PATH):
 * what the web app and the extension call. Everything else better-auth or
 * its plugins route (verify-password, change-password, update-user,
 * change-email, list-sessions, api-key/get|update, ...) answers 404, so no
 * unused endpoint can become a password oracle or a way to change the
 * account. Server code still calls any endpoint through `auth.api`.
 */
export const AUTH_HTTP_PATHS: readonly string[] = [
	"/sign-up/email",
	"/sign-in/email",
	"/sign-out",
	"/get-session",
	"/delete-user",
	"/revoke-sessions",
	"/api-key/create",
	"/api-key/list",
	"/api-key/delete",
];

const ALLOWED_HTTP_PATHNAMES = new Set(
	AUTH_HTTP_PATHS.map((path) => `${AUTH_BASE_PATH}${path}`),
);

/** better-auth plugin: 404 for every HTTP request outside AUTH_HTTP_PATHS. */
const httpAllowlist = {
	id: "ovq-http-allowlist",
	onRequest: async (request: Request) => {
		let pathname: string;
		try {
			pathname = new URL(request.url).pathname;
		} catch {
			pathname = "";
		}
		if (ALLOWED_HTTP_PATHNAMES.has(pathname)) return;
		return {
			response: Response.json(
				{ code: "NOT_FOUND", message: "Not found" },
				{ status: 404 },
			),
		};
	},
} satisfies BetterAuthPlugin;

/**
 * Why (and how narrowly) extension origins are trusted, from
 * better-auth/dist/api/middlewares/origin-check.mjs:
 *
 * - `originCheckMiddleware` runs on every non-GET auth request, but it only
 *   validates the Origin when the request carries a Cookie header. The
 *   extension sends `Authorization: Bearer …` with credentials "omit", so its
 *   sign-out, delete-user, revoke-sessions and api-key calls (and every GET,
 *   e.g. get-session) never reach the origin check. CSRF needs an ambient
 *   credential (a cookie), and a bearer request has none.
 * - `formCsrfMiddleware` guards /sign-in/email and /sign-up/email. Without
 *   cookies it still forces the origin check whenever Origin, Referer or
 *   Sec-Fetch-* headers are present, and Chrome sends
 *   `Origin: chrome-extension://<id>` on the extension's POSTs. So these two
 *   endpoints do need the extension origin, and nothing else does.
 *
 * So extension origins are trusted only for those two paths, only on
 * requests without a Cookie header (a website can't forge a
 * chrome-extension:// Origin anyway), and pinned to exact extension ids when
 * EXTENSION_ORIGINS is set. On every other request (any other path, or any
 * request with cookies) they are not trusted at all, neither as Origin nor as
 * a callback URL.
 */
const COOKIELESS_ORIGIN_CHECKED_PATHS = ["/sign-in/email", "/sign-up/email"];
const EXTENSION_ORIGIN_RE = /^chrome-extension:\/\/[a-p]{32}$/;

function extensionOrigins(raw: string | undefined): string[] {
	const entries = (raw ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean);
	// Set but with no valid id: trust no extension (fail closed).
	if (entries.length > 0)
		return entries.filter((entry) => EXTENSION_ORIGIN_RE.test(entry));
	return ["chrome-extension://*"];
}

function isCookielessFirstLogin(request: Request): boolean {
	if (request.headers.has("cookie")) return false;
	let pathname: string;
	try {
		pathname = new URL(request.url).pathname;
	} catch {
		return false;
	}
	return COOKIELESS_ORIGIN_CHECKED_PATHS.some(
		(path) => pathname === `${AUTH_BASE_PATH}${path}`,
	);
}

/** better-auth's logger, minus anything that could carry user data. */
function safeLogArg(arg: unknown): string | number | boolean | undefined {
	if (arg instanceof Error) return describeError(arg);
	if (typeof arg === "string") return describeError(arg);
	if (typeof arg === "number" || typeof arg === "boolean") return arg;
	// Objects (request bodies, rows, header snapshots) are dropped.
	return undefined;
}

function safeLog(
	level: "debug" | "info" | "warn" | "error",
	message: string,
	...args: unknown[]
) {
	const parts = [
		`[auth] ${describeError(message)}`,
		...args.map(safeLogArg).filter((part) => part !== undefined),
	];
	if (level === "error") console.error(...parts);
	else if (level === "warn") console.warn(...parts);
	else console.log(...parts);
}

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	const baseOrigins = [env.CORS_ORIGIN, ...desktopOrigins];
	const firstLoginExtensionOrigins = extensionOrigins(env.EXTENSION_ORIGINS);

	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema,
		}),
		basePath: AUTH_BASE_PATH,
		// Called without a request at startup and with the request on every
		// HTTP request (its Origin and callback-URL checks).
		trustedOrigins: (request) =>
			request && isCookielessFirstLogin(request)
				? [...baseOrigins, ...firstLoginExtensionOrigins]
				: baseOrigins,
		// better-auth's defaults, kept on purpose: 8-128 characters.
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 8,
			maxPasswordLength: 128,
		},
		user: {
			deleteUser: {
				enabled: true,
				// apikey.reference_id cascades on the user row (packages/db), which
				// also catches a key created while the account is being deleted;
				// deleting them first keeps that explicit. A failure here aborts
				// the deletion. Sessions and accounts are deleted by better-auth.
				beforeDelete: async (user) => {
					await database
						.delete(schema.apikey)
						.where(eq(schema.apikey.referenceId, user.id));
				},
			},
		},
		hooks: {
			before: createAuthMiddleware(async (ctx) => {
				const body = ctx.body as Record<string, unknown> | undefined;
				// The api-key plugin lets clients pick the prefix; every new key
				// starts with API_KEY_PREFIX so a leaked one is easy to recognise
				// (legacy prefixes only verify, see customAPIKeyValidator).
				if (ctx.path === "/api-key/create") {
					if (body?.prefix !== undefined && body.prefix !== API_KEY_PREFIX) {
						throw new APIError("BAD_REQUEST", {
							code: "PREFIX_NOT_ALLOWED",
							message: `API keys always start with ${API_KEY_PREFIX}.`,
						});
					}
					return;
				}
				// Account deletion always needs the password: by default better-auth
				// accepts a session younger than a day instead. Every account here
				// is an email/password account.
				if (ctx.path === "/delete-user") {
					const password = body?.password;
					if (typeof password !== "string" || password.length === 0) {
						throw new APIError("BAD_REQUEST", {
							code: "PASSWORD_REQUIRED",
							message: "Enter your password to delete your account.",
						});
					}
					return;
				}
				// better-auth's schema takes any string for `name` and `image`.
				// Cap the name (the users table and every session read carry it)
				// and refuse `image`: no client sets one, and the web app would
				// load it from whatever host it names.
				if (ctx.path === "/sign-up/email" || ctx.path === "/update-user") {
					const name = body?.name;
					if (
						typeof name === "string" &&
						(name.trim().length === 0 || name.length > MAX_NAME_LENGTH)
					) {
						throw new APIError("BAD_REQUEST", {
							code: "INVALID_NAME",
							message: `Enter a name of up to ${MAX_NAME_LENGTH} characters.`,
						});
					}
					if (body?.image != null) {
						throw new APIError("BAD_REQUEST", {
							code: "IMAGE_NOT_SUPPORTED",
							message: "Profile images are not supported.",
						});
					}
				}
			}),
		},
		// Account deletion by emailed token is not set up. (Also outside
		// AUTH_HTTP_PATHS, like every endpoint no client uses.)
		disabledPaths: ["/delete-user/callback"],
		databaseHooks: {
			// Sessions keep only the token, user and expiry: no IP address (also
			// off via disableIpTracking) and no user agent.
			session: {
				create: {
					before: async (session) => ({
						data: { ...session, ipAddress: null, userAgent: null },
					}),
				},
				update: {
					before: async (session) => ({
						data: { ...session, ipAddress: null, userAgent: null },
					}),
				},
			},
		},
		// Abuse limits live in the server's Redis limiter (apps/server
		// index.ts: per hashed IP bucket for sign-in / sign-up / delete-user,
		// plus per account for sign-in and per user for delete-user and
		// api-key creation). better-auth's own limiter would be per-isolate
		// memory on Workers, and needs IPs we don't track.
		rateLimit: { enabled: false },
		telemetry: { enabled: false },
		logger: { level: "warn", log: safeLog },
		// Unexpected (non-API) errors are rethrown to the server's onError, which
		// logs a value-free summary. Otherwise better-call console.errors the
		// raw error object ("# SERVER_ERROR"), Postgres detail fields included.
		onAPIError: { throw: true },
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		advanced: {
			ipAddress: { disableIpTracking: true },
			defaultCookieAttributes: {
				sameSite: "none",
				secure: true,
				httpOnly: true,
			},
		},
		plugins: [
			// First: unused endpoints never run (see AUTH_HTTP_PATHS).
			httpAllowlist,
			// Extension: sign-in / sign-up responses carry the signed session
			// token in `set-auth-token`; it comes back as `Authorization: Bearer`.
			// requireSignature: the raw token from the session table alone is not
			// a valid bearer token.
			bearer({ requireSignature: true }),
			// MCP API keys: shown once, stored as SHA-256 hashes, sent in
			// `x-api-key` (the plugin default) or as `Authorization: Bearer`.
			apiKey({
				defaultPrefix: API_KEY_PREFIX,
				// Keys under API_KEY_PREFIX or a legacy prefix (keys made before
				// the GrowTube rename) verify. Keys created under any other prefix
				// (before it was enforced at creation) no longer verify.
				customAPIKeyValidator: ({ key }) =>
					key.startsWith(API_KEY_PREFIX) ||
					LEGACY_API_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
				// Key lists show "gt_" plus 5 characters.
				startingCharactersConfig: { shouldStore: true, charactersLength: 8 },
				// No per-key rate limits or quotas: GrowTube has no plans or
				// limits. The server's Redis limiter handles abuse.
				rateLimit: { enabled: false },
				// No expiry unless the user picks one (1-365 days).
				keyExpiration: { defaultExpiresIn: null },
				enableMetadata: false,
				// Keys are only for /mcp, never a stand-in for a session.
				enableSessionForAPIKeys: false,
			}),
		],
	});
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
