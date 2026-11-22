/**
 * Mounts the Shorts control bar on /shorts/* pages. One fixed-position UI in
 * <body> that follows whichever Short is active (see ShortsControls.tsx).
 */
import ReactDOM from "react-dom/client";

import {
	type ContentScriptContext,
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "#imports";

import { createStore } from "@/components/injected/common/store";
import { SHORTS_CONTROLS_TAG } from "@/components/injected/selectors";
import {
	ShortsControlsApp,
	type ShortsState,
} from "@/components/injected/shorts/ShortsControls";

import type { Feature } from "./feature";
import type { PageHub } from "./page";

export function createShortsControls(
	ctx: ContentScriptContext,
	hub: PageHub,
): Feature {
	const store = createStore<ShortsState>({ videoId: null, page: null });
	let uiPromise: Promise<ShadowRootContentScriptUi<ReactDOM.Root>> | null =
		null;
	let ui: ShadowRootContentScriptUi<ReactDOM.Root> | null = null;
	let mounted = false;
	let running = false;
	let offNav: (() => void) | null = null;

	const getUi = () => {
		uiPromise ??= createShadowRootUi(ctx, {
			name: SHORTS_CONTROLS_TAG,
			position: "inline",
			anchor: "body",
			append: "last",
			isolateEvents: true,
			onMount: (container) => {
				const el = document.createElement("div");
				container.append(el);
				const root = ReactDOM.createRoot(el);
				root.render(<ShortsControlsApp store={store} />);
				return root;
			},
			onRemove: (root) => root?.unmount(),
		}).then((created) => {
			ui = created;
			return created;
		});
		return uiPromise;
	};

	const unmount = () => {
		if (mounted) ui?.remove();
		mounted = false;
	};

	function sync() {
		if (!running || ctx.isInvalid) return;
		const page = hub.current;
		if (page.pageType !== "shorts" || !page.videoId) {
			unmount();
			if (store.get().videoId) store.set({ videoId: null, page: null });
			return;
		}
		const state = store.get();
		if (
			state.videoId !== page.videoId ||
			(page.playerResponse && !state.page?.playerResponse)
		) {
			store.set({ videoId: page.videoId, page });
		}
		if (mounted && ui) {
			// Re-insert a detached host instead of mounting again (mount() would
			// add a second React root without unmounting the first).
			if (!ui.shadowHost.isConnected) document.body.append(ui.shadowHost);
			return;
		}
		void getUi().then((created) => {
			if (!running || mounted || hub.current.pageType !== "shorts") return;
			created.mount();
			mounted = true;
		});
	}

	return {
		start() {
			if (running || ctx.isInvalid) return;
			running = true;
			offNav = hub.subscribe(() => sync());
			sync();
		},
		stop() {
			if (!running) return;
			running = false;
			offNav?.();
			offNav = null;
			unmount();
			store.set({ videoId: null, page: null });
		},
	};
}
