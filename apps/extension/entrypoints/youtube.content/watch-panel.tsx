/**
 * Mounts the watch page panel (one shadow-root UI for the whole tab) and
 * keeps it in the right place as YouTube switches layouts.
 */
import ReactDOM from "react-dom/client";

import {
	type ContentScriptContext,
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "#imports";

import { createStore } from "@/components/injected/common/store";
import {
	WATCH_FLEXY,
	WATCH_LAYOUT_ATTRS,
	WATCH_PANEL_TAG,
} from "@/components/injected/selectors";
import { findPlacement, place } from "@/components/injected/watch/placement";
import {
	WatchPanelApp,
	type WatchPanelState,
} from "@/components/injected/watch/WatchPanel";

import type { Feature } from "./feature";
import type { PageHub } from "./page";

const RECHECK_MS = 1_500;

export function createWatchPanel(
	ctx: ContentScriptContext,
	hub: PageHub,
): Feature {
	const store = createStore<WatchPanelState>({ videoId: null, page: null });
	let uiPromise: Promise<ShadowRootContentScriptUi<ReactDOM.Root>> | null =
		null;
	let ui: ShadowRootContentScriptUi<ReactDOM.Root> | null = null;
	let mounted = false;
	let running = false;
	let offNav: (() => void) | null = null;
	let layoutObserver: MutationObserver | null = null;
	let observedFlexy: Element | null = null;
	let interval: number | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;

	const getUi = () => {
		uiPromise ??= createShadowRootUi(ctx, {
			name: WATCH_PANEL_TAG,
			position: "inline",
			// Keys typed in the coach input must not reach YouTube's shortcuts.
			isolateEvents: true,
			anchor: () => findPlacement()?.parent ?? null,
			append: (_anchor, host) => {
				const placement = findPlacement(host);
				if (placement) place(host, placement);
			},
			onMount: (container) => {
				const el = document.createElement("div");
				container.append(el);
				const root = ReactDOM.createRoot(el);
				root.render(<WatchPanelApp store={store} />);
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

	const observeLayout = () => {
		const flexy = document.querySelector(WATCH_FLEXY);
		if (flexy === observedFlexy) return;
		layoutObserver?.disconnect();
		observedFlexy = flexy;
		if (!flexy) return;
		layoutObserver ??= new MutationObserver(() => sync());
		layoutObserver.observe(flexy, {
			attributes: true,
			attributeFilter: WATCH_LAYOUT_ATTRS,
		});
	};

	function sync() {
		if (!running || ctx.isInvalid) return;
		const page = hub.current;
		if (page.pageType !== "watch" || !page.videoId) {
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
		observeLayout();
		if (mounted && ui) {
			// Also re-inserts a host that YouTube (or another extension) detached:
			// calling mount() again would render a second React root into the
			// same shadow root without unmounting the first.
			const placement = findPlacement(ui.shadowHost);
			if (placement) place(ui.shadowHost, placement);
			return;
		}
		if (!findPlacement()) return; // watch page not rendered yet: retried soon
		void getUi().then((created) => {
			if (
				!running ||
				mounted ||
				hub.current.pageType !== "watch" ||
				!findPlacement()
			)
				return;
			try {
				created.mount();
				mounted = true;
			} catch (error) {
				console.debug("[GrowTube] watch panel mount deferred", error);
			}
		});
	}

	const onResize = () => {
		if (resizeTimer) clearTimeout(resizeTimer);
		resizeTimer = setTimeout(sync, 200);
	};

	return {
		start() {
			if (running || ctx.isInvalid) return;
			running = true;
			offNav = hub.subscribe(() => sync());
			interval = ctx.setInterval(sync, RECHECK_MS);
			window.addEventListener("resize", onResize, { passive: true });
			sync();
		},
		stop() {
			if (!running) return;
			running = false;
			offNav?.();
			offNav = null;
			if (interval != null) clearInterval(interval);
			interval = null;
			if (resizeTimer) clearTimeout(resizeTimer);
			window.removeEventListener("resize", onResize);
			layoutObserver?.disconnect();
			layoutObserver = null;
			observedFlexy = null;
			unmount();
			store.set({ videoId: null, page: null });
		},
	};
}
