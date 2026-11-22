/**
 * Sign-in state every part of the extension can read. GrowTube can't be
 * used without an account: popup, side panel, options, the YouTube/Studio
 * content scripts and the background all gate themselves on `authUser`.
 *
 *   const [user, , loading] = useStorageItem(authUser);   // React, live
 *   const off = authUser.watch((u) => (u ? start() : stop()));
 *
 * `authUser` never contains the login token. The token lives in the
 * extension origin's IndexedDB (lib/token-store.ts), which content scripts
 * can't open, and only the background reads and writes it
 * (lib/auth-session.ts). Pages sign in / out through the `auth.*` messages,
 * which only extension pages may send.
 */
import type { AuthUser } from "@growtube/shared/auth";
import { storage } from "#imports";

import { DEFAULT_SERVER_URL, DEFAULT_WEB_URL } from "./env";

/** The signed-in user and the server they signed in to. Never the token. */
export type SignedInUser = AuthUser & { serverUrl: string };

/**
 * Written by the background together with the token (one storage write) and
 * cleared together with it. null = signed out.
 */
export const authUser = storage.defineItem<SignedInUser | null>(
	"local:authUser",
	{ fallback: null },
);

/** better-auth's defaults (emailAndPassword.minPasswordLength / max). */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Options page section with the sign-in forms (options.html#account). */
export const ACCOUNT_SECTION = "account";

/** Web app page where MCP API keys are created and revoked (routes/_auth/mcp.tsx). */
export const WEB_API_KEYS_PATH = "/mcp";

export function normalizeServerUrl(url: string): string {
	return url.trim().replace(/\/+$/, "");
}

/** Dev convention of this repo: server on :3000, web app on :3001. */
const LOCAL_DEV_SERVER = "http://localhost:3000";
const LOCAL_DEV_WEB = "http://localhost:3001";

/**
 * The web app that belongs to `serverUrl`, when the extension knows it:
 * WXT_WEB_URL for the build's default server, or the local dev web app for
 * the local dev server. null for any other (e.g. self-hosted) server.
 */
export function webAppUrl(serverUrl: string): string | null {
	const url = normalizeServerUrl(serverUrl);
	if (DEFAULT_WEB_URL && url === DEFAULT_SERVER_URL) return DEFAULT_WEB_URL;
	if (url === LOCAL_DEV_SERVER) return LOCAL_DEV_WEB;
	return null;
}

/** The privacy policy of `serverUrl`'s web app, when the extension knows it. */
export function privacyPolicyUrl(serverUrl: string): string | null {
	const web = webAppUrl(serverUrl);
	return web ? `${web}/privacy` : null;
}
