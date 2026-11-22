/**
 * Typed client for the GrowTube HTTP API. URLs come from `API_ROUTES` and
 * every response is validated with the shared zod contract, so a server-side
 * contract change surfaces as a type error (or a clear runtime error) here.
 */
import {
	API_ROUTES,
	apiErrorResponse,
	type ChannelHistoryResponse,
	type ChannelResolveResponse,
	channelHistoryResponse,
	channelResolvePath,
	channelResolveResponse,
	type HistoryRange,
	type TrendingQuery,
	type TrendingResponse,
	trendingResponse,
	type VideoHistoryResponse,
	videoHistoryResponse,
} from "@growtube/shared";
import { AUTH_REQUIRED_CODE, isAuthRequiredError } from "@growtube/shared/auth";
import { z } from "zod";

import { ENV } from "@/env";

/** Base URL of the worker, without a trailing slash. */
export const SERVER_URL = String(ENV.VITE_SERVER_URL ?? "").replace(/\/+$/, "");

/** Streamable HTTP MCP endpoint served by the same worker. */
export const MCP_URL = `${SERVER_URL}${API_ROUTES.mcp}`;

/** True when the API points at this machine (MCP clients in the cloud can't reach it). */
export const IS_LOCAL_SERVER =
	/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/]+\.localhost)(:\d+)?$/i.test(
		SERVER_URL,
	);

export class ApiError extends Error {
	/** HTTP status, or 0 when the request never got a response. */
	readonly status: number;
	readonly details: unknown;
	/** Machine-readable error code from the server, e.g. AUTH_REQUIRED. */
	readonly code: string | undefined;

	constructor(
		message: string,
		status: number,
		details?: unknown,
		code?: string,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.details = details;
		this.code = code;
	}

	get isNotFound(): boolean {
		return this.status === 404;
	}

	/** The request had no valid session; the user is sent to /login. */
	get isAuthRequired(): boolean {
		return this.code === AUTH_REQUIRED_CODE;
	}
}

type AuthRequiredHandler = () => void;
let authRequiredHandler: AuthRequiredHandler | null = null;

/**
 * Registered once by main.tsx, which owns the router: called whenever the
 * server says the session is missing or expired.
 */
export function setAuthRequiredHandler(handler: AuthRequiredHandler | null) {
	authRequiredHandler = handler;
}

/** Tell the app the session is gone (also used by the auth-client calls). */
export function notifyAuthRequired() {
	authRequiredHandler?.();
}

export function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

type QueryValue = string | number | boolean | null | undefined;

export function apiUrl(
	path: string,
	query?: Record<string, QueryValue>,
): string {
	const url = new URL(`${SERVER_URL}${path}`);
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value === undefined || value === null || value === "") continue;
		url.searchParams.set(key, String(value));
	}
	return url.toString();
}

interface RequestOptions {
	query?: Record<string, QueryValue>;
	signal?: AbortSignal;
}

async function getJson<S extends z.ZodType>(
	path: string,
	schema: S,
	{ query, signal }: RequestOptions = {},
): Promise<z.output<S>> {
	let res: Response;
	try {
		res = await fetch(apiUrl(path, query), {
			headers: { Accept: "application/json" },
			// The session cookie lives on the server's origin.
			credentials: "include",
			signal,
		});
	} catch (error) {
		if (isAbortError(error)) throw error;
		throw new ApiError(
			"Can't reach the GrowTube server. Check your connection and try again.",
			0,
			error,
		);
	}

	const body: unknown = await res.json().catch(() => undefined);

	if (res.status === 401 && isAuthRequiredError(body)) {
		notifyAuthRequired();
		throw new ApiError(
			body.error || "Sign in required.",
			401,
			undefined,
			AUTH_REQUIRED_CODE,
		);
	}

	if (!res.ok) {
		const parsed = apiErrorResponse.safeParse(body);
		throw new ApiError(
			parsed.success
				? parsed.data.error
				: `Request failed with status ${res.status}.`,
			res.status,
			parsed.success ? parsed.data.details : body,
		);
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ApiError(
			"The server sent a response this page doesn't understand.",
			res.status,
			z.prettifyError(parsed.error),
		);
	}
	return parsed.data;
}

export type TrendingParams = Partial<TrendingQuery>;

export function getTrending(
	params: TrendingParams,
	signal?: AbortSignal,
): Promise<TrendingResponse> {
	return getJson(API_ROUTES.trending, trendingResponse, {
		query: {
			window: params.window,
			type: params.type,
			q: params.q?.trim(),
			limit: params.limit,
		},
		signal,
	});
}

export function getVideoHistory(
	videoId: string,
	range: HistoryRange,
	signal?: AbortSignal,
): Promise<VideoHistoryResponse> {
	return getJson(
		API_ROUTES.videoHistory(encodeURIComponent(videoId)),
		videoHistoryResponse,
		{
			query: { range },
			signal,
		},
	);
}

export function getChannelHistory(
	channelId: string,
	signal?: AbortSignal,
): Promise<ChannelHistoryResponse> {
	return getJson(
		API_ROUTES.channelHistory(encodeURIComponent(channelId)),
		channelHistoryResponse,
		{
			signal,
		},
	);
}

/**
 * `@handle` -> channel id, from channels the server has seen. Rejects with an
 * `ApiError` whose `isNotFound` is true when the handle is unknown.
 */
export function resolveChannelHandle(
	handle: string,
	signal?: AbortSignal,
): Promise<ChannelResolveResponse> {
	return getJson(channelResolvePath(handle), channelResolveResponse, {
		signal,
	});
}

const healthResponse = z.object({ ok: z.boolean() });

/** Resolves to false instead of throwing when the server is down. */
export async function getServerHealth(signal?: AbortSignal): Promise<boolean> {
	try {
		const res = await fetch(apiUrl(API_ROUTES.health), { signal });
		const parsed = healthResponse.safeParse(
			await res.json().catch(() => undefined),
		);
		return res.ok && parsed.success && parsed.data.ok;
	} catch (error) {
		if (isAbortError(error)) throw error;
		return false;
	}
}

/** Human-readable message for any error thrown by this module. */
export function errorMessage(error: unknown): string {
	if (error instanceof ApiError) return error.message;
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong.";
}
