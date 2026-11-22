/**
 * User settings, persisted with WXT storage items in chrome.storage.local.
 * Readable/writable from every context (background, extension pages, content
 * scripts). In React use `useStorageItem(item)` from `@/lib/hooks`.
 *
 *   const provider = await aiProvider.getValue();
 *   await features.setValue({ ...(await features.getValue()), feedBadges: false });
 *   const unwatch = myChannel.watch((v) => …);
 */
import { storage } from "#imports";

import { OPENAI_SHUT_DOWN_RE } from "./ai/deprecations";
import {
	AI_PROVIDER_PRESETS,
	detectPreset,
	getProviderPreset,
} from "./ai/providers";
import {
	type AiModelCaps,
	type AiProviderSettings,
	type CoachContext,
	isReasoningEffort,
	type UiChatMessage,
} from "./ai/types";
import { DEFAULT_SERVER_URL } from "./env";

export type { AiProviderSettings } from "./ai/types";

const openai = getProviderPreset("openai");

export const DEFAULT_AI_PROVIDER: AiProviderSettings = {
	presetId: openai.id,
	baseURL: openai.baseURL,
	apiKey: "",
	model: openai.defaultModel,
	imageModel: openai.defaultImageModel,
	temperature: 0.7,
	reasoningEffort: openai.defaultReasoningEffort ?? "",
};

/**
 * Fills missing/invalid fields with defaults (older versions, imports, a
 * half-written value). Every reader of `aiProvider` should go through this.
 */
export function withProviderDefaults(value: unknown): AiProviderSettings {
	const v = (value && typeof value === "object" ? value : {}) as Partial<
		Record<keyof AiProviderSettings, unknown>
	>;
	const str = (x: unknown, fallback: string) =>
		typeof x === "string" ? x : fallback;
	const temperature = Number(v.temperature);
	return {
		presetId: str(v.presetId, DEFAULT_AI_PROVIDER.presetId),
		baseURL: str(v.baseURL, DEFAULT_AI_PROVIDER.baseURL),
		apiKey: str(v.apiKey, ""),
		model: str(v.model, DEFAULT_AI_PROVIDER.model),
		imageModel: str(v.imageModel, DEFAULT_AI_PROVIDER.imageModel),
		temperature: Number.isFinite(temperature)
			? Math.min(2, Math.max(0, temperature))
			: DEFAULT_AI_PROVIDER.temperature,
		reasoningEffort: isReasoningEffort(v.reasoningEffort)
			? v.reasoningEffort
			: "",
	};
}

/**
 * Defaults GrowTube v1 shipped per preset. The v2 migration only replaces
 * a model that is still exactly one of these (the user never chose it).
 * Ollama's llama3.2 is left alone: it still works and the user pulled it.
 */
const V1_DEFAULTS: Readonly<
	Record<string, { model: string; imageModel: string }>
> = {
	openai: { model: "gpt-4o-mini", imageModel: "gpt-image-1" },
	openrouter: { model: "openai/gpt-4o-mini", imageModel: "" },
	groq: { model: "llama-3.3-70b-versatile", imageModel: "" },
	together: {
		model: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
		imageModel: "black-forest-labs/FLUX.1-schnell",
	},
	deepseek: { model: "deepseek-chat", imageModel: "" },
	gemini: { model: "gemini-2.0-flash", imageModel: "imagen-3.0-generate-002" },
};

/** Presets whose model ids are OpenAI's (directly, via a proxy, or "openai/…"). */
const SERVES_OPENAI_IDS = new Set(["openai", "openrouter", "custom"]);

/**
 * v1 -> v2: adds `reasoningEffort` and moves models that are an old shipped
 * default or already shut down by OpenAI to the preset's current default.
 * User-chosen ids are never touched.
 */
export function migrateAiProviderV2(old: unknown): AiProviderSettings {
	const s = withProviderDefaults(old);
	const byUrl = detectPreset(s.baseURL);
	const preset =
		s.presetId !== "custom" &&
		AI_PROVIDER_PRESETS.some((p) => p.id === s.presetId)
			? getProviderPreset(s.presetId)
			: byUrl;
	// Old defaults only count while the base URL is still the preset's own.
	const v1 = byUrl.id === preset.id ? V1_DEFAULTS[preset.id] : undefined;
	const pick = (
		current: string,
		oldDefault: string | undefined,
		next: string,
	) => {
		const id = current.trim();
		if (oldDefault !== undefined && id === oldDefault) return next;
		if (
			next &&
			SERVES_OPENAI_IDS.has(preset.id) &&
			OPENAI_SHUT_DOWN_RE.test(id)
		)
			return next;
		return current;
	};
	return {
		...s,
		model: pick(s.model, v1?.model, preset.defaultModel),
		imageModel: pick(s.imageModel, v1?.imageModel, preset.defaultImageModel),
	};
}

