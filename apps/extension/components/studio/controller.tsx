/**
 * Content-script controller for the Studio optimizer.
 *
 * Watches Studio (an SPA) for the video details editor (/video/<id>/edit)
 * or the upload dialog's Details step, and keeps ONE shadow-root panel
 * mounted next to it. The panel's host element is moved between placements
 * (docked / floating / inline) instead of being re-created, so React state
 * survives layout changes. Renders nothing while signed out of GrowTube
 * (follows `authUser` live).
 */
import ReactDOM from "react-dom/client";
import {
	type ContentScriptContext,
	createShadowRootUi,
	type ShadowRootContentScriptUi,
} from "#imports";

import { authUser } from "@/lib/auth";
import { features } from "@/lib/settings";

import { type PanelMode, studioPanelPrefs } from "./prefs";
import { StudioApp } from "./StudioApp";
import { queryFirst, SELECTORS } from "./selectors";
import { createStore, INITIAL_HOST_STATE, type Placement } from "./store";
import {
	type DockSpot,
	detectTarget,
	dockWidth,
	findDockSpot,
	findInlineSpot,
	isStudioDark,
	type StudioTarget,
} from "./studio-dom";

export const HOST_NAME = "ovq-studio-optimizer";
/** Narrower dock columns get the floating card instead (auto mode). */
const MIN_DOCK_WIDTH = 260;
const MIN_VIEWPORT_FOR_DOCK = 1000;
/** Edit page: wait this long for Studio to render before placing the panel. */
const EDIT_WAIT_MS = 6_000;
const THROTTLE_MS = 400;
const POLL_MS = 1_500;

type Choice = {
	placement: Placement;
	spot: DockSpot | null;
	alt: Placement | null;
};

export function choosePlacement(
	target: StudioTarget,
	mode: PanelMode,
): Choice | null {
	const dock = findDockSpot(target);
	const dockFits = !!dock && dockWidth(dock) >= MIN_DOCK_WIDTH;

	if (target.kind === "upload") {
		// The dialog traps focus, so the panel must live inside it (no floating).
		const inline = findInlineSpot(target);
		const spots: Record<"docked" | "inline", DockSpot | null> = {
			docked: dock,
			inline,
		};
		let want: "docked" | "inline" =
			mode === "floating"
				? "inline"
				: mode === "docked"
					? "docked"
					: dockFits
						? "docked"
						: "inline";
		if (!spots[want]) want = want === "docked" ? "inline" : "docked";
		const spot = spots[want];
		if (!spot) return null;
		const other = want === "docked" ? "inline" : "docked";
		return { placement: want, spot, alt: spots[other] ? other : null };
	}

	const want: Placement =
		mode === "floating"
			? "floating"
			: mode === "docked"
				? dock
					? "docked"
					: "floating"
				: dockFits && window.innerWidth >= MIN_VIEWPORT_FOR_DOCK
					? "docked"
					: "floating";
	return {
		placement: want,
		spot: want === "docked" ? dock : null,
		alt: want === "docked" ? "floating" : dock ? "docked" : null,
	};
}

function place(host: HTMLElement, choice: Choice): void {
	if (choice.placement === "floating" || !choice.spot) {
		if (host.parentElement !== document.body) document.body.append(host);
		return;
	}
	const { el, how } = choice.spot;
	if (how === "after" && el.nextElementSibling !== host) el.after(host);
	else if (how === "before" && el.previousElementSibling !== host)
		el.before(host);
	else if (how === "append" && host.parentElement !== el) el.append(host);
}

function sameTarget(
	a: StudioTarget | null,
	b: StudioTarget,
): a is StudioTarget {
	return (
		!!a && a.kind === b.kind && a.videoId === b.videoId && a.dialog === b.dialog
	);
}

