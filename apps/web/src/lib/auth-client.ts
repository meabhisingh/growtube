import { apiKeyClient } from "@better-auth/api-key/client";
import { AUTH_BASE_PATH } from "@growtube/shared/auth";
import { createAuthClient } from "better-auth/react";

import { ENV } from "../env";

/**
 * better-auth client for the web app. It talks to the worker with the session
 * cookie (better-auth's default `credentials: "include"`), and the api-key
 * plugin adds `authClient.apiKey.create / list / delete` for MCP keys.
 */
export const authClient = createAuthClient({
	baseURL: ENV.VITE_SERVER_URL,
	basePath: AUTH_BASE_PATH,
	plugins: [apiKeyClient()],
});

export type SessionData = typeof authClient.$Infer.Session;
