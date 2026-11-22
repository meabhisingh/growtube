/** Build-time configuration (from apps/extension/.env, WXT_ prefix). */

function readEnv(key: string): string | undefined {
	try {
		const env = (import.meta as { env?: Record<string, string | undefined> })
			.env;
		const value = env?.[key];
		return value?.trim() ? value.trim() : undefined;
	} catch {
		return undefined;
	}
}

/** Default GrowTube server (Hono worker). Users can override it in Settings. */
export const DEFAULT_SERVER_URL = (
	readEnv("WXT_SERVER_URL") ?? "http://localhost:3000"
).replace(/\/+$/, "");

/**
 * The GrowTube web app for the default server (WXT_WEB_URL), where MCP API
 * keys are managed. null when not configured.
 */
export const DEFAULT_WEB_URL: string | null =
	readEnv("WXT_WEB_URL")?.replace(/\/+$/, "") ?? null;

export const IS_DEV =
	(import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;
