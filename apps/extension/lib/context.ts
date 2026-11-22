/**
 * "Current context": what the user was looking at when they opened the side
 * panel (video, channel, tool, prefilled prompt). Stored in
 * chrome.storage.session (cleared when the browser closes).
 *
 * - Content scripts set it via messaging: `ext.openSidePanel({ videoId, tool: "coach", prefill: "…" })`
 *   or `ext.setContext(...)` (storage.session isn't readable from content scripts).
 * - Extension pages (side panel) read it directly with `useStorageItem(currentContext)`.
 */
import { storage } from "#imports";

import type { CoachContext } from "./ai/types";

/** Side panel tools (the side panel agent may extend this list). */
export type SidePanelTool =
	| "coach"
	| "keywords"
	| "ideas"
	| "channel"
	| "competitors"
	| "trending"
	| "transcript"
	| "clips"
	| "thumbnails"
	| (string & {});

export type CurrentContext = {
	videoId?: string;
	channelId?: string;
	/** Tool to open */
	tool?: SidePanelTool;
	/** Text to prefill into the tool's input (e.g. a coach prompt or a keyword) */
	prefill?: string;
	/** Send `prefill` immediately (coach presets) */
	autoSubmit?: boolean;
	/** Extra structured context for the AI coach */
	coach?: CoachContext;
	/** Tab the context came from */
	tabId?: number;
	/** ms epoch; the side panel can ignore stale contexts */
	at?: number;
};

export const currentContext = storage.defineItem<CurrentContext | null>(
	"session:currentContext",
	{
		fallback: null,
	},
);
