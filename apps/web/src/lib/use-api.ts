import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "./api";

/**
 * Minimal data-fetching hook: keyed in-memory cache, request cancellation and
 * manual refetch. Enough for a handful of read-only GET endpoints without
 * pulling in a query library.
 */

interface CacheEntry {
	data: unknown;
	at: number;
}

const MAX_CACHE_ENTRIES = 60;
const cache = new Map<string, CacheEntry>();

function readCache<T>(key: string | null): T | undefined {
	if (key == null) return undefined;
	return cache.get(key)?.data as T | undefined;
}

function writeCache(key: string, data: unknown) {
	cache.delete(key);
	cache.set(key, { data, at: Date.now() });
	while (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

export interface ApiState<T> {
	/** Latest data for the current key (or the previous key with `keepPrevious`). */
	data: T | undefined;
	/** Set when the latest request for the current key failed. */
	error: Error | undefined;
	/** No data to show yet and a request is in flight. */
	isPending: boolean;
	/** A request is in flight (possibly while showing cached/previous data). */
	isFetching: boolean;
	refetch: () => void;
}

interface InternalState<T> {
	key: string | null;
	data: T | undefined;
	error: Error | undefined;
	fetching: boolean;
}

export interface UseApiOptions {
	/** Cached data younger than this is used without refetching. */
	staleMs?: number;
	/** Keep showing the previous key's data while the new key loads. */
	keepPrevious?: boolean;
}

/**
 * @param key cache key, `null` to skip fetching
 * @param fetcher called with an AbortSignal whenever `key` changes
 */
export function useApi<T>(
	key: string | null,
	fetcher: (signal: AbortSignal) => Promise<T>,
	{ staleMs = 30_000, keepPrevious = false }: UseApiOptions = {},
): ApiState<T> {
	const fetcherRef = useRef(fetcher);
	useEffect(() => {
		fetcherRef.current = fetcher;
	});

	const forceRef = useRef(false);
	const [nonce, setNonce] = useState(0);
	const [state, setState] = useState<InternalState<T>>(() => ({
		key,
		data: readCache<T>(key),
		error: undefined,
		fetching: key != null,
	}));

	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a refetch trigger
	useEffect(() => {
		if (key == null) {
			setState({ key, data: undefined, error: undefined, fetching: false });
			return;
		}
		const force = forceRef.current;
		forceRef.current = false;
		const cached = cache.get(key);
		if (cached && !force && Date.now() - cached.at < staleMs) {
			setState({
				key,
				data: cached.data as T,
				error: undefined,
				fetching: false,
			});
			return;
		}

		const controller = new AbortController();
		setState((prev) => ({
			key,
			data:
				(cached?.data as T | undefined) ??
				(prev.key === key || keepPrevious ? prev.data : undefined),
			error: undefined,
			fetching: true,
		}));

		fetcherRef.current(controller.signal).then(
			(data) => {
				writeCache(key, data);
				if (!controller.signal.aborted) {
					setState({ key, data, error: undefined, fetching: false });
				}
			},
			(error: unknown) => {
				if (controller.signal.aborted || isAbortError(error)) return;
				setState({
					key,
					data: readCache<T>(key),
					error: error instanceof Error ? error : new Error(String(error)),
					fetching: false,
				});
			},
		);

		return () => controller.abort();
	}, [key, nonce, staleMs, keepPrevious]);

	const refetch = useCallback(() => {
		forceRef.current = true;
		setNonce((n) => n + 1);
	}, []);

	// Until the effect for a new key runs, derive a consistent view from cache.
	const view: InternalState<T> =
		state.key === key
			? state
			: {
					key,
					data: readCache<T>(key) ?? (keepPrevious ? state.data : undefined),
					error: undefined,
					fetching: key != null,
				};

	return {
		data: view.data,
		error: view.error,
		isPending: view.data === undefined && view.fetching,
		isFetching: view.fetching,
		refetch,
	};
}
