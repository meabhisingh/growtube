/** Tiny external store shared by the content-script controller and React. */
import type { StudioTarget } from "./studio-dom";

/** docked: Studio's right column · floating: fixed card (edit page) · inline: above the form (upload dialog) */
export type Placement = "docked" | "floating" | "inline";

export type PanelHostState = {
	target: StudioTarget | null;
	/** Changes when the panel should reset (another video / dialog) */
	targetKey: string;
	placement: Placement;
	/** The other placement available here, if any (for the toggle button) */
	altPlacement: Placement | null;
	dark: boolean;
};

export type Store<T> = {
	get: () => T;
	set: (patch: Partial<T>) => void;
	subscribe: (listener: () => void) => () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
	let state = initial;
	const listeners = new Set<() => void>();
	return {
		get: () => state,
		set(patch) {
			let changed = false;
			for (const key of Object.keys(patch) as (keyof T)[]) {
				if (!Object.is(state[key], patch[key])) changed = true;
			}
			if (!changed) return;
			state = { ...state, ...patch };
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export const INITIAL_HOST_STATE: PanelHostState = {
	target: null,
	targetKey: "",
	placement: "floating",
	altPlacement: null,
	dark: false,
};
