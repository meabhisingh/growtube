/**
 * Where the watch panel lives: top of the right column (#secondary-inner) in
 * the two-column layout, or under the title block in #below when the right
 * column is hidden (single-column / narrow windows).
 */
import {
	WATCH_BELOW,
	WATCH_FLEXY,
	WATCH_METADATA,
	WATCH_SECONDARY,
	WATCH_SECONDARY_INNER,
} from "../selectors";

export type Placement = {
	parent: Element;
	before: Node | null;
	mode: "secondary" | "below";
};

function visibleFlexy(): Element | null {
	for (const el of document.querySelectorAll(WATCH_FLEXY)) {
		if (!el.hasAttribute("hidden")) return el;
	}
	return null;
}

/** Null when the watch page isn't rendered yet. */
export function findPlacement(host?: Element | null): Placement | null {
	const flexy = visibleFlexy();
	if (!flexy) return null;
	const secondary = flexy.querySelector<HTMLElement>(WATCH_SECONDARY);
	const inner = flexy.querySelector(WATCH_SECONDARY_INNER);
	const singleColumn = flexy.hasAttribute("is-single-column");
	if (inner && secondary && !singleColumn && secondary.offsetWidth > 0) {
		const first = [...inner.childNodes].find((n) => n !== host) ?? null;
		return { parent: inner, before: first, mode: "secondary" };
	}
	const below = flexy.querySelector(WATCH_BELOW);
	if (!below) return null;
	const meta = below.querySelector(WATCH_METADATA);
	if (meta?.parentElement) {
		const next =
			meta.nextSibling === host
				? (host?.nextSibling ?? null)
				: meta.nextSibling;
		return { parent: meta.parentElement, before: next, mode: "below" };
	}
	const first = [...below.childNodes].find((n) => n !== host) ?? null;
	return { parent: below, before: first, mode: "below" };
}

/** True when `host` already sits where `placement` says. */
export function isPlaced(host: Element, placement: Placement): boolean {
	if (host.parentElement !== placement.parent) return false;
	if (placement.mode === "secondary") {
		return placement.parent.firstElementChild === host;
	}
	// "below": directly after the title block (or first in #below).
	const prev = host.previousElementSibling;
	return prev ? prev.matches(WATCH_METADATA) : true;
}

export function place(host: Element, placement: Placement): void {
	if (isPlaced(host, placement)) return;
	placement.parent.insertBefore(host, placement.before);
}
