/**
 * Everything GrowTube injects into youtube.com:
 * - feed badges (VPH / outlier / subscribers) under video cards,
 * - the watch page panel (Views / Overview / AI Coach),
 * - Shorts controls (speed, seek, auto-scroll, mini stats).
 * Each feature follows its toggle in settings (`features`) live, and the
 * sign-in state (`authUser`): signed out, feed badges and Shorts controls
 * are stopped and the watch panel shows only a "Sign in" card.
 */
import "@/components/injected/styles/ui.css";

import { browser } from "wxt/browser";

import { defineContentScript } from "#imports";

import { createFeedBadges } from "@/components/injected/feed/controller";
import {
	createFeedPreview,
	removeFeedPreviewLeftovers,
} from "@/components/injected/preview/feed-preview";
import {
	FEED_BADGES_TAG,
	SHORTS_CONTROLS_TAG,
	WATCH_PANEL_TAG,
} from "@/components/injected/selectors";
import { authUser, type SignedInUser } from "@/lib/auth";
import type {
	FeedPreviewResult,
	FeedPreviewTabMessage,
} from "@/lib/feed-preview";
import { DEFAULT_FEATURES, type FeatureFlags, features } from "@/lib/settings";
import { detectPageType } from "@/lib/youtube/page-type";

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
		removeFeedPreviewLeftovers();

		const hub = createPageHub(ctx);
		const feed = createFeedBadges(ctx);
		// Live thumbnail preview from the side panel (forwarded by the background).
		const preview = createFeedPreview(ctx);
		const offNav = hub.subscribe((page) => {
			feed.refresh();
			preview.onNavigate(page.url);
		});
		const onTabMessage = (
			message: unknown,
			sender: { id?: string },
			sendResponse: (response: FeedPreviewResult) => void,
		) => {
			const m = message as FeedPreviewTabMessage | null;
			if (m?.__ovqTab !== 1 || sender.id !== browser.runtime.id) return false;
			if (m.type === "feedPreview.remove" || !signedIn) {
				sendResponse(preview.remove());
				return false;
			}
			if (m.type !== "feedPreview.show") return false;
			preview.show(m.card).then(sendResponse, () =>
				sendResponse({
					status: "no-grid",
					pageType: detectPageType(location.href),
				}),
			);
			return true; // async response
		};
		browser.runtime.onMessage.addListener(onTabMessage);
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
			console.debug("[GrowTube] couldn't read settings", error);
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
			if (!signedIn) preview.remove();
			apply();
		});

		ctx.onInvalidated(() => {
			unwatchFlags();
			unwatchAuth();
			offNav();
			browser.runtime.onMessage.removeListener(onTabMessage);
			preview.remove();
			for (const feature of Object.values(toggles)) feature.stop();
		});
	},
});
