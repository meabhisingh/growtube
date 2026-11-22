/** Friendly, actionable AI errors (provider-agnostic). */
import {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	APIUserAbortError,
	AuthenticationError,
	BadRequestError,
	InternalServerError,
	NotFoundError,
	PermissionDeniedError,
	RateLimitError,
	UnprocessableEntityError,
} from "openai";

import { originOf } from "../permissions";
import type { AiErrorCode } from "./types";

export class AiError extends Error {
	readonly code: AiErrorCode;
	constructor(code: AiErrorCode, message: string) {
		super(message);
		this.name = "AiError";
		this.code = code;
	}
}

const isOllama = (baseURL: string) =>
	/:11434\b/.test(baseURL) || /ollama/i.test(baseURL);
const isLocal = (baseURL: string) =>
	/\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(baseURL);

function providerMessage(error: APIError): string {
	const inner = (error.error as { message?: unknown } | undefined)?.message;
	const raw =
		typeof inner === "string"
			? inner
			: typeof error.message === "string"
				? error.message
				: "";
	return raw.replace(/^\d{3}\s*/, "").slice(0, 300);
}

/**
 * Everything the provider said about a failed request (message, JSON body,
 * `param`, `code`), for parameter detection. Lowercased.
 */
export function providerErrorText(error: APIError): string {
	let body = "";
	try {
		body = JSON.stringify(error.error ?? "");
	} catch {
		body = "";
	}
	return [error.message, body, error.param ?? "", error.code ?? ""]
		.join(" ")
		.toLowerCase()
		.slice(0, 4_000);
}

/** 400 / 422: the request itself was rejected (not auth, quota or routing). */
export function isRequestRejection(error: unknown): error is APIError {
	return (
		error instanceof BadRequestError ||
		error instanceof UnprocessableEntityError
	);
}

/** Client request timeout (`createAiClient`'s `timeout`). */
export const REQUEST_TIMEOUT_MS = 10 * 60_000;

/**
 * Delay before one retry of a 429/503 (nothing was generated, so it is safe
 * to resend), or null when it shouldn't be retried. Generation requests run
 * with SDK retries off so a slow/timed-out request is never sent (and billed)
 * twice.
 */
export function retryDelayMs(error: unknown): number | null {
	const status = (error as { status?: unknown })?.status;
	if (
		!(error instanceof RateLimitError) &&
		!(error instanceof InternalServerError && status === 503)
	)
		return null;
	const headers = (error as APIError).headers;
	const ms = Number(headers?.get?.("retry-after-ms"));
	const s = Number(headers?.get?.("retry-after"));
	const wait = Number.isFinite(ms) && ms > 0 ? ms : s > 0 ? s * 1000 : 1_000;
	return wait <= 10_000 ? wait : null;
}

/** Resolves after `ms`, or rejects with the abort reason once `signal` fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new APIUserAbortError());
		let timer: ReturnType<typeof setTimeout> | undefined;
		const onAbort = () => {
			clearTimeout(timer);
			reject(new APIUserAbortError());
		};
		timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/** Rejections about the input itself, never about a request setting. */
const INPUT_CODES = new Set([
	"context_length_exceeded",
	"content_filter",
	"content_policy_violation",
	"invalid_prompt",
	"moderation_blocked",
]);
const SAFETY_CODES = new Set([
	"content_filter",
	"content_policy_violation",
	"invalid_prompt",
	"moderation_blocked",
]);

/**
 * A 400/422 about the prompt/messages (too long, blocked by a safety
 * system), not about a parameter: never attributed to a setting, never
 * learned from.
 */
export function isInputRejection(error: APIError): boolean {
	if (error.code && INPUT_CODES.has(String(error.code))) return true;
	return /^(messages|prompt|input)\b/i.test(String(error.param ?? ""));
}

const PARAM_CODES = new Set([
	"unsupported_parameter",
	"unsupported_value",
	"invalid_parameter",
	"unknown_parameter",
	"invalid_value",
	"extra_forbidden",
]);
const PARAM_RE =
	/unsupported (parameter|value)|unrecognized (request )?argument|unknown (parameter|field|argument)|extra inputs are not permitted|extra_forbidden|not supported (with|by|for|on) this model|does not support .{0,80} with this model|not enabled for this model|does not support thinking|invalid (parameter|value|argument)|must be '?json_schema'? or/i;
