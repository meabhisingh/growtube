/**
 * Storage items owned by the extension pages (UI state worth keeping across
 * panel reloads). User settings live in `@/lib/settings`.
 */
import { storage } from "#imports";

import type { GeneratorOutput } from "@/lib/ai/prompts";

import { uiTheme } from "./theme";

export type DailyIdea = GeneratorOutput<"dailyIdeas">["ideas"][number];
export type ThumbnailConcept =
	GeneratorOutput<"thumbnailConcepts">["concepts"][number];

export type DailyIdeasState = {
	generatedAt: number;
	channelId: string | null;
	niche: string;
	ideas: DailyIdea[];
	/** idea title -> concept (null = failed) */
	concepts: Record<string, ThumbnailConcept | null>;
};

/** The last batch of Daily Ideas (so reopening the panel doesn't regenerate). */
export const dailyIdeasState = storage.defineItem<DailyIdeasState | null>(
	"local:ui.dailyIdeas",
	{ fallback: null, version: 1 },
);

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Serialized read-modify-write of the Daily Ideas state (several idea cards
 * store their thumbnail concepts concurrently).
 */
export function updateDailyIdeas(
	fn: (state: DailyIdeasState | null) => DailyIdeasState | null,
): Promise<void> {
	const next = writeChain.then(async () => {
		const current = await dailyIdeasState.getValue();
		await dailyIdeasState.setValue(fn(current));
	});
	writeChain = next.catch(() => {});
	return next;
}

/** Every page-owned item (for "Reset all data"). */
export const PAGE_ITEMS = { uiTheme, dailyIdeasState } as const;
