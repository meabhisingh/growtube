/** One-shot completions, JSON outputs, model listing, images. BACKGROUND ONLY. */
import { NotFoundError } from "openai";
import type { ImageGenerateParamsNonStreaming } from "openai/resources/images";
import { z } from "zod";

import {
	assertProviderReady,
	createAiClient,
	GENERATION_REQUEST,
	getProviderSettings,
} from "./client";
import {
	AiError,
	isInputRejection,
	isModelRejection,
	isRequestRejection,
	reasoningBudgetError,
	retryDelayMs,
	sleep,
	toAiError,
} from "./errors";
import {
	adaptiveChat,
	capsKey,
	contentText,
	loadCaps,
	MAX_ATTEMPTS,
	rejectedParams,
	rememberCaps,
} from "./params";
import { isGeminiHost, isOpenRouterHost, isTogetherHost } from "./providers";
import type {
	AiModelInfo,
	AiProviderSettings,
	ChatMessage,
	ImageQuality,
	ImageSize,
	ReasoningEffortSetting,
} from "./types";

export type { ImageQuality, ImageSize } from "./types";

export type CompleteOptions = {
	/** Override the configured model */
	model?: string;
	temperature?: number;
	/** Output cap (reasoning tokens count against it on reasoning models) */
	maxTokens?: number;
	/** Override the configured reasoning effort ("" = not sent) */
	reasoningEffort?: ReasoningEffortSetting;
	signal?: AbortSignal;
};

