/**
 * Adaptive Chat Completions parameters. BACKGROUND ONLY.
 *
 * OpenAI-compatible providers disagree on parameters: GPT-6 rejects
 * `max_tokens` (it wants `max_completion_tokens`) and a custom `temperature`
 * unless reasoning effort is "none"; Mistral answers 422 to any unknown
 * field; LM Studio rejects `json_object`; models accept different
 * `reasoning_effort` values.
 *
 * `adaptiveChat()` builds the body from the settings, built-in model hints
 * and what was learned before, then, on a 400/422 that names a parameter we
 * actually sent, adjusts only that parameter and retries (at most
 * MAX_ATTEMPTS requests, only when the body changed, never on 401/403/404/
 * timeout/network errors; a 429/503 is resent once after a short wait).
 * What the provider stated is persisted per (baseURL, model) in
 * `aiModelCaps`, so the next request is right the first time; out-of-range
 * values and guesses only change the current request.
 */
import type { APIError } from "openai";
import type {
	ChatCompletion,
	ChatCompletionChunk,
	ChatCompletionCreateParamsNonStreaming,
	ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { Stream } from "openai/streaming";

import { aiModelCaps } from "../settings";
import { createAiClient, GENERATION_REQUEST } from "./client";
import {
	hasParamWording,
	isInputRejection,
	isModelRejection,
	isRequestRejection,
	providerErrorText,
	retryDelayMs,
	sleep,
} from "./errors";
import { effectivePreset, isOpenAiHost } from "./providers";
import {
	type AiModelCaps,
	type AiProviderSettings,
	isReasoningEffort,
	REASONING_EFFORTS,
	type ReasoningEffort,
	type ReasoningEffortSetting,
	type TokenParam,
} from "./types";

export const MAX_ATTEMPTS = 4;
const CAPS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CAPS_MAX_ENTRIES = 200;

// ---------------------------------------------------------------------------
// Model hints (static, from the providers' docs)
// ---------------------------------------------------------------------------

/** "openai/gpt-6-luna" -> "gpt-6-luna" (any vendor prefix), lowercased. */
export function bareModelId(model: string): string {
	return model
		.trim()
		.replace(/^~?[\w.-]+\//, "")
		.toLowerCase();
}

/** The OpenAI model id when `model` is one (bare or "openai/…"), else null. */
export function openAiModelId(model: string): string | null {
	const m = /^(~?openai\/)?([^/]+)$/i.exec(model.trim());
	return m?.[2] ? m[2].toLowerCase() : null;
}

/**
 * OpenAI reasoning models (o-series, GPT-5, GPT-6): they reject custom
 * temperature/top_p unless reasoning effort is "none".
 */
export function isOpenAiReasoningModel(model: string): boolean {
	const id = openAiModelId(model);
	if (!id || /-chat(-latest)?$/.test(id)) return false;
	return /^(o\d+(-|$)|gpt-[56]([.-]|$))/.test(id);
}

/** Never accept a custom temperature, whatever the effort. */
const NO_TEMPERATURE_RE = /^(o\d+(-|$)|gpt-6(\.\d+)?-astra\b)/;

/** reasoning_effort values known to be rejected (matched on bareModelId). */
const EFFORT_HINTS: readonly { re: RegExp; rejected: ReasoningEffort[] }[] = [
	// OpenAI, Nov 2026
	{ re: /^gpt-6(\.\d+)?-(luna|terra)\b/, rejected: ["minimal"] },
	{ re: /^gpt-6\.1-sol\b/, rejected: ["none", "minimal"] },
	{ re: /^(gpt-6(\.\d+)?-astra|gpt-6\.2-sol)\b/, rejected: ["none"] },
	// gpt-oss (Groq, Together, Ollama): low / medium / high only
	{ re: /^gpt-oss\b/, rejected: ["none", "minimal", "xhigh", "max"] },
	// Gemini 3+/4 can't switch thinking off; xhigh only on 4-neon/hydrogen
	{ re: /^gemini-[34]/, rejected: ["none", "max"] },
	{ re: /^gemini-(3|4-(?!neon|hydrogen))/, rejected: ["xhigh"] },
];

export function hintedRejectedEfforts(model: string): ReasoningEffort[] {
	const id = bareModelId(model);
	return EFFORT_HINTS.filter((h) => h.re.test(id)).flatMap((h) => h.rejected);
}

/**
 * `requested` if allowed, else the closest allowed value, ties going toward
 * "medium" (the most widely supported: minimal -> low, xhigh -> high), or
 * null when nothing is allowed.
 */
export function nearestEffort(
	requested: ReasoningEffort,
	rejected: ReadonlySet<string>,
): ReasoningEffort | null {
	const order = REASONING_EFFORTS;
	const i = order.indexOf(requested);
	if (!rejected.has(requested)) return requested;
	const upFirst = i <= order.indexOf("medium");
	for (let d = 1; d < order.length; d++) {
		const hi = order[i + d];
		const lo = order[i - d];
		for (const e of upFirst ? [hi, lo] : [lo, hi])
			if (e && !rejected.has(e)) return e;
	}
	return null;
}

export function defaultTokenParam(s: {
	presetId: string;
	baseURL: string;
}): TokenParam {
	return isOpenAiHost(s.baseURL)
		? "max_completion_tokens"
		: effectivePreset(s).tokenParam;
}

// ---------------------------------------------------------------------------
// Learned capabilities (chrome.storage.local "aiModelCaps")
// ---------------------------------------------------------------------------

export function normalizeBaseUrl(baseURL: string): string {
	return baseURL.trim().replace(/\/+$/, "").toLowerCase();
}

export function capsKey(baseURL: string, model: string): string {
	return `${normalizeBaseUrl(baseURL)}|${model.trim()}`;
}

const fresh = (c: AiModelCaps | undefined, now: number): c is AiModelCaps =>
	!!c && typeof c === "object" && now - (Number(c.at) || 0) < CAPS_TTL_MS;

/** Learned caps for a key (null when unknown, older than ~30 days, or unreadable). */
export async function loadCaps(
	key: string,
	now = Date.now(),
): Promise<AiModelCaps | null> {
	try {
		const entry = (await aiModelCaps.getValue())?.[key];
		return fresh(entry, now) ? entry : null;
	} catch {
		return null;
	}
}

export type CapsPatch = Omit<AiModelCaps, "at">;

function union<T>(a?: T[], b?: T[]): T[] | undefined {
	const out = [...new Set([...(a ?? []), ...(b ?? [])])];
	return out.length ? out : undefined;
}

/** `patch` merged over `prev` (arrays are unions, flags stay set). */
export function mergePatch(
	prev: CapsPatch | undefined,
	patch: CapsPatch,
): CapsPatch {
	const out: CapsPatch = {};
	const tokenParam = patch.tokenParam ?? prev?.tokenParam;
	if (tokenParam) out.tokenParam = tokenParam;
	if (patch.noReasoningEffort || prev?.noReasoningEffort)
		out.noReasoningEffort = true;
	if (patch.noJsonMode || prev?.noJsonMode) out.noJsonMode = true;
	if (patch.noQuality || prev?.noQuality) out.noQuality = true;
	const t = union(prev?.noTemperatureWith, patch.noTemperatureWith);
	if (t) out.noTemperatureWith = t;
	const e = union(prev?.rejectedEfforts, patch.rejectedEfforts);
	if (e) out.rejectedEfforts = e;
	const z = union(prev?.rejectedSizes, patch.rejectedSizes);
	if (z) out.rejectedSizes = z;
	return out;
}

export function mergeCaps(
	prev: AiModelCaps | undefined,
	patch: CapsPatch,
	at: number,
): AiModelCaps {
	return { ...mergePatch(prev, patch), at };
}

export function isEmptyPatch(p: CapsPatch): boolean {
	return !Object.values(p).some((v) =>
		Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false,
	);
}

let writeChain: Promise<void> = Promise.resolve();

/**
 * Merges `patch` into the stored caps (serialized, capped to the newest
 * CAPS_MAX_ENTRIES fresh entries). Never throws.
 */
export function rememberCaps(key: string, patch: CapsPatch): Promise<void> {
	if (isEmptyPatch(patch)) return writeChain;
	const run = async () => {
		try {
			const now = Date.now();
			const all = { ...((await aiModelCaps.getValue()) ?? {}) };
			const prev = all[key];
			all[key] = mergeCaps(fresh(prev, now) ? prev : undefined, patch, now);
			const kept = Object.entries(all)
				.filter(([, v]) => fresh(v, now))
				.sort((a, b) => b[1].at - a[1].at)
				.slice(0, CAPS_MAX_ENTRIES);
			await aiModelCaps.setValue(Object.fromEntries(kept));
		} catch (error) {
			console.debug("[GrowTube] couldn't save model capabilities:", error);
		}
	};
	writeChain = writeChain.then(run, run);
	return writeChain;
}

/** Resolves once pending caps writes are done (tests, diagnostics). */
export function flushCapsWrites(): Promise<void> {
	return writeChain;
}

// ---------------------------------------------------------------------------
// Error attribution
// ---------------------------------------------------------------------------

type ChatParam =
	| "max_tokens"
	| "max_completion_tokens"
	| "temperature"
	| "reasoning_effort"
	| "response_format";

/** Exact parameter names in a provider error (lowercased text). */
export const PARAM_PATTERNS: Record<ChatParam, RegExp> = {
	max_tokens: /\bmax_tokens\b/,
	max_completion_tokens: /\bmax_completion_tokens\b/,
	temperature: /\btemperature\b/,
	reasoning_effort: /reasoning[_.]?effort/,
	response_format: /response_format/,
};

/** Looser wording, only checked when no exact name matched. */
const LOOSE_PATTERNS: Partial<Record<ChatParam, RegExp>> = {
	reasoning_effort: /\breasoning\b|\bthinking\b|\beffort\b/,
	response_format: /json_object|json[ _-]?mode/,
};

/**
 * Body fields named by pydantic-style 422s ({"detail":[{"loc":["body","x",…]}]}):
 * the top-level field ("messages" for ["body","messages",1,"content"]).
 */
function pydanticFields(error: APIError): string[] {
	const detail = (error.error as { detail?: unknown } | undefined)?.detail;
	if (!Array.isArray(detail)) return [];
	return detail.flatMap((d) => {
		const loc = (d as { loc?: unknown })?.loc;
		if (!Array.isArray(loc)) return [];
		const field = loc[0] === "body" && loc.length > 1 ? loc[1] : loc.at(-1);
		return typeof field === "string" ? [field.toLowerCase()] : [];
	});
}

/** `"input": …` / `'input': …` (validators echoing the user's text back). */
const ECHOED_INPUT_RE =
	/(['"])input\1\s*:\s*(?:'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\[[^\]]*\]|\{[^}]*\}|[^,}\]\s]+)/gi;