export const aiProvider = storage.defineItem<AiProviderSettings>(
	"local:aiProvider",
	{
		fallback: DEFAULT_AI_PROVIDER,
		version: 2,
		migrations: { 2: migrateAiProviderV2 },
	},
);

/**
 * Learned request capabilities per `${baseURL}|${model}` (see
 * lib/ai/params.ts). A cache, not a setting: not exported, cleared by reset.
 */
export const aiModelCaps = storage.defineItem<Record<string, AiModelCaps>>(
	"local:aiModelCaps",
	{
		fallback: {},
		version: 1,
	},
);

/** GrowTube server base URL (no trailing slash). */
export const serverUrl = storage.defineItem<string>("local:serverUrl", {
	fallback: DEFAULT_SERVER_URL,
	version: 1,
});

/**
 * "Share public stats": upload the public numbers of public videos and
 * channels to the GrowTube server (powers history & trending). Not linked to
 * the account; unlisted/private videos never sent. Off until the user turns
 * it on (sign-in form, popup or Settings): Chrome Web Store policy wants an
 * affirmative opt-in before such data leaves the browser.
 */
export const crowdsourceStats = storage.defineItem<boolean>(
	"local:crowdsourceStats",
	{
		fallback: false,
		version: 1,
	},
);

export type MyChannel = {
	channelId: string;
	handle: string | null;
	title: string;
};

export const myChannel = storage.defineItem<MyChannel | null>(
	"local:myChannel",
	{
		fallback: null,
		version: 1,
	},
);

export type Competitor = {
	channelId: string;
	handle: string | null;
	title: string;
	avatarUrl: string | null;
};

export const competitors = storage.defineItem<Competitor[]>(
	"local:competitors",
	{
		fallback: [],
		version: 1,
	},
);

export type FeatureFlags = {
	/** VPH / outlier badges on feed, search and channel thumbnails */
	feedBadges: boolean;
	/** Stats panel next to the player on watch pages */
	watchPanel: boolean;
	/** Speed / auto-scroll controls on Shorts */
	shortsControls: boolean;
	/** SEO optimizer inside YouTube Studio */
	studioOptimizer: boolean;
};

export const DEFAULT_FEATURES: FeatureFlags = {
	feedBadges: true,
	watchPanel: true,
	shortsControls: true,
	studioOptimizer: true,
};

export const features = storage.defineItem<FeatureFlags>("local:features", {
	fallback: DEFAULT_FEATURES,
	version: 1,
});

/** Default playback rate applied to Shorts (1 = normal). */
export const shortsDefaultSpeed = storage.defineItem<number>(
	"local:shortsDefaultSpeed",
	{
		fallback: 1,
		version: 1,
	},
);

export type AiConversation = {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: UiChatMessage[];
	/** Context the conversation was started with (video/channel in focus) */
	context?: CoachContext | null;
};

/** Side panel AI Coach history, newest first. */
export const aiConversations = storage.defineItem<AiConversation[]>(
	"local:aiConversations",
	{
		fallback: [],
		version: 1,
	},
);

/** Oldest conversations beyond this are dropped when a new one is saved. */
export const MAX_SAVED_CONVERSATIONS = 100;

/**
 * Puts `conversation` first (replacing the entry with the same id) and caps
 * the list. Every writer of `aiConversations` goes through this.
 */
export function withConversation(
	list: AiConversation[],
	conversation: AiConversation,
): AiConversation[] {
	return [conversation, ...list.filter((c) => c.id !== conversation.id)].slice(
		0,
		MAX_SAVED_CONVERSATIONS,
	);
}

export type SavedIdea = {
	id: string;
	title: string;
	description?: string;
	/** "daily-ideas" | "coach" | "title-ideas" | "manual" | … */
	source: string;
	createdAt: number;
	videoId?: string;
	channelId?: string;
	tags?: string[];
	done?: boolean;
};

export const savedIdeas = storage.defineItem<SavedIdea[]>("local:savedIdeas", {
	fallback: [],
	version: 1,
});

/** Set once the onboarding (options page) has been shown. */
export const onboardingDone = storage.defineItem<boolean>(
	"local:onboardingDone",
	{
		fallback: false,
		version: 1,
	},
);

/** Every settings item, e.g. for export/import or "reset to defaults". */
export const SETTINGS_ITEMS = {
	aiProvider,
	serverUrl,
	crowdsourceStats,
	myChannel,
	competitors,
	features,
	shortsDefaultSpeed,
	aiConversations,
	savedIdeas,
	onboardingDone,
} as const;

/** Small random id for conversations, ideas, messages. */
export function newId(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
