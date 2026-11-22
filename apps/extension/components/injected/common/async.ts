/** Promise state as a React hook, plus error helpers for injected UIs. */
import { useCallback, useEffect, useRef, useState } from "react";

import { BackgroundError } from "@/lib/messaging";

export type AsyncState<T> = {
	data: T | undefined;
	error: Error | null;
	loading: boolean;
	/** Re-runs the loader (the loader decides whether to bypass caches) */
	reload: () => void;
};

/**
 * Runs `load` when `deps` change (and `enabled` is true). Results of stale
 * runs are ignored, so fast navigation never shows the previous video's data.
 */
export function useAsync<T>(
	load: () => Promise<T>,
	deps: readonly unknown[],
	enabled = true,
): AsyncState<T> {
	const [state, setState] = useState<{
		data: T | undefined;
		error: Error | null;
		loading: boolean;
	}>({ data: undefined, error: null, loading: enabled });
	const [nonce, setNonce] = useState(0);
	const loadRef = useRef(load);
	loadRef.current = load;

	// biome-ignore lint/correctness/useExhaustiveDependencies: caller controls deps
	useEffect(() => {
		if (!enabled) {
			setState({ data: undefined, error: null, loading: false });
			return;
		}
		let alive = true;
		setState((s) => ({ data: s.data, error: null, loading: true }));
		loadRef
			.current()
			.then((data) => {
				if (alive) setState({ data, error: null, loading: false });
			})
			.catch((error: unknown) => {
				if (!alive) return;
				setState({
					data: undefined,
					error: error instanceof Error ? error : new Error(String(error)),
					loading: false,
				});
			});
		return () => {
			alive = false;
		};
	}, [enabled, nonce, ...deps]);

	const reload = useCallback(() => setNonce((n) => n + 1), []);
	return { ...state, reload };
}

/** User-presentable message for anything thrown by lib calls. */
export function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message || error.name;
	return String(error);
}

export function errorCode(error: unknown): string | undefined {
	if (error instanceof BackgroundError) return error.code;
	const code = (error as { code?: unknown } | null)?.code;
	return typeof code === "string" ? code : undefined;
}

/** The extension was reloaded/updated: this content script is orphaned. */
export function isContextInvalidated(error: unknown): boolean {
	return (
		errorCode(error) === "CONTEXT_INVALIDATED" ||
		(error instanceof Error && /context invalidated/i.test(error.message))
	);
}

/** Server unreachable / not permitted: show a soft note, not an error. */
export function isServerUnavailable(error: unknown): boolean {
	const code = errorCode(error);
	return code === "NETWORK" || code === "PERMISSION" || code === "HTTP";
}