/**
 * What the provider said about the request (message, `param`, `code`),
 * lowercased, without echoed input values: only this is used to attribute
 * an error to a parameter, so prompt text can't be mistaken for one.
 */
export function errorWording(error: APIError): string {
	return [error.message, error.param ?? "", error.code ?? ""]
		.join(" ")
		.replace(ECHOED_INPUT_RE, "")
		.toLowerCase()
		.slice(0, 4_000);
}

/** Rejection wording that makes a quoted copy of a sent value meaningful. */
const REJECTION_WORDING_RE =
	/\b(unsupported|not supported|not (allowed|valid|permitted)|invalid)\b/;

/**
 * Which of the `sent` parameters the error is about. Errors about the input
 * itself (context length, safety filters) name none. Then: `error.param`
 * (when set, it decides alone), pydantic `loc` fields (likewise), the
 * earliest exact name in the wording, looser wording, and a quoted sent
 * value ('minimal', '1280x720') next to rejection wording. Empty when the
 * error is about none of them.
 */
export function rejectedParams<K extends string>(
	error: APIError,
	sent: Partial<Record<K, RegExp>>,
	values: Partial<Record<K, string>> = {},
	loose: Partial<Record<K, RegExp>> = {},
): K[] {
	if (isInputRejection(error)) return [];
	const keys = Object.keys(sent) as K[];
	const param = error.param?.toLowerCase();
	if (param) return keys.filter((k) => sent[k]?.test(param)).slice(0, 1);
	const fields = pydanticFields(error);
	if (fields.length)
		return keys.filter((k) => fields.some((f) => sent[k]?.test(f)));
	const text = errorWording(error);
	for (const patterns of [sent, loose]) {
		let best: { k: K; at: number } | null = null;
		for (const k of keys) {
			const re = patterns[k];
			const at = re ? text.search(re) : -1;
			if (at >= 0 && (!best || at < best.at)) best = { k, at };
		}
		if (best) return [best.k];
	}
	if (!hasParamWording(error) && !REJECTION_WORDING_RE.test(text)) return [];
	for (const k of keys) {
		const v = values[k]?.toLowerCase();
		if (v && quotes(text, v)) return [k];
	}
	return [];
}

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Does `text` contain `value` in quotes ('x', "x", `x`)? */
function quotes(text: string, value: string): boolean {
	return new RegExp(`['"\`]${escapeRe(value)}['"\`]`).test(text);
}

