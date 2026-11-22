/** OpenAI-SDK client for the user's provider. BACKGROUND ONLY. */
import OpenAI from "openai";

import { hasOriginPermission, originOf } from "../permissions";
import { aiProvider, withProviderDefaults } from "../settings";
import { AiError, REQUEST_TIMEOUT_MS } from "./errors";
import { getProviderPreset } from "./providers";
import type { AiProviderSettings } from "./types";

/** Stored provider settings, with defaults for any missing field. */
export async function getProviderSettings(): Promise<AiProviderSettings> {
	return withProviderDefaults(await aiProvider.getValue());
}

/** Throws an actionable AiError when the provider can't be used yet. */
export async function assertProviderReady(
	s: AiProviderSettings,
	opts: { needModel?: boolean } = {},
): Promise<void> {
	const preset = getProviderPreset(s.presetId);
	if (!s.baseURL.trim()) {
		throw new AiError(
			"NOT_CONFIGURED",
			"Set up an AI provider in open-vidiq Settings → AI first.",
		);
	}
	if (!/^https?:\/\//.test(s.baseURL)) {
		throw new AiError(
			"NOT_CONFIGURED",
			`"${s.baseURL}" isn't a valid base URL (it must start with https:// or http://).`,
		);
	}
	if (preset.requiresKey && !s.apiKey.trim()) {
		throw new AiError(
			"NOT_CONFIGURED",
			`Add your ${preset.label} API key in open-vidiq Settings → AI.`,
		);
	}
	if (opts.needModel !== false && !s.model.trim()) {
		throw new AiError(
			"NOT_CONFIGURED",
			"Choose a chat model in open-vidiq Settings → AI.",
		);
	}
	if (!(await hasOriginPermission(s.baseURL))) {
		throw new AiError(
			"PERMISSION",
			`open-vidiq needs permission to call ${originOf(s.baseURL) ?? s.baseURL}. Open Settings → AI and click "Save" (or "Grant access") to allow it.`,
		);
	}
}

/**
 * One client per settings snapshot (cheap to create). The 10-minute timeout
 * leaves room for high reasoning effort / high image quality (the worker is
 * kept alive meanwhile). `maxRetries: 1` applies to cheap calls (model list);
 * generation calls pass `GENERATION_REQUEST` so a slow or timed-out request is
 * never sent twice.
 */
export function createAiClient(s: AiProviderSettings): OpenAI {
	return new OpenAI({
		apiKey: s.apiKey.trim() || "not-needed",
		baseURL: s.baseURL.replace(/\/+$/, ""),
		dangerouslyAllowBrowser: true,
		maxRetries: 1,
		timeout: REQUEST_TIMEOUT_MS,
	});
}

/** Request options for billed generation calls: no SDK retries (see retryDelayMs). */
export const GENERATION_REQUEST = { maxRetries: 0 } as const;
