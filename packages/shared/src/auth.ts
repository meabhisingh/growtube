/**
 * Auth contract shared by the server, the extension and the web app.
 *
 * - The server mounts better-auth at AUTH_BASE_PATH.
 * - The web app uses the session cookie (credentials: "include").
 * - The extension uses bearer tokens: it reads AUTH_TOKEN_RESPONSE_HEADER from
 *   sign-in / sign-up responses and sends `Authorization: Bearer <token>`
 *   with credentials "omit".
 * - MCP clients send an API key in MCP_API_KEY_HEADER (or as a bearer token).
 * - Every /v1/* route and /mcp require a signed-in user; /health stays public.
 *   Unauthenticated calls get HTTP 401 with an `AuthRequiredError` body.
 */
export const AUTH_BASE_PATH = "/api/auth";

/** Response header the better-auth bearer plugin sets on sign-in / sign-up. */
export const AUTH_TOKEN_RESPONSE_HEADER = "set-auth-token";

/** Header MCP clients send their API key in. */
export const MCP_API_KEY_HEADER = "x-api-key";

/** `code` of the 401 body returned when a request has no valid session. */
export const AUTH_REQUIRED_CODE = "AUTH_REQUIRED";

export type AuthRequiredError = {
	error: string;
	code: typeof AUTH_REQUIRED_CODE;
};

export function isAuthRequiredError(body: unknown): body is AuthRequiredError {
	return (
		typeof body === "object" &&
		body !== null &&
		(body as { code?: unknown }).code === AUTH_REQUIRED_CODE
	);
}

/** The signed-in user as the clients keep it (never includes the token). */
export type AuthUser = {
	id: string;
	name: string;
	email: string;
};