/**
 * "Supported values are: 'low', 'medium'…" -> the efforts quoted after it
 * (never matches inside "Unsupported value: …").
 */
export function supportedEffortsIn(text: string): ReasoningEffort[] {
	const m =
		/(?<![a-z])(?:supported values?(?: (?:are|is|include))?|must be one of|allowed values? (?:are|is)|valid values? (?:are|is)|expected one of|input should be|possible values? (?:are|is))\s*:?\s*([^\n]*)/i.exec(
			text,
		);
	if (!m?.[1]) return [];
	const found = [...m[1].matchAll(/['"`](\w+)['"`]/g)]
		.map((x) => x[1]?.toLowerCase())
		.filter(isReasoningEffort);
	return [...new Set(found)];
}

/** An effort error about one value (vs. the parameter as a whole). */
const VALUE_LEVEL_RE =
	/unsupported value|unsupported_value|invalid value|invalid_value|not a valid (value|option|choice)/;

/** "Too large / must be <= …": the value is out of range, the parameter is fine. */
const RANGE_RE =
	/too (large|small|high|low|big|long|short)|(less|greater)[ _]than|at (most|least)|must be (between|positive|non-negative|in the range|[<>]=?)|out of (range|bounds)|exceeds?\b|(above|below) (the )?(max|min)|_(above|below)_(max|min)|maximum (value|allowed)|minimum (value|allowed)|maximum context length/;
const UNSUPPORTED_RE =
	/unsupported|not supported|unrecognized|unknown (parameter|field|argument)|extra inputs|extra_forbidden|not (allowed|permitted|enabled)|does not support/;

/** The error says a value is out of range (not that the parameter is unsupported). */
export function isRangeError(text: string): boolean {
	return RANGE_RE.test(text) && !UNSUPPORTED_RE.test(text);
}

/** Gemini's "Request contains an invalid argument." (names nothing). */
const GENERIC_INVALID_RE =
	/\binvalid_argument\b|request contains an invalid argument/;

// ---------------------------------------------------------------------------
// Request building
// ---------------------------------------------------------------------------

export type AdaptiveChatOptions = {
	messages: ChatCompletionMessageParam[];
	/** Override the configured model */
	model?: string;
	/** Defaults to the settings' temperature */
	temperature?: number;
	/** Output cap. Nothing is sent when omitted. */
	maxTokens?: number;
	/** Ask for response_format json_object */
	jsonMode?: boolean;
	/** Defaults to the settings' reasoningEffort ("" = not sent) */
	reasoningEffort?: ReasoningEffortSetting;
	signal?: AbortSignal;
};

/** What the request ended up sending. */
export type ChatParamState = {
	tokenParam: TokenParam | "none";
	sendTemperature: boolean;
	effort: ReasoningEffort | null;
	jsonMode: boolean;
};

export type AdaptiveResult<T> = {
	response: T;
	/** Requests made (1 = right the first time) */
	attempts: number;
	/** Human-readable notes on what was adapted for this model */
	adjustments: string[];
	sent: ChatParamState & { model: string; maxTokens: number | null };
};

type Ctx = {
	s: AiProviderSettings;
	model: string;
	opts: AdaptiveChatOptions;
	caps: AiModelCaps | null;
	/** Learned in this call (persisted: the provider named it) */
	learned: CapsPatch;
	/** The one guess for an error that names nothing was already tried */
	guessed: boolean;
};

function temperatureValue(ctx: Ctx): number | null {
	const t = ctx.opts.temperature ?? ctx.s.temperature;
	return typeof t === "number" && Number.isFinite(t) ? t : null;
}

function temperatureAllowed(ctx: Ctx, effort: ReasoningEffort | null): boolean {
	const id = openAiModelId(ctx.model);
	if (id && NO_TEMPERATURE_RE.test(id)) return false;
	if (isOpenAiReasoningModel(ctx.model) && effort !== "none") return false;
	const key = effort ?? "";
	const rejected = union(
		ctx.caps?.noTemperatureWith,
		ctx.learned.noTemperatureWith,
	);
	return !rejected?.includes(key);
}

function rejectedEffortSet(ctx: Ctx): Set<string> {
	return new Set([
		...hintedRejectedEfforts(ctx.model),
		...(ctx.caps?.rejectedEfforts ?? []),
		...(ctx.learned.rejectedEfforts ?? []),
	]);
}

function requestedEffort(ctx: Ctx): ReasoningEffort | null {
	const r = ctx.opts.reasoningEffort ?? ctx.s.reasoningEffort ?? "";
	return isReasoningEffort(r) ? r : null;
}

function initialState(ctx: Ctx, notes: string[]): ChatParamState {
	const requested = requestedEffort(ctx);
	let effort: ReasoningEffort | null = null;
	if (requested && !ctx.caps?.noReasoningEffort) {
		effort = nearestEffort(requested, rejectedEffortSet(ctx));
		if (effort !== requested)
			notes.push(
				effort
					? `reasoning effort "${requested}" isn't supported by this model; using "${effort}"`
					: "reasoning effort isn't supported by this model; not sent",
			);
	} else if (requested) {
		notes.push("reasoning effort isn't supported by this model; not sent");
	}
	const temp = temperatureValue(ctx);
	const sendTemperature = temp != null && temperatureAllowed(ctx, effort);
	if (temp != null && !sendTemperature) {
		const id = openAiModelId(ctx.model);
		notes.push(
			(id && NO_TEMPERATURE_RE.test(id)) ||
				!isOpenAiReasoningModel(ctx.model) ||
				effort === "none"
				? "temperature not sent (this model rejects custom values)"
				: requested === "none"
					? "temperature not sent (it needs reasoning effort None, which this model doesn't support)"
					: "temperature not sent (reasoning models only accept it with reasoning effort None)",
		);
	}
	const tokenParam = ctx.caps?.tokenParam ?? defaultTokenParam(ctx.s);
	const jsonMode = !!ctx.opts.jsonMode && !ctx.caps?.noJsonMode;
	return { tokenParam, sendTemperature, effort, jsonMode };
}

export function buildChatBody(
	ctx: Pick<Ctx, "s" | "model" | "opts">,
	state: ChatParamState,
): ChatCompletionCreateParamsNonStreaming {
	const body: Record<string, unknown> = {
		model: ctx.model,
		messages: ctx.opts.messages,
	};
	const t = ctx.opts.temperature ?? ctx.s.temperature;
	if (state.sendTemperature && typeof t === "number") body.temperature = t;
	if (ctx.opts.maxTokens && state.tokenParam !== "none")
		body[state.tokenParam] = Math.max(1, Math.round(ctx.opts.maxTokens));
	if (state.effort) body.reasoning_effort = state.effort;
	if (state.jsonMode) body.response_format = { type: "json_object" };
	return body as unknown as ChatCompletionCreateParamsNonStreaming;
}

const signature = (state: ChatParamState, capped: boolean) =>
	JSON.stringify([
		capped ? state.tokenParam : "-",
		state.sendTemperature,
		state.effort,
		state.jsonMode,
	]);

/**
 * Adjusts `state` for a 400/422. Returns a note describing the change, or
 * null when the error isn't about a parameter we sent. Only what the
 * provider stated (a parameter or value it doesn't support) goes into
 * `ctx.learned`; out-of-range values and guesses change this request only.
 */
function adjust(
	error: APIError,
	ctx: Ctx,
	state: ChatParamState,
	triedTokenParams: Set<string>,
): string | null {
	if (isInputRejection(error)) return null;
	const sent: Partial<Record<ChatParam, RegExp>> = {};
	if (ctx.opts.maxTokens && state.tokenParam !== "none")
		sent[state.tokenParam] = PARAM_PATTERNS[state.tokenParam];
	if (state.sendTemperature) sent.temperature = PARAM_PATTERNS.temperature;
	if (state.effort) sent.reasoning_effort = PARAM_PATTERNS.reasoning_effort;
	if (state.jsonMode) sent.response_format = PARAM_PATTERNS.response_format;
	const loose: Partial<Record<ChatParam, RegExp>> = {};
	if (state.effort) loose.reasoning_effort = LOOSE_PATTERNS.reasoning_effort;
	if (state.jsonMode) loose.response_format = LOOSE_PATTERNS.response_format;
	const hits = rejectedParams(
		error,
		sent,
		{ reasoning_effort: state.effort ?? undefined },
		loose,
	);
	const text = errorWording(error);
	if (!hits.length) {
		// Gemini answers "Request contains an invalid argument." without
		// naming it: the user-chosen effort is the usual suspect. One retry
		// without it, for this request only (never learned).
		if (
			state.effort &&
			!ctx.guessed &&
			!isModelRejection(error) &&
			GENERIC_INVALID_RE.test(providerErrorText(error))
		) {
			ctx.guessed = true;
			state.effort = null;
			const notes = [
				"reasoning effort not sent (the provider rejected the request without saying why)",
			];
			if (state.sendTemperature && !temperatureAllowed(ctx, null)) {
				state.sendTemperature = false;
				notes.push("temperature not sent (reasoning model)");
			}
			return notes.join("; ");
		}
		return null;
	}
	const range = isRangeError(text);
	const notes: string[] = [];
	for (const hit of hits) {
		if (hit === "max_tokens" || hit === "max_completion_tokens") {
			if (range) {
				// "'max_tokens' … is too large: 4096" (small context window): the
				// parameter works, the cap doesn't fit. No cap for this request.
				state.tokenParam = "none";
				notes.push(
					`no output cap (${ctx.opts.maxTokens} tokens is more than this model allows here)`,
				);
				continue;
			}
			triedTokenParams.add(hit);
			const alt: TokenParam =
				hit === "max_tokens" ? "max_completion_tokens" : "max_tokens";
			state.tokenParam = triedTokenParams.has(alt) ? "none" : alt;
			ctx.learned.tokenParam = state.tokenParam;
			notes.push(
				state.tokenParam === "none"
					? "no output cap (the provider rejects max_tokens and max_completion_tokens)"
					: `${alt} instead of ${hit}`,
			);
		} else if (hit === "temperature") {
			state.sendTemperature = false;
			if (range) {
				notes.push(
					"temperature not sent (outside the range this provider accepts; lower it in Settings → AI)",
				);
				continue;
			}
			const key = state.effort ?? "";
			ctx.learned.noTemperatureWith = union(ctx.learned.noTemperatureWith, [
				key,
			]);
			notes.push("temperature not sent (this model rejects custom values)");
		} else if (hit === "response_format") {
			ctx.learned.noJsonMode = true;
			state.jsonMode = false;
			notes.push("JSON mode off (response_format rejected)");
		} else if (hit === "reasoning_effort" && state.effort) {
			const value = state.effort;
			const requested = requestedEffort(ctx) ?? value;
			// One value is rejected only when the error says so (quotes it,
			// lists the supported ones, or says "unsupported value"); any other
			// rejection is about the parameter itself.
			const supported = supportedEffortsIn(text);
			const valueLevel =
				supported.length > 0 ||
				quotes(text, value) ||
				VALUE_LEVEL_RE.test(text);
			if (!valueLevel) {
				ctx.learned.noReasoningEffort = true;
				state.effort = null;
			} else {
				const rejected: ReasoningEffort[] = [value];
				if (supported.length)
					rejected.push(
						...REASONING_EFFORTS.filter((e) => !supported.includes(e)),
					);
				ctx.learned.rejectedEfforts = union(
					ctx.learned.rejectedEfforts,
					rejected,
				);
				state.effort = nearestEffort(requested, rejectedEffortSet(ctx));
				if (!state.effort) ctx.learned.noReasoningEffort = true;
			}
			notes.push(
				state.effort
					? `reasoning effort "${value}" rejected; using "${state.effort}"`
					: "reasoning effort not sent (rejected by this model)",
			);
			// A different effort can change whether temperature is allowed.
			if (state.sendTemperature && !temperatureAllowed(ctx, state.effort)) {
				state.sendTemperature = false;
				notes.push("temperature not sent (reasoning model)");
			}
		}
	}
	return notes.join("; ") || null;
}

/** Text of a message/delta `content` (string, or Mistral-style chunk list). */
export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			const p = part as { type?: unknown; text?: unknown };
			return (p?.type === "text" || p?.type === undefined) &&
				typeof p?.text === "string"
				? p.text
				: "";
		})
		.join("");
}