export function startStudioOptimizer(ctx: ContentScriptContext): void {
	const store = createStore(INITIAL_HOST_STATE);
	let enabled = false;
	let featureOn = false;
	let signedIn = false;
	const updateEnabled = () => {
		enabled = featureOn && signedIn;
	};
	let mode: PanelMode = "auto";
	let ui: ShadowRootContentScriptUi<ReactDOM.Root> | null = null;
	let creating = false;
	let current: StudioTarget | null = null;
	const firstSeen = new Map<string, number>();
	const dialogIds = new WeakMap<Element, number>();
	let dialogSeq = 0;
	let scheduled: number | null = null;

	const schedule = (delay = THROTTLE_MS) => {
		if (scheduled != null || ctx.isInvalid) return;
		scheduled = ctx.setTimeout(() => {
			scheduled = null;
			evaluate();
		}, delay);
	};

	const hide = () => {
		current = null;
		store.set({ target: null, targetKey: "" });
		if (ui?.shadowHost.isConnected) ui.shadowHost.remove();
	};

	const teardown = () => {
		current = null;
		store.set({ target: null, targetKey: "" });
		ui?.remove();
		ui = null;
	};

	const keyFor = (target: StudioTarget): string => {
		if (target.kind === "edit") return `edit:${target.videoId}`;
		const dialog = target.dialog as Element;
		let id = dialogIds.get(dialog);
		if (id == null) {
			id = ++dialogSeq;
			dialogIds.set(dialog, id);
		}
		return `upload:${id}`;
	};

	async function ensureUi(): Promise<void> {
		if (ui || creating || ctx.isInvalid) return;
		creating = true;
		try {
			const created = await createShadowRootUi(ctx, {
				name: HOST_NAME,
				position: "inline",
				anchor: "body",
				append: "last",
				// Keep our keystrokes away from Studio's shortcuts.
				isolateEvents: true,
				onMount: (container, _shadow, host) => {
					const el = document.createElement("div");
					el.className = "ovq-mount";
					container.append(el);
					const root = ReactDOM.createRoot(el);
					root.render(<StudioApp store={store} host={host} />);
					return root;
				},
				onRemove: (root) => root?.unmount(),
			});
			if (!enabled || ctx.isInvalid) return;
			created.mount();
			created.shadowHost.remove(); // placed by evaluate()
			ui = created;
			guardEscape(created.shadowHost);
		} catch (error) {
			console.warn("[GrowTube] couldn't create the Studio panel", error);
		} finally {
			creating = false;
		}
		evaluate();
	}

	/**
	 * Escape inside our panel must not close Studio's upload dialog (its
	 * overlay listens on document in the capture phase; window capture runs first).
	 */
	function guardEscape(host: HTMLElement): void {
		ctx.addEventListener(
			window,
			"keydown",
			(e: KeyboardEvent) => {
				if (e.key !== "Escape" || !e.composedPath().includes(host)) return;
				e.stopPropagation();
				const active = host.shadowRoot?.activeElement;
				if (active instanceof HTMLElement) active.blur();
			},
			{ capture: true },
		);
	}

	function evaluate(): void {
		if (ctx.isInvalid) return;
		try {
			run();
		} catch (error) {
			console.warn("[GrowTube] Studio optimizer", error);
		}
	}

	function run(): void {
		if (!enabled) {
			if (ui || current) teardown();
			return;
		}
		const detected = detectTarget();
		if (!detected) {
			hide();
			return;
		}
		const target = sameTarget(current, detected) ? current : detected;
		const key = keyFor(target);

		if (target.kind === "edit") {
			const first = firstSeen.get(key) ?? Date.now();
			firstSeen.set(key, first);
			const ready =
				!!queryFirst(document, SELECTORS.title) || !!findDockSpot(target);
			if (!ready && Date.now() - first < EDIT_WAIT_MS) {
				hide();
				schedule(500);
				return;
			}
		}

		const choice = choosePlacement(target, mode);
		if (!choice) {
			hide();
			return;
		}
		if (!ui) {
			void ensureUi();
			return;
		}
		place(ui.shadowHost, choice);
		current = target;
		store.set({
			target,
			targetKey: key,
			placement: choice.placement,
			altPlacement: choice.alt,
			dark: isStudioDark(),
		});
	}

	// ---- triggers ------------------------------------------------------------
	const observer = new MutationObserver((records) => {
		// Ignore mutations caused by moving our own host.
		if (
			ui &&
			records.every((r) =>
				[...r.addedNodes, ...r.removedNodes].every((n) => n === ui?.shadowHost),
			) &&
			records.every((r) => r.type === "childList")
		)
			return;
		schedule();
	});
	observer.observe(document.documentElement, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["hidden", "opened", "dark", "aria-hidden"],
	});
	ctx.onInvalidated(() => observer.disconnect());
	ctx.addEventListener(window, "wxt:locationchange", () => evaluate());
	ctx.addEventListener(window, "resize", () => schedule(250));
	ctx.setInterval(() => {
		if (document.visibilityState === "visible") evaluate();
	}, POLL_MS);

	// ---- settings ------------------------------------------------------------
	void Promise.all([
		features.getValue(),
		studioPanelPrefs.getValue(),
		authUser.getValue(),
	])
		.then(([flags, prefs, user]) => {
			featureOn = flags.studioOptimizer !== false;
			signedIn = !!user;
			updateEnabled();
			mode = prefs.mode ?? "auto";
			evaluate();
		})
		.catch((error: unknown) => {
			// Without the sign-in state the panel stays off.
			console.warn("[GrowTube] couldn't read settings", error);
		});
	ctx.onInvalidated(
		features.watch((flags) => {
			featureOn = flags?.studioOptimizer !== false;
			updateEnabled();
			evaluate();
		}),
	);
	ctx.onInvalidated(
		authUser.watch((user) => {
			signedIn = !!user;
			updateEnabled();
			evaluate();
		}),
	);
	ctx.onInvalidated(
		studioPanelPrefs.watch((prefs) => {
			const next = prefs?.mode ?? "auto";
			if (next !== mode) {
				mode = next;
				evaluate();
			}
		}),
	);
}
