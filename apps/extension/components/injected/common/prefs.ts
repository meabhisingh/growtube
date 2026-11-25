/**
 * UI preferences of the YouTube-injected UIs (watch panel, Shorts bar).
 * Persisted in chrome.storage.local so they survive reloads and are shared
 * by every youtube.com tab.
 */
import { storage } from "#imports";

export type WatchPanelTab = "views" | "overview" | "coach" | "comments";

export type InjectedPrefs = {
	/** Watch panel body hidden (header stays visible) */
	watchPanelCollapsed: boolean;
	/** Last opened watch panel tab */
	watchPanelTab: WatchPanelTab;
	/** Advance to the next Short when the current one ends */
	shortsAutoScroll: boolean;
	/** Shorts control bar collapsed to its launcher button */
	shortsCollapsed: boolean;
};

export const DEFAULT_INJECTED_PREFS: InjectedPrefs = {
	watchPanelCollapsed: false,
	watchPanelTab: "views",
	shortsAutoScroll: false,
	shortsCollapsed: false,
};

export const injectedPrefs = storage.defineItem<InjectedPrefs>(
	"local:ovqInjectedPrefs",
	{
		fallback: DEFAULT_INJECTED_PREFS,
		version: 1,
	},
);

/** Merges a stored value with the defaults (older versions may lack keys). */
export function withPrefDefaults(
	value: Partial<InjectedPrefs> | null | undefined,
): InjectedPrefs {
	return { ...DEFAULT_INJECTED_PREFS, ...(value ?? {}) };
}
