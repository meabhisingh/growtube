/**
 * React hooks shared by extension pages and content-script UIs (they work
 * inside shadow roots: no DOM/global assumptions).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { WxtStorageItem } from "#imports";

import {
	type MessageType,
	type Req,
	type Res,
	sendToBackground,
} from "./messaging";

type SetValue<T> = (next: T | ((prev: T) => T)) => Promise<void>;

/**
 * Live-bound storage item: re-renders when the value changes anywhere
 * (other tabs, the options page, the background).
 *
 *   const [features, setFeatures, loading] = useStorageItem(features);
 *   setFeatures((f) => ({ ...f, feedBadges: false }));
 */
export function useStorageItem<T>(
	// biome-ignore lint/suspicious/noExplicitAny: metadata type is irrelevant here
	item: WxtStorageItem<T, any>,
): [value: T, setValue: SetValue<T>, loading: boolean] {
	const [value, setLocal] = useState<T>(item.fallback);
	const [loading, setLoading] = useState(true);
	const latest = useRef<T>(item.fallback);

	useEffect(() => {
		let alive = true;
		item
			.getValue()
			.then((v) => {
				if (!alive) return;
				latest.current = v;
				setLocal(v);
			})
			.catch((error: unknown) =>
				console.error("[GrowTube] storage read failed", item.key, error),
			)
			.finally(() => alive && setLoading(false));
		const unwatch = item.watch((v) => {
			const next = (v ?? item.fallback) as T;
			latest.current = next;
			setLocal(next);
		});
		return () => {
			alive = false;
			unwatch();
		};
	}, [item]);

	const setValue = useCallback<SetValue<T>>(
		async (next) => {
			const resolved =
				typeof next === "function"
					? (next as (prev: T) => T)(latest.current)
					: next;
			latest.current = resolved;
			setLocal(resolved);
			await item.setValue(resolved);
		},
		[item],
	);

	return [value, setValue, loading];
}

export type QueryState<T> = {
	data: T | undefined;
	error: Error | null;
	loading: boolean;
	/** Re-run (bypasses nothing; pass `force` in the payload if supported) */
	refetch: () => void;
};

/**
 * Calls a background handler and tracks loading/error. Re-runs when `key`
 * changes; pass `null` as payload to skip.
 *
 *   const { data, loading, error } = useBackground("yt.getVideoDetails", { videoId }, [videoId]);
 */
export function useBackground<T extends MessageType>(
	type: T,
	payload: Req<T> | null,
	deps: readonly unknown[],
): QueryState<Res<T>> {
	const [state, setState] = useState<{
		data: Res<T> | undefined;
		error: Error | null;
		loading: boolean;
	}>({
		data: undefined,
		error: null,
		loading: payload != null,
	});
	const [nonce, setNonce] = useState(0);
	const payloadRef = useRef(payload);
	payloadRef.current = payload;

	// biome-ignore lint/correctness/useExhaustiveDependencies: caller controls deps
	useEffect(() => {
		const p = payloadRef.current;
		if (p == null) {
			setState({ data: undefined, error: null, loading: false });
			return;
		}
		let alive = true;
		setState((s) => ({ ...s, loading: true, error: null }));
		sendToBackground(type, p)
			.then((data) => alive && setState({ data, error: null, loading: false }))
			.catch(
				(error: unknown) =>
					alive &&
					setState((s) => ({
						data: s.data,
						error: error instanceof Error ? error : new Error(String(error)),
						loading: false,
					})),
			);
		return () => {
			alive = false;
		};
	}, [type, nonce, ...deps]);

	const refetch = useCallback(() => setNonce((n) => n + 1), []);
	return { ...state, refetch };
}

const readYouTubeDark = () =>
	typeof document !== "undefined" &&
	document.documentElement.hasAttribute("dark");

/** `true` when YouTube is in dark theme (`<html dark>`); live-updates. */
export function useYouTubeDarkTheme(): boolean {
	const [dark, setDark] = useState(readYouTubeDark);
	useEffect(() => {
		const obs = new MutationObserver(() => setDark(readYouTubeDark()));
		obs.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["dark"],
		});
		return () => obs.disconnect();
	}, []);
	return dark;
}
