/**
 * Known retired / deprecated model ids and their replacements (pure, safe to
 * import anywhere). Used by the settings migration and the options page.
 *
 * Sources (Nov 2026): developers.openai.com/api/docs/deprecations,
 * console.groq.com/docs/deprecations, docs.together.ai/docs/deprecations,
 * docs.mistral.ai/models, api-docs.deepseek.com/updates,
 * ai.google.dev/gemini-api/docs/deprecations.
 */
import { effectivePreset, isOpenAiHost, isOpenRouterHost } from "./providers";
import type { AiModelInfo } from "./types";

export type ModelKind = "chat" | "image";

type Rule = {
	re: RegExp;
	kind: ModelKind;
	/** YYYY-MM-DD the provider shuts it down (past = already gone) */
	shutdown: string;
	/** Suggested id (omitted = the preset's default model) */
	replacement?: string;
};

/** OpenAI model ids (matched without an "openai/" vendor prefix). */
const OPENAI_RULES: readonly Rule[] = [
	// Already shut down (Oct 23 2026 unless noted)
	{
		re: /^gpt-image-1(-\d{4}-\d{2}-\d{2})?$/,
		kind: "image",
		shutdown: "2026-10-23",
		replacement: "gpt-image-2.6-sunburst",
	},
	{
		re: /^dall-e-/,
		kind: "image",
		shutdown: "2026-05-12",
		replacement: "gpt-image-2.6-sunburst",
	},
	{
		re: /^(o1|o3-mini|o4-mini|gpt-4\.1-nano|gpt-4-turbo|gpt-3\.5-turbo)\b/,
		kind: "chat",
		shutdown: "2026-10-23",
		replacement: "gpt-6-luna",
	},
	{
		re: /^gpt-4o-2024-05-13$/,
		kind: "chat",
		shutdown: "2026-10-23",
		replacement: "gpt-6-luna",
	},
	{
		re: /^(gpt-5\.1-codex|gpt-5(\.1)?-chat-latest)$/,
		kind: "chat",
		shutdown: "2026-07-23",
	},
	{
		re: /^gpt-5\.[23]-chat-latest$/,
		kind: "chat",
		shutdown: "2026-08-10",
	},
	// Deprecated, shutting down soon
	{
		re: /^(gpt-image-1-mini|gpt-image-1\.5|chatgpt-image-latest)\b/,
		kind: "image",
		shutdown: "2026-12-01",
		replacement: "gpt-image-2.6-sunburst",
	},
	{
		re: /^gpt-image-2(-\d{4}-\d{2}-\d{2})?$/,
		kind: "image",
		shutdown: "2027-02-10",
		replacement: "gpt-image-2.6-sunburst",
	},
	{
		re: /^gpt-5-nano\b/,
		kind: "chat",
		shutdown: "2026-12-11",
		replacement: "gpt-6-luna",
	},
	{
		re: /^gpt-5-mini\b/,
		kind: "chat",
		shutdown: "2026-12-11",
		replacement: "gpt-6.1-terra",
	},
	{
		// gpt-5-pro / o3-pro too (their pro mode is Responses-API only)
		re: /^(gpt-5|o3|gpt-5-pro|o3-pro)(-\d{4}-\d{2}-\d{2})?$/,
		kind: "chat",
		shutdown: "2026-12-11",
		replacement: "gpt-6.1-sol",
	},
	{
		re: /^(gpt-5\.1(-\d{4}-\d{2}-\d{2})?|gpt-5\.3-codex)$/,
		kind: "chat",
		shutdown: "2027-04-01",
		replacement: "gpt-6-sol",
	},
	{
		re: /^gpt-5\.4-nano(-\d{4}-\d{2}-\d{2})?$/,
		kind: "chat",
		shutdown: "2027-04-01",
		replacement: "gpt-6-luna",
	},
	{
		re: /^(gpt-4o|gpt-4\.1)\b/,
		kind: "chat",
		shutdown: "2027-01-14",
		replacement: "gpt-6-luna",
	},
];

