/** Finding the active Short's player and video on /shorts/* pages. */
import {
	SHORTS_ACTIVE_RENDERER,
	SHORTS_NEXT_BUTTON,
	SHORTS_PLAYER,
	SHORTS_RENDERER,
	SHORTS_VIDEO,
} from "../selectors";

export type ActiveShort = {
	/** The element whose box is the visible player */
	player: HTMLElement;
	video: HTMLVideoElement | null;
};

function isShown(el: Element): boolean {
	const r = el.getBoundingClientRect();
	return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
}

/**
 * Old layout: many `ytd-reel-video-renderer`, the active one has [is-active].
 * New layout: one renderer + one `#shorts-player` moved into the active slot.
 */
export function findActiveShort(): ActiveShort | null {
	const active = document.querySelector<HTMLElement>(SHORTS_ACTIVE_RENDERER);
	if (active) {
		const player =
			active.querySelector<HTMLElement>(SHORTS_PLAYER) ??
			active.querySelector<HTMLElement>("#player-container") ??
			active;
		return {
			player,
			video: active.querySelector<HTMLVideoElement>(SHORTS_VIDEO),
		};
	}
	const player = document.querySelector<HTMLElement>(SHORTS_PLAYER);
	if (player && isShown(player)) {
		return {
			player,
			video: player.querySelector<HTMLVideoElement>(SHORTS_VIDEO),
		};
	}
	for (const r of document.querySelectorAll<HTMLElement>(SHORTS_RENDERER)) {
		if (!isShown(r)) continue;
		const video = r.querySelector<HTMLVideoElement>(SHORTS_VIDEO);
		const box = r.querySelector<HTMLElement>("#player-container") ?? r;
		return { player: box, video };
	}
	return null;
}

/** Scrolls to the next Short using YouTube's own button (or the ↓ key). */
export function goToNextShort(): void {
	const el = document.querySelector<HTMLElement>(SHORTS_NEXT_BUTTON);
	const button = el?.matches("button")
		? el
		: (el?.querySelector("button") ?? el);
	if (button && !(button as HTMLButtonElement).disabled) {
		button.click();
		return;
	}
	const init: KeyboardEventInit = {
		key: "ArrowDown",
		code: "ArrowDown",
		keyCode: 40,
		which: 40,
		bubbles: true,
		cancelable: true,
	} as KeyboardEventInit;
	document.dispatchEvent(new KeyboardEvent("keydown", init));
}

/** Typing in an input/textarea/contenteditable (also inside shadow roots). */
export function isTypingTarget(event: Event): boolean {
	const target = (event.composedPath()[0] ?? event.target) as Element | null;
	if (!target || !(target instanceof Element)) return false;
	if (
		target.closest(
			"input, textarea, select, [contenteditable=''], [contenteditable='true']",
		)
	)
		return true;
	return (target as HTMLElement).isContentEditable === true;
}

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function clampSpeed(rate: number): number {
	if (!Number.isFinite(rate)) return 1;
	return Math.min(3, Math.max(0.25, rate));
}

export function speedLabel(rate: number): string {
	return `${Number.parseFloat(rate.toFixed(2))}x`;
}
