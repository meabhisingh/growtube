/** Studio optimizer preferences and per-video memory. */
import { useCallback, useRef, useSyncExternalStore } from "react";
import { storage } from "#imports";

/**
 * "auto": docked in Studio's right column when it is wide enough, else
 * floating (edit page) / inline above the form (upload dialog).
 */
export type PanelMode = "auto" | "docked" | "floating";

export type StudioPanelPrefs = {
	mode: PanelMode;
	collapsed: boolean;
	/** Open/closed state of each section */
	sections: Record<string, boolean>;
};

export const DEFAULT_PANEL_PREFS: StudioPanelPrefs = {
	mode: "auto",
	collapsed: false,
	sections: {},
};

export const studioPanelPrefs = storage.defineItem<StudioPanelPrefs>(
	"local:studioPanelPrefs",
	{ fallback: DEFAULT_PANEL_PREFS, version: 1 },
);

/** Target keyword per video id (most recent 300). */
export const studioKeywords = storage.defineItem<
	Record<string, { keyword: string; at: number }>
>("local:studioKeywords", { fallback: {}, version: 1 });

export async function saveKeyword(
	videoId: string,
	keyword: string,
): Promise<void> {
	const all = { ...(await studioKeywords.getValue()) };
	if (keyword.trim())
		all[videoId] = { keyword: keyword.trim(), at: Date.now() };
	else delete all[videoId];
	const entries = Object.entries(all)
		.sort((a, b) => b[1].at - a[1].at)
		.slice(0, 300);
	await studioKeywords.setValue(Object.fromEntries(entries));
}

// ---------------------------------------------------------------------------
// In-memory state that survives the panel being unmounted and remounted
// (e.g. switching upload steps), keyed per video. Jobs that finish while
// the panel is unmounted still land here and show up on remount.
// ---------------------------------------------------------------------------

const memory = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

function writeMemory(key: string, value: unknown): void {
	memory.set(key, value);
	for (const listener of listeners.get(key) ?? []) listener();
}

export function useRemembered<T>(
	key: string,
	initial: T,
): [T, (next: T | ((prev: T) => T)) => void] {
	const initialRef = useRef(initial);
	const subscribe = useCallback(
		(cb: () => void) => {
			let set = listeners.get(key);
			if (!set) {
				set = new Set();
				listeners.set(key, set);
			}
			set.add(cb);
			return () => {
				set.delete(cb);
			};
		},
		[key],
	);
	const getSnapshot = useCallback(
		() => (memory.has(key) ? (memory.get(key) as T) : initialRef.current),
		[key],
	);
	const value = useSyncExternalStore(subscribe, getSnapshot);
	const set = useCallback(
		(next: T | ((prev: T) => T)) => {
			const prev = getSnapshot();
			writeMemory(
				key,
				typeof next === "function" ? (next as (p: T) => T)(prev) : next,
			);
		},
		[key, getSnapshot],
	);
	return [value, set];
}