/** Retired ids of other presets (old open-vidiq defaults included). */
const PRESET_RULES: Readonly<Record<string, readonly Rule[]>> = {
	groq: [
		{
			re: /^llama-3\.3-70b-versatile$/,
			kind: "chat",
			shutdown: "2026-08-16",
			replacement: "openai/gpt-oss-120b",
		},
		{
			re: /^llama-3\.1-8b-instant$/,
			kind: "chat",
			shutdown: "2026-08-16",
			replacement: "openai/gpt-oss-20b",
		},
		{
			re: /^(qwen\/qwen3-32b|meta-llama\/llama-4-scout-17b-16e-instruct)$/,
			kind: "chat",
			shutdown: "2026-07-17",
			replacement: "openai/gpt-oss-120b",
		},
		{
			re: /^qwen\/qwen3\.6-27b$/,
			kind: "chat",
			shutdown: "2026-09-14",
			replacement: "qwen/qwen3.8-27b",
		},
		{ re: /^groq\/compound(-mini)?$/, kind: "chat", shutdown: "2026-09-21" },
	],
	together: [
		{
			re: /^meta-llama\/(Meta-)?Llama-3\.[123]-/i,
			kind: "chat",
			shutdown: "2026-10-22",
			replacement: "zai-org/GLM-5.3-Flash",
		},
		{
			re: /^meta-llama\/Llama-4-Scout-17B-16E-Instruct$/i,
			kind: "chat",
			shutdown: "2026-02-06",
		},
		{
			re: /^meta-llama\/Llama-4-Maverick-17B-128E-Instruct-FP8$/i,
			kind: "chat",
			shutdown: "2026-03-31",
		},
		{
			re: /^openai\/gpt-oss-20b$/i,
			kind: "chat",
			shutdown: "2026-09-15",
			replacement: "Qwen/Qwen3.5-9B",
		},
		{
			re: /^google\/gemma-4-31B-it$/i,
			kind: "chat",
			shutdown: "2026-09-15",
			replacement: "zai-org/GLM-5.3-Flash",
		},
		{
			re: /^black-forest-labs\/FLUX\.1-/i,
			kind: "image",
			shutdown: "2026-08-19",
			replacement: "black-forest-labs/FLUX.2-dev",
		},
	],
	mistral: [
		{
			re: /^mistral-small-(2503|2506)$/,
			kind: "chat",
			shutdown: "2026-07-31",
			replacement: "mistral-small-latest",
		},
		{
			re: /^mistral-large-2411$/,
			kind: "chat",
			shutdown: "2026-05-31",
			replacement: "mistral-medium-latest",
		},
		{
			re: /^mistral-large-2512$/,
			kind: "chat",
			shutdown: "2027-04-30",
			replacement: "mistral-large-latest",
		},
	],
	deepseek: [
		{
			re: /^deepseek-(chat|reasoner)$/,
			kind: "chat",
			shutdown: "2026-07-24",
			replacement: "deepseek-flash",
		},
	],
	gemini: [
		{
			re: /^gemini-2\.0-/,
			kind: "chat",
			shutdown: "2026-06-01",
			replacement: "gemini-3.8-flash",
		},
		{
			re: /^gemini-3-pro-preview$/,
			kind: "chat",
			shutdown: "2026-03-09",
			replacement: "gemini-3.1-pro-preview",
		},
		{ re: /^gemini-2\.5-flash-preview-/, kind: "chat", shutdown: "2026-02-17" },
		{
			re: /^imagen-/,
			kind: "image",
			shutdown: "2026-08-17",
			replacement: "gemini-nano-banana-2.1",
		},
		{
			re: /^(gemini-3-pro-image-preview|gemini-3\.1-flash-image-preview)$/,
			kind: "image",
			shutdown: "2026-06-25",
			replacement: "gemini-nano-banana-2.1",
		},
		{
			re: /^gemini-2\.5-flash-image-preview$/,
			kind: "image",
			shutdown: "2026-01-15",
			replacement: "gemini-nano-banana-2.1",
		},
	],
};

export type ModelDeprecation = {
	/** "shutdown" = already gone, "deprecated" = still works until `date` */
	status: "deprecated" | "shutdown";
	/** YYYY-MM-DD, null when only the provider's list flags it without a date */
	date: string | null;
	/** Suggested id to switch to (null = none known) */
	replacement: string | null;
};

/** Today as YYYY-MM-DD (UTC, like the providers' dates). */
export function todayIso(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

function ruleFor(
	id: string,
	kind: ModelKind,
	s: { presetId: string; baseURL: string },
): { rule: Rule; prefix: string } | null {
	const preset = effectivePreset(s);
	const vendor = /^openai\//i.exec(id);
	const bare = vendor ? id.slice(vendor[0].length) : id;
	// OpenAI ids: on OpenAI/Azure, on a custom proxy, or "openai/…" on OpenRouter.
	const openAiIds =
		(!vendor && (isOpenAiHost(s.baseURL) || preset.id === "custom")) ||
		(!!vendor && (isOpenRouterHost(s.baseURL) || preset.id === "custom"));
	if (openAiIds) {
		const rule = OPENAI_RULES.find((r) => r.kind === kind && r.re.test(bare));
		if (rule) return { rule, prefix: vendor?.[0] ?? "" };
	}
	const own = PRESET_RULES[preset.id]?.find(
		(r) => r.kind === kind && r.re.test(id),
	);
	return own ? { rule: own, prefix: "" } : null;
}

/**
 * Is `id` deprecated or shut down? Uses the provider's own `shutdownDate`
 * (from Load models) first, then the built-in table.
 */
export function findDeprecation(
	id: string,
	kind: ModelKind,
	s: { presetId: string; baseURL: string },
	listed?: AiModelInfo | null,
	now = Date.now(),
): ModelDeprecation | null {
	const model = id.trim();
	if (!model) return null;
	const today = todayIso(now);
	const known = ruleFor(model, kind, s);
	const date = listed?.shutdownDate ?? known?.rule.shutdown ?? null;
	if (!date) return null;
	const preset = effectivePreset(s);
	const fallback =
		kind === "chat" ? preset.defaultModel : preset.defaultImageModel;
	let replacement = known?.rule.replacement
		? `${known.prefix}${known.rule.replacement}`
		: fallback || null;
	if (replacement === model) replacement = null;
	return {
		status: date < today ? "shutdown" : "deprecated",
		date,
		replacement,
	};
}

/**
 * Ids OpenAI has already shut down (any provider that serves OpenAI ids).
 * Used by the settings migration. Anchored so ids that still work
 * (gpt-image-1.5 and gpt-image-1-mini until 2026-12-01) are left alone.
 */
export const OPENAI_SHUT_DOWN_RE =
	/^(openai\/)?(gpt-image-1(-\d{4}-\d{2}-\d{2})?$|gpt-4o-2024-05-13$|dall-e-|o1\b|o3-mini|o4-mini|gpt-4\.1-nano|gpt-4-turbo|gpt-3\.5-turbo)/i;
