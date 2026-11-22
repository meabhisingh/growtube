import {
	AUTH_REQUIRED_CODE,
	type AuthRequiredError,
	MCP_API_KEY_HEADER,
} from "@growtube/shared/auth";
import type { Context, MiddlewareHandler } from "hono";

import { ENV } from "../env.server";
import { authFor } from "../services";
import type { AppEnv } from "../types";

/** The 401 body of every /v1/* route without a valid session. */
export const AUTH_REQUIRED_BODY: AuthRequiredError = {
	error: "Sign in required",
	code: AUTH_REQUIRED_CODE,
};

const webOrigin = () => ENV.CORS_ORIGIN.trim().replace(/\/+$/, "");

/**
 * The request headers better-auth may authenticate, or null when the
 * request carries no credential it is allowed to use:
 *
 * - `Authorization: Bearer …` (the extension): only the bearer counts. A
 *   cookie sent along is dropped, so an invalid bearer never falls back to
 *   it. A cross-site page can't add an Authorization header (CORS only lets
 *   the web app's origin send one).
 * - Otherwise the session cookie, but only from the web app: `Origin` must
 *   be CORS_ORIGIN. The cookie is SameSite=None (the web app and the server
 *   may be on different sites), so any site could make the browser attach
 *   it, e.g. `fetch(url, { mode: "no-cors", credentials: "include" })`, and
 *   spend the user's rate limits. Those requests carry another Origin, or
 *   none at all (no-cors GETs), and are treated as signed out.
 */
export function sessionHeaders(c: Context<AppEnv>): Headers | null {
	const authorization = c.req.header("authorization");
	if (authorization) {
		const headers = new Headers(c.req.raw.headers);
		headers.delete("cookie");
		return headers;
	}
	if (!c.req.header("cookie")) return null;
	if (c.req.header("origin") !== webOrigin()) return null;
	return c.req.raw.headers;
}

/**
 * Every /v1/* route needs a signed-in user: the web app's session cookie or
 * the extension's `Authorization: Bearer <set-auth-token value>` (bearer
 * plugin), see `sessionHeaders`. Puts the user id in `c.var.userId`. CORS
 * preflights pass.
 */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (c.req.method === "OPTIONS") return next();
	const headers = sessionHeaders(c);
	// No usable credentials: answer without setting up better-auth.
	if (!headers) return c.json(AUTH_REQUIRED_BODY, 401);
	const session = await authFor(c).api.getSession({ headers });
	if (!session) return c.json(AUTH_REQUIRED_BODY, 401);
	c.set("userId", session.user.id);
	return next();
};

/**
 * For auth endpoints that need a session anyway (delete-user, api-key
 * create): puts the session's user id in `c.var.userId` so the per-user
 * rate limit and the key cap count against it, and answers 401
 * AUTH_REQUIRED without one. It must reject: better-auth resolves sessions
 * more leniently (an invalid or non-Bearer Authorization header falls back
 * to the cookie, a missing Origin to the Referer), so a request this
 * middleware saw as signed out could still act as the cookie's user there,
 * counted against a fresh IP bucket and past the key cap. The handler also
 * gets only these headers (`c.var.authHeaders`), so better-auth can never
 * use a cookie that was dropped here.
 */
export const resolveSessionUser: MiddlewareHandler<AppEnv> = async (
	c,
	next,
) => {
	const headers = sessionHeaders(c);
	if (!headers) return c.json(AUTH_REQUIRED_BODY, 401);
	const session = await authFor(c).api.getSession({ headers });
	if (!session) return c.json(AUTH_REQUIRED_BODY, 401);
	c.set("userId", session.user.id);
	c.set("authHeaders", headers);
	return next();
};

/** `x-api-key: <key>`, else `Authorization: Bearer <key>`. */
function apiKeyFrom(c: Context<AppEnv>): string | null {
	const header = c.req.header(MCP_API_KEY_HEADER)?.trim();
	if (header) return header;
	const authorization = c.req.header("authorization")?.trim();
	if (authorization?.slice(0, 7).toLowerCase() === "bearer ") {
		const token = authorization.slice(7).trim();
		if (token) return token;
	}
	return null;
}

function apiKeyRequired(c: Context<AppEnv>, keySent: boolean) {
	// RFC 6750: name the scheme; flag a key that was sent but rejected.
	c.header(
		"WWW-Authenticate",
		keySent
			? 'Bearer realm="GrowTube", error="invalid_token", error_description="Invalid or expired API key"'
			: 'Bearer realm="GrowTube"',
	);
	const body: AuthRequiredError = {
		error: keySent
			? "Invalid or expired API key. Create one on the GrowTube website (MCP page)."
			: "API key required: send it in the x-api-key header or as Authorization: Bearer <key>.",
		code: AUTH_REQUIRED_CODE,
	};
	return c.json(body, 401);
}

/**
 * /mcp needs an API key from the api-key plugin, verified with
 * `auth.api.verifyApiKey` (server-only; the plugin hashes the key and looks
 * up the hash). Puts the key owner's user id in `c.var.userId` for rate
 * limiting. CORS preflights pass.
 */
export const requireApiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (c.req.method === "OPTIONS") return next();
	const key = apiKeyFrom(c);
	if (!key) return apiKeyRequired(c, false);
	const result = await authFor(c).api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key) return apiKeyRequired(c, true);
	c.set("userId", result.key.referenceId);
	return next();
};
