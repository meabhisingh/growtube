/**
 * Everything open-vidiq injects into youtube.com:
 * - feed badges (VPH / outlier / subscribers) under video cards,
 * - the watch page panel (Views / Overview / AI Coach),
 * - Shorts controls (speed, seek, auto-scroll, mini stats).
 * Each feature follows its toggle in settings (`features`) live, and the
 * sign-in state (`authUser`): signed out, feed badges and Shorts controls
 * are stopped and the watch panel shows only a "Sign in" card.
 */
import "@/components/injected/styles/ui.css";

import { defineContentScript } from "#imports";

import { createFeedBadges } from "@/components/injected/feed/controller";
import {
	FEED_BADGES_TAG,
	SHORTS_CONTROLS_TAG,
	WATCH_PANEL_TAG,
} from "@/components/injected/selectors";
import { authUser, type SignedInUser } from "@/lib/auth";
import { DEFAULT_FEATURES, type FeatureFlags, features } from "@/lib/settings";

import type { Feature } from "./feature";
import { createPageHub } from "./page";
import { createShortsControls } from "./shorts-controls";
import { createWatchPanel } from "./watch-panel";

export default defineContentScript({
	matches: ["*://www.youtube.com/*"],
	excludeMatches: [
		"*://www.youtube.com/embed/*",
		"*://www.youtube.com/live_chat*",
		"*://www.youtube.com/tv*",
	],
	runAt: "document_idle",
	cssInjectionMode: "ui",
	async main(ctx) {
		// Leftovers of an older instance (the extension was reloaded/updated).
		for (const el of document.querySelectorAll(
			`${FEED_BADGES_TAG}, ${WATCH_PANEL_TAG}, ${SHORTS_CONTROLS_TAG}`,
		)) {
			el.remove();
		}

		const hub = createPageHub(ctx);
		const feed = createFeedBadges(ctx);
		const offNav = hub.subscribe(() => feed.refresh());
		const toggles: Record<
			"feedBadges" | "watchPanel" | "shortsControls",
			Feature
		> = {
			feedBadges: feed,
			watchPanel: createWatchPanel(ctx, hub),
			shortsControls: createShortsControls(ctx, hub),
		};

		/** The watch panel renders its own "Sign in" card while signed out. */
		const WORKS_SIGNED_OUT: ReadonlySet<keyof typeof toggles> = new Set([
			"watchPanel",
		]);
		let flags: Partial<FeatureFlags> = DEFAULT_FEATURES;
		let signedIn = false;
		const apply = () => {
			const merged = { ...DEFAULT_FEATURES, ...flags };
			for (const [key, feature] of Object.entries(toggles) as [
				keyof typeof toggles,
				Feature,
			][]) {
				if (merged[key] && (signedIn || WORKS_SIGNED_OUT.has(key)))
					feature.start();
				else feature.stop();
			}
		};

		let user: SignedInUser | null = null;
		try {
			[flags, user] = await Promise.all([
				features.getValue(),
				authUser.getValue(),
			]);
		} catch (error) {
			console.debug("[open-vidiq] couldn't read settings", error);
		}
		if (ctx.isInvalid) return;
		signedIn = !!user;
		apply();
		const unwatchFlags = features.watch((next) => {
			flags = next ?? DEFAULT_FEATURES;
			apply();
		});
		// Sign-in / sign-out anywhere switches everything live (no reload).
		const unwatchAuth = authUser.watch((next) => {
			signedIn = !!next;
			apply();
		});

		ctx.onInvalidated(() => {
			unwatchFlags();
			unwatchAuth();
			offNav();
			for (const feature of Object.values(toggles)) feature.stop();
		});
	},
});