const MODEL_CODES = new Set([
	"model_not_found",
	"model_decommissioned",
	"model_not_available",
]);
const MODEL_RE =
	/\bmodel\b[^.]{0,80}\b(not found|does not exist|doesn't exist|not exist|decommissioned|retired|no longer (available|supported))|\b(invalid|unknown|unsupported) model\b|model not exist|no such model/i;

/** Is a 400/422 about a request parameter (not about the model id)? */
export function isParamError(error: APIError): boolean {
	if (error.param === "model" || isInputRejection(error)) return false;
	return !!error.param || hasParamWording(error);
}

/** The error's own wording/code says a parameter or value is unsupported. */
export function hasParamWording(error: APIError): boolean {
	if (error.code && PARAM_CODES.has(String(error.code))) return true;
	return PARAM_RE.test(providerMessage(error)) || PARAM_RE.test(error.message);
}

/** Is a 400/422 about the model id itself (unknown, retired)? */
export function isModelRejection(error: APIError): boolean {
	if (error.code && MODEL_CODES.has(error.code)) return true;
	if (isParamError(error)) return false;
	return error.param === "model" || MODEL_RE.test(providerMessage(error));
}

/** The reply was cut off before any visible text (reasoning ate the budget). */
export function reasoningBudgetError(maxTokens?: number | null): AiError {
	return new AiError(
		"BAD_OUTPUT",
		maxTokens
			? `The model used its whole ${maxTokens}-token output budget on reasoning and wrote no answer. Raise the limit, or set Reasoning effort to Low or None in Settings → AI.`
			: "The model used its whole output budget on reasoning and wrote no answer. Set Reasoning effort to Low or None in Settings → AI, or pick a non-reasoning model.",
	);
}

/** "msg" -> "msg." so a hint can follow it. */
function sentence(msg: string): string {
	return /[.!?]$/.test(msg.trim()) ? msg.trim() : `${msg.trim()}.`;
}

/** Maps SDK/network errors to an AiError with a message the UI can show as-is. */
export function toAiError(
	error: unknown,
	ctx: { baseURL: string; model?: string },
): AiError {
	if (error instanceof AiError) return error;
	const origin = originOf(ctx.baseURL) ?? ctx.baseURL;
	if (
		error instanceof APIUserAbortError ||
		(error instanceof Error && error.name === "AbortError")
	) {
		return new AiError("ABORTED", "Request cancelled.");
	}
	if (error instanceof AuthenticationError) {
		return new AiError(
			"AUTH",
			`${origin} rejected the API key (401). Check the key in open-vidiq Settings → AI.`,
		);
	}
	if (error instanceof PermissionDeniedError) {
		if (isOllama(ctx.baseURL)) {
			return new AiError(
				"OLLAMA_ORIGIN",
				"Ollama refused the request (403). Restart Ollama with the environment variable OLLAMA_ORIGINS=chrome-extension://* so the extension is allowed to call it.",
			);
		}
		return new AiError(
			"AUTH",
			`${origin} denied access (403): ${providerMessage(error) || "your key may lack access to this model."}`,
		);
	}
	if (error instanceof NotFoundError) {
		return new AiError(
			"MODEL",
			`Model "${ctx.model ?? "?"}" was not found at ${origin} (404). Pick a model from the list in Settings → AI, or check the base URL.`,
		);
	}
	if (error instanceof RateLimitError) {
		return new AiError(
			"RATE_LIMIT",
			`${origin} is rate limiting requests or your quota/credits are exhausted (429). ${providerMessage(error)}`.trim(),
		);
	}
	if (isRequestRejection(error)) {
		const msg = providerMessage(error) || "no details";
		const status = error.status ?? 400;
		const model = ctx.model ?? "?";
		if (error.code && MODEL_CODES.has(error.code)) {
			return new AiError(
				"MODEL",
				error.code === "model_decommissioned"
					? `"${model}" was retired by ${origin}. Pick a current model in Settings → AI ("Load models" lists them).`
					: `${origin} doesn't offer model "${model}": ${msg}`,
			);
		}
		if (isInputRejection(error)) {
			return new AiError(
				"UNKNOWN",
				SAFETY_CODES.has(String(error.code))
					? `${origin} blocked the request with its safety system (${status}): ${sentence(msg)} Rephrase the input and try again.`
					: `The input is too long for "${model}" (${status}): ${sentence(msg)} Shorten it, or pick a model with a larger context window in Settings → AI.`,
			);
		}
		// Before the model check: "…is not supported with this model" is about
		// a parameter, not the model id.
		if (isParamError(error)) {
			const hint = /reasoning|effort|thinking/i.test(msg)
				? "Try another Reasoning effort (or Default) in Settings → AI."
				: /max_(completion_)?tokens/i.test(msg)
					? "open-vidiq already retried with the other output-limit parameter and without one; use Test connection in Settings → AI to check the provider."
					: /temperature/i.test(msg)
						? "Try another Temperature in Settings → AI."
						: "Try another model in Settings → AI.";
			return new AiError(
				"PARAMS",
				`${origin} rejected a request setting for "${model}" (${status}): ${sentence(msg)} ${hint}`,
			);
		}
		if (isModelRejection(error)) {
			return new AiError(
				"MODEL",
				`${origin} doesn't offer model "${model}": ${sentence(msg)} Pick a model from the list in Settings → AI.`,
			);
		}
		return new AiError(
			"UNKNOWN",
			`${origin} rejected the request (${status}): ${msg}`,
		);
	}
	if (error instanceof APIConnectionTimeoutError) {
		return new AiError(
			"TIMEOUT",
			`${origin} didn't answer in time (limit: ${REQUEST_TIMEOUT_MS / 60_000} minutes), so the request was stopped and not resent. Lower Reasoning effort or image quality in Settings → AI, check your connection, or try again.`,
		);
	}
	if (error instanceof APIConnectionError) {
		return new AiError(
			"NETWORK",
			isLocal(ctx.baseURL)
				? `Couldn't reach ${origin}. Make sure your local AI server is running${isOllama(ctx.baseURL) ? " (ollama serve)" : ""} and the base URL is correct.`
				: `Couldn't reach ${origin}. Check your connection and the base URL in Settings → AI.`,
		);
	}
	if (error instanceof APIError) {
		return new AiError(
			"UNKNOWN",
			`${origin} returned an error${error.status ? ` (${error.status})` : ""}: ${providerMessage(error) || "unknown error"}`,
		);
	}
	if (error instanceof TypeError) {
		return new AiError("NETWORK", `Couldn't reach ${origin}: ${error.message}`);
	}
	return new AiError(
		"UNKNOWN",
		error instanceof Error ? error.message : String(error),
	);
}
