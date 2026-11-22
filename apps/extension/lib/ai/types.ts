/** Shared AI types (safe to import from any context). */

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = { role: ChatRole; content: string };

/** A chat message as shown in the UI (has an id, may be streaming). */
export type UiChatMessage = ChatMessage & {
	id: string;
	createdAt: number;
	/** Set on an assistant message that failed */
	error?: string;
};

/** `reasoning_effort` values of the Chat Completions API (lowest first). */
export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** "" = not sent (the provider/model default). */
export type ReasoningEffortSetting = ReasoningEffort | "";

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
	return (
		typeof value === "string" &&
		(REASONING_EFFORTS as readonly string[]).includes(value)
	);
}

/** User-configured OpenAI-compatible provider. */
export type AiProviderSettings = {
	/** id from AI_PROVIDER_PRESETS ("openai", "ollama", "custom"…) */
	presetId: string;
	/** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 */
	baseURL: string;
	/** Empty for keyless local providers (Ollama, LM Studio) */
	apiKey: string;
	/** Chat model id */
	model: string;
	/** Image model id; empty = image generation disabled */
	imageModel: string;
	/** 0–2. Not sent to reasoning models that reject it (see lib/ai/params.ts). */
	temperature: number;
	/** Sent as `reasoning_effort` when set; "" = provider default (not sent). */
	reasoningEffort: ReasoningEffortSetting;
};

/** A model from the provider's `GET /models` list. */
export type AiModelInfo = {
	id: string;
	/** YYYY-MM-DD from `shutdown_date` (OpenAI) / `expiration_date` (OpenRouter); null = none announced */
	shutdownDate: string | null;
};

/** Token-cap parameter names of the Chat Completions API. */
export type TokenParam = "max_tokens" | "max_completion_tokens";

/**
 * What a (provider, model) pair is known to reject, learned from 400/422
 * errors and persisted in `aiModelCaps` (lib/settings.ts) so the next
 * request is right the first time.
 */
export type AiModelCaps = {
	/** Token-cap parameter that works; "none" = the provider rejects both */
	tokenParam?: TokenParam | "none";
	/** Effective reasoning efforts ("" = not sent) with which a custom temperature was rejected */
	noTemperatureWith?: string[];
	/** reasoning_effort values this model rejected */
	rejectedEfforts?: ReasoningEffort[];
	/** The reasoning_effort parameter itself is not accepted */
	noReasoningEffort?: boolean;
	/** response_format json_object is not accepted */
	noJsonMode?: boolean;
	/** Image sizes the image model rejected */
	rejectedSizes?: string[];
	/** The image `quality` parameter is not accepted */
	noQuality?: boolean;
	/** Last time something was learned (ms epoch) */
	at: number;
};

/** Image sizes offered by the UI ("auto" = provider default, not sent). */
export type ImageSize =
	| "1280x720"
	| "1536x1024"
	| "1024x1024"
	| "1024x1536"
	| "auto";

/** Image quality ("auto" = not sent). */
export type ImageQuality = "auto" | "low" | "medium" | "high";

/** File extension for an image data URL ("png" when unknown). */
export function imageExtension(src: string): string {
	const mime = /^data:image\/([\w.+-]+)[;,]/i.exec(src)?.[1]?.toLowerCase();
	if (mime === "jpeg" || mime === "jpg") return "jpg";
	if (mime === "svg+xml") return "svg";
	if (mime === "webp" || mime === "gif" || mime === "png") return mime;
	return "png";
}

/**
 * Structured context handed to the AI coach and prompt builders. Every
 * field is optional: pass whatever the current page knows.
 */
export type CoachContext = {
	/** Where the user is: shapes the coach's framing */
	page?:
		| "watch"
		| "shorts"
		| "channel"
		| "studio"
		| "search"
		| "sidepanel"
		| "other";
	video?: {
		videoId?: string;
		title?: string;
		description?: string;
		channelTitle?: string;
		views?: number | null;
		likes?: number | null;
		comments?: number | null;
		publishedAt?: string | null;
		durationSec?: number | null;
		isShort?: boolean;
		keywords?: string[];
		category?: string | null;
	};
	stats?: {
		/** Lifetime views/hour */
		vph?: number | null;
		/** Views/hour over the last ~48h of server snapshots */
		recentVph?: number | null;
		/** (likes+comments)/views % */
		engagementRate?: number | null;
		/** views / channel baseline */
		outlierScore?: number | null;
		/** Channel median views for this format */
		baseline?: number | null;
		ageHours?: number | null;
		/** Optional: tag -> search rank */
		tagRanks?: Record<string, number | null>;
		seoScore?: number | null;
	};
	channel?: {
		channelId?: string;
		title?: string;
		handle?: string | null;
		subscribers?: number | null;
		totalViews?: number | null;
		videoCount?: number | null;
		joinedAt?: string | null;
		country?: string | null;
		keywords?: string[];
		description?: string;
		baselineLong?: number | null;
		baselineShort?: number | null;
		uploadsPerWeek?: number | null;
	};
	/** Recent uploads of the channel in focus (for "why did this do well?") */
	recentVideos?: {
		title: string;
		views: number | null;
		publishedAt?: string | null;
		isShort?: boolean;
	}[];
	/** The user's own channel (settings.myChannel), if set */
	myChannel?: {
		title: string;
		handle?: string | null;
		subscribers?: number | null;
		niche?: string | null;
	};
	/** Transcript excerpt, ideally "m:ss text" lines */
	transcriptExcerpt?: string;
	/** Free-form extra instructions/context */
	extra?: string;
};

/** Messages on the "ai-chat" runtime Port. */
export type AiChatClientMessage = {
	type: "start";
	messages: ChatMessage[];
	model?: string;
	temperature?: number;
	context?: CoachContext;
};

export type AiChatServerMessage =
	| { type: "delta"; text: string }
	| { type: "done"; finishReason?: string | null }
	| { type: "error"; message: string; code?: AiErrorCode };

export type AiErrorCode =
	| "NOT_CONFIGURED"
	| "PERMISSION"
	| "AUTH"
	| "MODEL"
	/** The provider rejected a request parameter (after automatic adjustments) */
	| "PARAMS"
	| "RATE_LIMIT"
	/** No answer within the client timeout (the request is not resent) */
	| "TIMEOUT"
	| "NETWORK"
	| "OLLAMA_ORIGIN"
	| "NO_IMAGE_SUPPORT"
	| "BAD_OUTPUT"
	| "ABORTED"
	/** Signed out of open-vidiq (not an AI provider problem) */
	| "AUTH_REQUIRED"
	| "UNKNOWN";

export const AI_CHAT_PORT = "ai-chat";
