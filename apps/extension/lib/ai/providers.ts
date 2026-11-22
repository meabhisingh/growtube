/**
 * OpenAI-compatible provider presets. The user can pick one and only paste a
 * key; everything goes through the openai SDK with a custom baseURL.
 *
 * Defaults checked against each provider's docs in Nov 2026 (see the
 * "Providers" table in lib/README.md for sources).
 */
import type { ReasoningEffortSetting, TokenParam } from "./types";

export type AiProviderPreset = {
	id: string;
	label: string;
	baseURL: string;
	/** Older base URLs of the same provider (detectPreset only) */
	legacyBaseURLs?: readonly string[];
	/** Suggested default chat model */
	defaultModel: string;
	/** Suggested image model ("" = provider has no OpenAI-style image API) */
	defaultImageModel: string;
	/**
	 * Reasoning effort preselected when the user picks this preset
	 * ("" = provider default, not sent).
	 */
	defaultReasoningEffort?: ReasoningEffortSetting;
	/**
	 * Token-cap parameter the provider documents. Learned per model at
	 * runtime when it's rejected (lib/ai/params.ts).
	 */
	tokenParam: TokenParam;
	requiresKey: boolean;
	/** Where to get a key */
	keyUrl?: string;
	/** Short setup hint for the options page */
	note?: string;
	local?: boolean;
};

export const AI_PROVIDER_PRESETS: readonly AiProviderPreset[] = [
	{
		id: "openai",
		label: "OpenAI",
		baseURL: "https://api.openai.com/v1",
		defaultModel: "gpt-6-luna",
		defaultImageModel: "gpt-image-2.6-sunburst",
		tokenParam: "max_completion_tokens",
		requiresKey: true,
		keyUrl: "https://platform.openai.com/api-keys",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		baseURL: "https://openrouter.ai/api/v1",
		defaultModel: "openai/gpt-6-luna",
		defaultImageModel: "openai/gpt-image-2.6-sunburst",
		tokenParam: "max_tokens",
		requiresKey: true,
		keyUrl: "https://openrouter.ai/keys",
		note: 'One key for hundreds of models, including free ones (":free" suffix).',
	},
	{
		id: "groq",
		label: "Groq",
		baseURL: "https://api.groq.com/openai/v1",
		defaultModel: "openai/gpt-oss-120b",
		defaultImageModel: "",
		// gpt-oss always reasons; "low" keeps short calls fast.
		defaultReasoningEffort: "low",
		tokenParam: "max_completion_tokens",
		requiresKey: true,
		keyUrl: "https://console.groq.com/keys",
	},
	{
		id: "together",
		label: "Together AI",
		baseURL: "https://api.together.ai/v1",
		legacyBaseURLs: ["https://api.together.xyz/v1"],
		defaultModel: "zai-org/GLM-5.3-Flash",
		defaultImageModel: "black-forest-labs/FLUX.2-dev",
		defaultReasoningEffort: "low",
		tokenParam: "max_tokens",
		requiresKey: true,
		keyUrl: "https://api.together.ai/settings/api-keys",
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		baseURL: "https://api.deepseek.com",
		defaultModel: "deepseek-flash",
		defaultImageModel: "",
		// Thinking is on (effort "high") by default: "none" keeps short calls fast.
		defaultReasoningEffort: "none",
		tokenParam: "max_tokens",
		requiresKey: true,
		keyUrl: "https://platform.deepseek.com/api_keys",
	},
	{
		id: "mistral",
		label: "Mistral",
		baseURL: "https://api.mistral.ai/v1",
		defaultModel: "mistral-small-latest",
		defaultImageModel: "",
		defaultReasoningEffort: "none",
		tokenParam: "max_tokens",
		requiresKey: true,
		keyUrl: "https://console.mistral.ai/api-keys",
	},
	{
		id: "gemini",
		label: "Google Gemini",
		baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
		defaultModel: "gemini-3.8-flash",
		defaultImageModel: "gemini-nano-banana-2.1",
		tokenParam: "max_tokens",
		requiresKey: true,
		keyUrl: "https://aistudio.google.com/apikey",
		note: "Uses Gemini's OpenAI-compatible endpoint.",
	},
	{
		id: "ollama",
		label: "Ollama (local)",
		baseURL: "http://localhost:11434/v1",
		defaultModel: "gemma4",
		defaultImageModel: "",
		// Thinking models think by default; "none" is safe for every model.
		defaultReasoningEffort: "none",
		tokenParam: "max_tokens",
		requiresKey: false,
		local: true,
		note: "Run `ollama pull gemma4` (or any model), and start Ollama with OLLAMA_ORIGINS=chrome-extension://* so the extension may call it.",
	},
	{
		id: "lmstudio",
		label: "LM Studio (local)",
		baseURL: "http://localhost:1234/v1",
		defaultModel: "",
		defaultImageModel: "",
		tokenParam: "max_tokens",
		requiresKey: false,
		local: true,
		note: "Enable the local server in LM Studio (Developer tab), then load models and pick one from the list.",
	},
	{
		id: "custom",
		label: "Custom (OpenAI-compatible)",
		baseURL: "",
		defaultModel: "",
		defaultImageModel: "",
		tokenParam: "max_tokens",
		requiresKey: false,
	},
];

export function getProviderPreset(id: string): AiProviderPreset {
	return (
		AI_PROVIDER_PRESETS.find((p) => p.id === id) ??
		(AI_PROVIDER_PRESETS.at(-1) as AiProviderPreset)
	);
}

/** Best guess of a preset from a base URL (for imported/legacy settings). */
export function detectPreset(baseURL: string): AiProviderPreset {
	const normalized = baseURL.trim().replace(/\/+$/, "").toLowerCase();
	return (
		AI_PROVIDER_PRESETS.find((p) =>
			[p.baseURL, ...(p.legacyBaseURLs ?? [])].some(
				(u) => u && normalized.startsWith(u.toLowerCase()),
			),
		) ?? getProviderPreset("custom")
	);
}

/**
 * The preset that describes what actually answers at `s.baseURL`: the URL
 * wins over the stored presetId (a "custom" entry pointing at Groq is Groq).
 */
export function effectivePreset(s: {
	presetId: string;
	baseURL: string;
}): AiProviderPreset {
	const byUrl = detectPreset(s.baseURL);
	return byUrl.id !== "custom" ? byUrl : getProviderPreset(s.presetId);
}

function hostOf(baseURL: string): string {
	try {
		return new URL(baseURL).hostname.toLowerCase();
	} catch {
		return "";
	}
}

/** api.openai.com or an Azure OpenAI resource. */
export function isOpenAiHost(baseURL: string): boolean {
	const host = hostOf(baseURL);
	return (
		host === "api.openai.com" ||
		host.endsWith(".openai.azure.com") ||
		host.endsWith(".cognitiveservices.azure.com")
	);
}

export function isOpenRouterHost(baseURL: string): boolean {
	return hostOf(baseURL) === "openrouter.ai";
}

export function isGeminiHost(baseURL: string): boolean {
	return hostOf(baseURL) === "generativelanguage.googleapis.com";
}

export function isTogetherHost(baseURL: string): boolean {
	const host = hostOf(baseURL);
	return host === "api.together.ai" || host === "api.together.xyz";
}