/** Pulls the JSON payload out of a model reply (handles ```json fences and chatter). */
export function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidates = [fenced, text].filter((t): t is string => !!t);
	for (const c of candidates) {
		const trimmed = c.trim();
		try {
			return JSON.parse(trimmed);
		} catch {
			// find the outermost {...} or [...]
			const start = trimmed.search(/[[{]/);
			if (start === -1) continue;
			const open = trimmed[start];
			const close = open === "{" ? "}" : "]";
			const end = trimmed.lastIndexOf(close);
			if (end > start) {
				try {
					return JSON.parse(trimmed.slice(start, end + 1));
				} catch {
					// keep looking
				}
			}
		}
	}
	throw new SyntaxError("No JSON found in the model reply");
}

function jsonInstructions(schema: z.ZodType): string {
	let jsonSchema = "";
	try {
		// "input" so transformed fields (e.g. "1:23" -> seconds) describe what the model may send.
		jsonSchema = JSON.stringify(
			z.toJSONSchema(schema, { unrepresentable: "any", io: "input" }),
		);
	} catch {
		jsonSchema = "";
	}
	return [
		"Respond with a single JSON value only: no markdown, no code fences, no commentary.",
		jsonSchema
			? `It must validate against this JSON Schema:\n${jsonSchema}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

type ChatOnceResult = {
	text: string;
	attempts: number;
	adjustments: string[];
};

async function chatOnce(
	s: AiProviderSettings,
	messages: ChatMessage[],
	opts: CompleteOptions & { jsonMode?: boolean },
): Promise<ChatOnceResult> {
	const model = opts.model?.trim() || s.model;
	try {
		const { response, attempts, adjustments, sent } = await adaptiveChat(s, {
			messages,
			model,
			temperature: opts.temperature,
			maxTokens: opts.maxTokens,
			jsonMode: opts.jsonMode,
			reasoningEffort: opts.reasoningEffort,
			signal: opts.signal,
		});
		const choice = response.choices?.[0];
		const text = contentText(choice?.message?.content);
		if (!text.trim() && choice?.finish_reason === "length")
			throw reasoningBudgetError(sent.maxTokens);
		return { text, attempts, adjustments };
	} catch (error) {
		throw toAiError(error, { baseURL: s.baseURL, model });
	}
}

/**
 * One-shot completion. With `json: schema`, the reply is parsed and
 * validated; on failure the model gets one repair attempt with the errors.
 */
export async function aiComplete(
	messages: ChatMessage[],
	opts?: CompleteOptions & { json?: undefined },
): Promise<string>;
export async function aiComplete<S extends z.ZodType>(
	messages: ChatMessage[],
	opts: CompleteOptions & { json: S },
): Promise<z.infer<S>>;
export async function aiComplete(
	messages: ChatMessage[],
	opts: CompleteOptions & { json?: z.ZodType } = {},
): Promise<unknown> {
	const s = await getProviderSettings();
	await assertProviderReady(s);
	if (!opts.json) return (await chatOnce(s, messages, opts)).text;

	const schema = opts.json;
	// Merge into the leading system message: several providers reject system
	// messages anywhere but first.
	const instructions = jsonInstructions(schema);
	const withFormat: ChatMessage[] =
		messages[0]?.role === "system"
			? [
					{
						role: "system",
						content: `${messages[0].content}\n\n${instructions}`,
					},
					...messages.slice(1),
				]
			: [{ role: "system", content: instructions }, ...messages];
	const first = (await chatOnce(s, withFormat, { ...opts, jsonMode: true }))
		.text;
	const attempt = (text: string) => {
		try {
			const parsed = schema.safeParse(extractJson(text));
			return parsed.success
				? { ok: true as const, data: parsed.data }
				: { ok: false as const, error: z.prettifyError(parsed.error) };
		} catch (error) {
			return {
				ok: false as const,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	};
	const r1 = attempt(first);
	if (r1.ok) return r1.data;

	const repaired = (
		await chatOnce(
			s,
			[
				...withFormat,
				{ role: "assistant", content: first.slice(0, 8_000) },
				{
					role: "user",
					content: `That reply was not valid for the required JSON format:\n${r1.error.slice(0, 1_500)}\nReply again with ONLY the corrected JSON.`,
				},
			],
			{ ...opts, jsonMode: true, temperature: 0.2 },
		)
	).text;
	const r2 = attempt(repaired);
	if (r2.ok) return r2.data;
	throw new AiError(
		"BAD_OUTPUT",
		"The model didn't return the expected format, even after a retry. Try again or pick a stronger model in Settings → AI.",
	);
}

/** YYYY-MM-DD from a date string or unix timestamp; null when absent/invalid. */
function toIsoDate(value: unknown): string | null {
	if (typeof value === "string") {
		const ymd = /^\d{4}-\d{2}-\d{2}/.exec(value.trim())?.[0];
		if (ymd) return ymd;
		const ms = Date.parse(value);
		return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : null;
	}
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return new Date(value < 1e12 ? value * 1000 : value)
			.toISOString()
			.slice(0, 10);
	}
	return null;
}

/** Models offered by the provider (sorted by id), with announced shutdown dates. */
export async function listModels(
	override?: Partial<AiProviderSettings>,
): Promise<AiModelInfo[]> {
	const s = { ...(await getProviderSettings()), ...override };
	await assertProviderReady(s, { needModel: false });
	const client = createAiClient(s);
	try {
		const byId = new Map<string, AiModelInfo>();
		const add = (m: unknown) => {
			const raw = m as {
				id?: unknown;
				shutdown_date?: unknown;
				expiration_date?: unknown;
			} | null;
			if (typeof raw?.id !== "string" || byId.size >= 2_000) return;
			const id = raw.id.replace(/^models\//, "");
			byId.set(id, {
				id,
				// OpenAI: shutdown_date; OpenRouter: expiration_date.
				shutdownDate: toIsoDate(raw.shutdown_date ?? raw.expiration_date),
			});
		};
		for await (const m of client.models.list()) {
			add(m);
			if (byId.size >= 2_000) break;
		}
		if (!byId.size) {
			// Together answers with a bare array instead of { data: [...] }.
			const body = await client.get<unknown>("/models");
			const list = Array.isArray(body)
				? body
				: (body as { data?: unknown } | null)?.data;
			if (Array.isArray(list)) for (const m of list) add(m);
		}
		return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
	} catch (error) {
		throw toAiError(error, { baseURL: s.baseURL });
	}
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	svg: "image/svg+xml",
};

/** Mime type from the first bytes of base64 image data (png when unknown). */
export function sniffImageMime(b64: string): string {
	let head = "";
	try {
		head = atob(b64.slice(0, 24).replace(/[^A-Za-z0-9+/]/g, ""));
	} catch {
		return "image/png";
	}
	if (head.startsWith("\x89PNG")) return "image/png";
	if (head.startsWith("\xFF\xD8\xFF")) return "image/jpeg";
	if (head.startsWith("GIF8")) return "image/gif";
	if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP")
		return "image/webp";
	if (/^\s*(<svg|<\?xml)/i.test(head)) return "image/svg+xml";
	return "image/png";
}

function base64Of(bytes: Uint8Array): string {
	let bin = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

async function urlToDataUrl(
	url: string,
	signal?: AbortSignal,
): Promise<string> {
	try {
		const res = await fetch(url, { signal });
		if (!res.ok) return url;
		const blob = await res.blob();
		const b64 = base64Of(new Uint8Array(await blob.arrayBuffer()));
		const type = blob.type.startsWith("image/")
			? blob.type
			: sniffImageMime(b64);
		return `data:${type};base64,${b64}`;
	} catch {
		// Cross-origin image host without permission: hand back the URL.
		return url;
	}
}

/** Sizes to try, best first; null = don't send a size. */
function sizeChain(
	size: ImageSize | undefined,
	rejected: string[],
): (string | null)[] {
	const chain: (string | null)[] =
		!size || size === "auto"
			? [null]
			: size === "1280x720"
				? ["1280x720", "1536x1024", null]
				: [size, null];
	return chain.filter((z) => z === null || !rejected.includes(z));
}

const ASPECT: Record<string, string> = {
	"1280x720": "16:9",
	"1536x1024": "3:2",
	"1024x1024": "1:1",
	"1024x1536": "2:3",
};

/** How a size is expressed for this provider. */
function sizeFields(
	baseURL: string,
	size: string | null,
): Record<string, unknown> {
	if (!size) return {};
	// OpenRouter normalizes sizes as aspect_ratio; Together wants width/height.
	if (isOpenRouterHost(baseURL) && ASPECT[size])
		return { aspect_ratio: ASPECT[size] };
	if (isTogetherHost(baseURL)) {
		const [width, height] = size.split("x").map(Number);
		return { width, height };
	}
	return { size };
}

/**
 * Provider-specific extras. Gemini's OpenAI-compatible images endpoint
 * documents `response_format: "b64_json"` (OpenAI's GPT image models reject
 * the parameter, so it is never sent elsewhere).
 */
function imageExtras(baseURL: string): Record<string, unknown> {
	return isGeminiHost(baseURL) ? { response_format: "b64_json" } : {};
}

export type GenerateImageOptions = {
	size?: ImageSize;
	quality?: ImageQuality;
	model?: string;
	n?: number;
	signal?: AbortSignal;
};

export type GenerateImageResult = {
	/** data: URLs (or plain URLs the background couldn't fetch) */
	images: string[];
	/** Size actually requested (null = provider default) */
	size: string | null;
	/** What was adapted, e.g. "1280x720 isn't supported; used 1536x1024" */
	adjustments: string[];
};

/**
 * Generates images via `images.generate`. Never sends response_format to
 * OpenAI-style hosts (GPT image models reject it and always return base64;
 * only Gemini gets its documented "b64_json"); reads b64_json or url.
 * Without `size` (or with "auto") no size is sent (provider default). A
 * rejected size steps down 1280x720 -> 1536x1024 -> provider default, a
 * rejected quality is dropped, and both are remembered for the model; a 400
 * that names nothing tries the next size once without remembering it.
 */
export async function generateImage(
	prompt: string,
	opts: GenerateImageOptions = {},
): Promise<GenerateImageResult> {
	const s = await getProviderSettings();
	await assertProviderReady(s, { needModel: false });
	const model = opts.model?.trim() || s.imageModel.trim();
	if (!model) {
		throw new AiError(
			"NO_IMAGE_SUPPORT",
			"No image model is configured. Set one in Settings → AI (e.g. gpt-image-2.6-sunburst for OpenAI), or use a provider that supports image generation.",
		);
	}
	const client = createAiClient(s);
	const key = capsKey(s.baseURL, model);
	const caps = await loadCaps(key);
	const rejectedSizes: string[] = [];
	let noQuality = false;
	const chain = sizeChain(opts.size, caps?.rejectedSizes ?? []);
	let sizeIdx = 0;
	let quality =
		opts.quality && opts.quality !== "auto" && !caps?.noQuality
			? opts.quality
			: null;
	const adjustments: string[] = [];
	if (opts.size && opts.size !== "auto" && chain[0] !== opts.size)
		adjustments.push(
			`${opts.size} isn't supported by ${model}; used ${chain[0] ?? "the provider's default size"}`,
		);
	const n = Math.max(1, Math.min(opts.n ?? 1, 4));
	let attempts = 0;
	let resent = false;
	let guessed = false;
	try {
		for (;;) {
			const size = chain[sizeIdx] ?? null;
			const body = {
				model,
				prompt,
				n,
				...sizeFields(s.baseURL, size),
				...(quality ? { quality } : {}),
				...imageExtras(s.baseURL),
			} as ImageGenerateParamsNonStreaming;
			attempts++;
			try {
				const res = await client.images.generate(body, {
					...GENERATION_REQUEST,
					signal: opts.signal,
				});
				const error = (res as unknown as { error?: unknown }).error;
				if (!res.data && error) {
					// LM Studio answers unknown endpoints with 200 + { error }.
					throw new AiError(
						"NO_IMAGE_SUPPORT",
						`${s.baseURL} doesn't support image generation: ${String(typeof error === "string" ? error : JSON.stringify(error)).slice(0, 200)}`,
					);
				}
				const declared = res.output_format
					? IMAGE_MIME[res.output_format]
					: undefined;
				const out: string[] = [];
				for (const img of res.data ?? []) {
					if (img.b64_json) {
						const mime = declared ?? sniffImageMime(img.b64_json);
						out.push(`data:${mime};base64,${img.b64_json}`);
					} else if (img.url) {
						out.push(await urlToDataUrl(img.url, opts.signal));
					}
				}
				if (!out.length)
					throw new AiError("BAD_OUTPUT", "The provider returned no image.");
				return { images: out, size, adjustments };
			} catch (error) {
				if (opts.signal?.aborted || attempts >= MAX_ATTEMPTS) throw error;
				// 429 / 503: nothing was generated, so one resend is safe.
				const wait = resent ? null : retryDelayMs(error);
				if (wait != null) {
					resent = true;
					await sleep(wait, opts.signal);
					continue;
				}
				if (!isRequestRejection(error) || isInputRejection(error)) throw error;
				const sent: Partial<Record<"size" | "quality", RegExp>> = {};
				if (size)
					sent.size =
						/\bsize\b|\bwidth\b|\bheight\b|aspect[_ ]?ratio|resolution|dimension|pixel/;
				if (quality) sent.quality = /\bquality\b/;
				let hit = rejectedParams(error, sent, {
					size: size ?? undefined,
					quality: quality ?? undefined,
				})[0];
				// A 400 that names nothing (Gemini: "invalid argument") with a
				// non-default size: try the next size once, without learning it.
				const guess =
					!hit &&
					!guessed &&
					!!size &&
					!error.param &&
					!isModelRejection(error);
				if (guess) {
					guessed = true;
					hit = "size";
				}
				if (hit === "size" && size) {
					if (!guess) rejectedSizes.push(size);
					sizeIdx++;
					const next = chain[sizeIdx] ?? null;
					const why = guess
						? `${model} rejected the request with ${size} (no reason given)`
						: `${size} isn't supported by ${model}`;
					adjustments.push(
						next
							? `${why}; used ${next}`
							: `${why}; used the provider's default size`,
					);
				} else if (hit === "quality" && quality) {
					noQuality = true;
					adjustments.push(`quality "${quality}" isn't supported; not sent`);
					quality = null;
				} else {
					throw error;
				}
			}
		}
	} catch (error) {
		if (error instanceof AiError) throw error;
		if (error instanceof NotFoundError) {
			throw new AiError(
				"NO_IMAGE_SUPPORT",
				`${s.baseURL} doesn't support image generation with "${model}" (404). Choose another image model or provider.`,
			);
		}
		throw toAiError(error, { baseURL: s.baseURL, model });
	} finally {
		// Only what the provider named is recorded, so it's kept either way.
		void rememberCaps(key, { rejectedSizes, noQuality });
	}
}

export type TestResult = {
	ok: true;
	model: string;
	reply: string;
	/** Requests needed (1 = the parameters were right the first time) */
	attempts: number;
	/** What was adapted for this model (also remembered for next time) */
	adjustments: string[];
};

/**
 * Quick connectivity check for the settings page ("Test connection"). Sends
 * a generous output cap (reasoning tokens count against it) so the token
 * parameter the model needs is learned here, not in a real request.
 */
export async function testProvider(
	override?: Partial<AiProviderSettings>,
): Promise<TestResult> {
	const s = { ...(await getProviderSettings()), ...override };
	await assertProviderReady(s);
	const res = await chatOnce(
		s,
		[{ role: "user", content: "Reply with the single word: ok" }],
		{ maxTokens: 4_096 },
	);
	return {
		ok: true,
		model: s.model,
		reply: res.text.trim().slice(0, 80),
		attempts: res.attempts,
		adjustments: res.adjustments,
	};
}