/**
 * One Chat Completions request with adaptive parameters. Throws the SDK
 * error of the last attempt (map it with toAiError).
 */
export async function adaptiveChat(
	s: AiProviderSettings,
	opts: AdaptiveChatOptions & { stream: true },
): Promise<AdaptiveResult<Stream<ChatCompletionChunk>>>;
export async function adaptiveChat(
	s: AiProviderSettings,
	opts: AdaptiveChatOptions & { stream?: false },
): Promise<AdaptiveResult<ChatCompletion>>;
export async function adaptiveChat(
	s: AiProviderSettings,
	opts: AdaptiveChatOptions & { stream?: boolean },
): Promise<AdaptiveResult<ChatCompletion | Stream<ChatCompletionChunk>>> {
	const model = opts.model?.trim() || s.model.trim();
	const key = capsKey(s.baseURL, model);
	const ctx: Ctx = {
		s,
		model,
		opts,
		caps: await loadCaps(key),
		learned: {},
		guessed: false,
	};
	const client = createAiClient(s);
	const adjustments: string[] = [];
	const state = initialState(ctx, adjustments);
	const capped = !!opts.maxTokens;
	const seen = new Set<string>();
	const triedTokenParams = new Set<string>();
	const reqOpts = { ...GENERATION_REQUEST, signal: opts.signal };
	let attempts = 0;
	let resent = false;
	try {
		for (;;) {
			seen.add(signature(state, capped));
			if (capped && state.tokenParam !== "none")
				triedTokenParams.add(state.tokenParam);
			const body = buildChatBody(ctx, state);
			attempts++;
			try {
				const response = opts.stream
					? await client.chat.completions.create(
							{ ...body, stream: true },
							reqOpts,
						)
					: await client.chat.completions.create(body, reqOpts);
				return {
					response,
					attempts,
					adjustments,
					sent: {
						...state,
						model,
						maxTokens:
							capped && state.tokenParam !== "none"
								? (opts.maxTokens ?? null)
								: null,
					},
				};
			} catch (error) {
				if (opts.signal?.aborted) throw error;
				// 429 / 503: nothing was generated, so one resend is safe.
				const wait = resent ? null : retryDelayMs(error);
				if (wait != null && attempts < MAX_ATTEMPTS) {
					resent = true;
					await sleep(wait, opts.signal);
					continue;
				}
				if (!isRequestRejection(error)) throw error;
				// Adjust (and learn) before the attempt limit, so the last
				// rejection is remembered too.
				const note = adjust(error, ctx, state, triedTokenParams);
				if (
					!note ||
					attempts >= MAX_ATTEMPTS ||
					seen.has(signature(state, capped))
				)
					throw error;
				adjustments.push(note);
			}
		}
	} finally {
		// What the provider stated is kept even if a later attempt failed.
		void rememberCaps(key, ctx.learned);
	}
}
