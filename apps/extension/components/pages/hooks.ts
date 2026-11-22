/**
 * React hooks shared by the extension pages (side panel, popup, options).
 * For storage-bound settings use `useStorageItem` from `@/lib/hooks`.
 */
import { extractChannelRef, extractVideoId } from "@open-vidiq/shared/youtube";
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import type { ChannelRef } from "@/lib/youtube/types";

// ---------------------------------------------------------------------------
// Async actions
// ---------------------------------------------------------------------------

export type AsyncState<T> = {
	data: T | undefined;
	error: unknown;
	loading: boolean;
};

/**
 * Wraps an async function with loading/error state. Only the latest call
 * updates state (older, slower calls are ignored), and nothing updates after
 * unmount.
 *
 *   const titles = useAsyncTask((topic: string) => ai.generate("titleIdeas", { topic }));
 *   <Button onClick={() => titles.run(topic)} disabled={titles.loading} />
 */
export function useAsyncTask<T, A extends unknown[]>(
	fn: (...args: A) => Promise<T>,
) {
	const [state, setState] = useState<AsyncState<T>>({
		data: undefined,
		error: null,
		loading: false,
	});
	const fnRef = useRef(fn);
	fnRef.current = fn;
	const seq = useRef(0);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);

	const run = useCallback(async (...args: A): Promise<T | undefined> => {
		const id = ++seq.current;
		setState((s) => ({ ...s, loading: true, error: null }));
		try {
			const data = await fnRef.current(...args);
			if (alive.current && id === seq.current)
				setState({ data, error: null, loading: false });
			return data;
		} catch (error) {
			if (alive.current && id === seq.current)
				setState((s) => ({ data: s.data, error, loading: false }));
			return undefined;
		}
	}, []);

	/** Cancels the pending call (its result is ignored) and clears state. */
	const reset = useCallback(() => {
		seq.current++;
		setState({ data: undefined, error: null, loading: false });
	}, []);

	const setData = useCallback(
		(data: T | undefined | ((prev: T | undefined) => T | undefined)) =>
			setState((s) => ({
				...s,
				data:
					typeof data === "function"
						? (data as (prev: T | undefined) => T | undefined)(s.data)
						: data,
			})),
		[],
	);

	return { ...state, run, reset, setData };
}

// ---------------------------------------------------------------------------
// Active tab (the YouTube tab next to the side panel / under the popup)
// ---------------------------------------------------------------------------

export type ActiveTab = {
	tabId: number | null;
	windowId: number | null;
	url: string | null;
	title: string | null;
	isYouTube: boolean;
	/** Watch / Shorts video id of the active tab */
	videoId: string | null;
	/** Channel id or @handle when the active tab is a channel page */
	channelRef: ChannelRef | null;
};

const EMPTY_TAB: ActiveTab = {
	tabId: null,
	windowId: null,
	url: null,
	title: null,
	isYouTube: false,
	videoId: null,
	channelRef: null,
};

export function isYouTubeUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	try {
		const host = new URL(url).hostname;
		return host === "youtube.com" || host.endsWith(".youtube.com");
	} catch {
		return false;
	}
}

export function describeTab(tab: {
	id?: number;
	windowId?: number;
	url?: string;
	title?: string;
}): ActiveTab {
	const url = tab.url ?? null;
	const yt = isYouTubeUrl(url);
	const host = (() => {
		try {
			return url ? new URL(url).hostname : "";
		} catch {
			return "";
		}
	})();
	const studio = host.startsWith("studio.");
	return {
		tabId: tab.id ?? null,
		windowId: tab.windowId ?? null,
		url,
		title: tab.title ?? null,
		isYouTube: yt,
		videoId: yt && url && !studio ? extractVideoId(url) : null,
		channelRef: yt && url && !studio ? extractChannelRef(url) : null,
	};
}

/**
 * The active tab of the window this page lives in, live-updated on tab
 * switches and SPA navigations (needs the "tabs" permission).
 */
export function useActiveTab(): ActiveTab {
	const [tab, setTab] = useState<ActiveTab>(EMPTY_TAB);

	useEffect(() => {
		let alive = true;
		let windowId: number | null = null;
		let activeTabId: number | null = null;

		const refresh = async () => {
			try {
				if (windowId == null) {
					const w = await browser.windows.getCurrent();
					windowId = w.id ?? null;
				}
				const [t] = await browser.tabs.query(
					windowId != null
						? { active: true, windowId }
						: { active: true, lastFocusedWindow: true },
				);
				if (!alive) return;
				activeTabId = t?.id ?? null;
				setTab(t ? describeTab(t) : EMPTY_TAB);
			} catch {
				if (alive) setTab(EMPTY_TAB);
			}
		};

		const onActivated = (info: { tabId: number; windowId: number }) => {
			if (windowId == null || info.windowId === windowId) void refresh();
		};
		const onUpdated = (
			tabId: number,
			change: { url?: string; title?: string; status?: string },
		) => {
			if (tabId !== activeTabId) return;
			if (change.url || change.title || change.status === "complete")
				void refresh();
		};
		const onRemoved = (tabId: number) => {
			if (tabId === activeTabId) void refresh();
		};

		void refresh();
		browser.tabs.onActivated.addListener(onActivated);
		browser.tabs.onUpdated.addListener(onUpdated);
		browser.tabs.onRemoved.addListener(onRemoved);
		return () => {
			alive = false;
			browser.tabs.onActivated.removeListener(onActivated);
			browser.tabs.onUpdated.removeListener(onUpdated);
			browser.tabs.onRemoved.removeListener(onRemoved);
		};
	}, []);

	return tab;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** `value`, updated only after it stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms = 300): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return debounced;
}

/**
 * A tiny per-page preference in localStorage (tab choice, last query…).
 * Falls back to in-memory state when storage is unavailable.
 */
export function useLocalPref<T>(
	key: string,
	initial: T,
): [T, (next: T) => void] {
	const storageKey = `ovq:pref:${key}`;
	const [value, setValue] = useState<T>(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			return raw == null ? initial : (JSON.parse(raw) as T);
		} catch {
			return initial;
		}
	});
	const set = useCallback(
		(next: T) => {
			setValue(next);
			try {
				localStorage.setItem(storageKey, JSON.stringify(next));
			} catch {
				// storage full / disabled: keep the in-memory value
			}
		},
		[storageKey],
	);
	return [value, set];
}

/** Calls `onVisible` once, the first time `ref` scrolls into view. */
export function useOnVisible<E extends Element>(
	onVisible: () => void,
	enabled = true,
) {
	const ref = useRef<E | null>(null);
	const cb = useRef(onVisible);
	cb.current = onVisible;
	useEffect(() => {
		const el = ref.current;
		if (!el || !enabled) return;
		const obs = new IntersectionObserver(
			(entries) => {
				if (entries.some((e) => e.isIntersecting)) {
					obs.disconnect();
					cb.current();
				}
			},
			{ rootMargin: "120px" },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, [enabled]);
	return ref;
}
