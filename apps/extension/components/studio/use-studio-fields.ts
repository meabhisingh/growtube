/**
 * Live view of Studio's title / description / tags. Re-reads (debounced)
 * on any edit event in the page and polls every 1.5 s for programmatic
 * changes (chips added by clicking, Studio restoring a draft, …).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { FieldSnapshot, StudioFields } from "./studio-dom";

const EMPTY: FieldSnapshot = { title: null, description: null, tags: null };

function same(a: FieldSnapshot, b: FieldSnapshot): boolean {
	return (
		a.title === b.title &&
		a.description === b.description &&
		(a.tags === b.tags ||
			(!!a.tags &&
				!!b.tags &&
				a.tags.length === b.tags.length &&
				a.tags.every((t, i) => t === b.tags?.[i])))
	);
}

const EDIT_EVENTS = [
	"input",
	"change",
	"keyup",
	"paste",
	"cut",
	"drop",
	"click",
] as const;

export function useStudioFields(
	fields: StudioFields,
	opts: { debounceMs?: number; pollMs?: number; host?: Element | null } = {},
): { snapshot: FieldSnapshot; refresh: () => void } {
	const [snapshot, setSnapshot] = useState<FieldSnapshot>(() => {
		try {
			return fields.read();
		} catch {
			return EMPTY;
		}
	});
	const latest = useRef(snapshot);

	const refresh = useCallback(() => {
		let next: FieldSnapshot;
		try {
			next = fields.read();
		} catch (error) {
			console.warn("[GrowTube] reading Studio fields failed", error);
			next = EMPTY;
		}
		if (!same(latest.current, next)) {
			latest.current = next;
			setSnapshot(next);
		}
	}, [fields]);

	const debounceMs = opts.debounceMs ?? 250;
	const pollMs = opts.pollMs ?? 1500;
	const host = opts.host ?? null;

	useEffect(() => {
		refresh();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const onEdit = (e: Event) => {
			// Ignore our own panel's inputs.
			if (host && e.composedPath().includes(host)) return;
			if (timer) clearTimeout(timer);
			timer = setTimeout(refresh, debounceMs);
		};
		for (const type of EDIT_EVENTS)
			document.addEventListener(type, onEdit, { capture: true, passive: true });
		const poll = setInterval(() => {
			if (document.visibilityState === "visible") refresh();
		}, pollMs);
		return () => {
			if (timer) clearTimeout(timer);
			clearInterval(poll);
			for (const type of EDIT_EVENTS)
				document.removeEventListener(type, onEdit, { capture: true });
		};
	}, [refresh, debounceMs, pollMs, host]);

	return { snapshot, refresh };
}

/** Debounced copy of a value. */
export function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const t = setTimeout(() => setDebounced(value), ms);
		return () => clearTimeout(t);
	}, [value, ms]);
	return debounced;
}
