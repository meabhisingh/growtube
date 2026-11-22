/**
 * Optional host permissions for user-chosen endpoints (AI providers, a custom
 * server URL). The manifest declares `optional_host_permissions` for
 * http(s)://*, and we request only the single origin the user configured.
 *
 * `ensureOriginPermission` must run in an extension page (options, popup,
 * side panel) during a user gesture (click handler). Content scripts can't
 * request permissions: send the user to the options page instead.
 */
import { browser } from "wxt/browser";

/** "https://api.openai.com/v1" -> "https://api.openai.com/*" (match patterns ignore ports). */
export function originPattern(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.protocol !== "https:" && u.protocol !== "http:") return null;
		return `${u.protocol}//${u.hostname}/*`;
	} catch {
		return null;
	}
}

export function originOf(url: string): string | null {
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

type PermissionsApi = {
	contains(p: { origins: string[] }): Promise<boolean>;
	request(p: { origins: string[] }): Promise<boolean>;
};

function api(): PermissionsApi | null {
	return (
		(browser as unknown as { permissions?: PermissionsApi } | undefined)
			?.permissions ?? null
	);
}

/** True when the extension may call `url` (without CORS restrictions). */
export async function hasOriginPermission(url: string): Promise<boolean> {
	const pattern = originPattern(url);
	const p = api();
	if (!pattern || !p) return false;
	try {
		return await p.contains({ origins: [pattern] });
	} catch {
		return false;
	}
}

/**
 * Asks Chrome for access to `url`'s origin (no-op if already granted).
 * Call from a click handler in an extension page. Resolves to whether access
 * is granted.
 */
export async function ensureOriginPermission(url: string): Promise<boolean> {
	const pattern = originPattern(url);
	const p = api();
	if (!pattern || !p) return false;
	if (await hasOriginPermission(url)) return true;
	try {
		return await p.request({ origins: [pattern] });
	} catch (error) {
		console.warn("[open-vidiq] permission request failed", error);
		return false;
	}
}

/** Same as ensureOriginPermission, named for the AI settings UI. */
export const ensureProviderPermission = ensureOriginPermission;
export const hasProviderPermission = hasOriginPermission;
