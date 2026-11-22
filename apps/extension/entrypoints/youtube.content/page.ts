/**
 * Single navigation feed for every injected feature: the bridge's
 * onNavigate (yt-navigate-finish / page-data-updated / initial load), with a
 * cheap URL poll as a safety net. Emits when the URL changes, or when a
 * repeated event for the same URL brings the player data the first lacked.
 */
import type { ContentScriptContext } from "#imports";

import {
	getCurrentPageData,
	onNavigate,
	syncConfigToBackground,
} from "@/lib/youtube/page";
import { detectPageType, videoIdFromUrl } from "@/lib/youtube/page-type";
import type { YtPageData } from "@/lib/youtube/types";

export type PageListener = (page: YtPageData) => void;

export type PageHub = {
	readonly current: YtPageData;
	subscribe: (listener: PageListener) => () => void;
};

function fromLocation(): YtPageData {
	const url = location.href;
	return {
		url,
		pageType: detectPageType(url),
		videoId: videoIdFromUrl(url),
		playerResponse: null,
		initialData: null,
		capturedAt: Date.now(),
	};
}

export function createPageHub(ctx: ContentScriptContext): PageHub {
	let current = fromLocation();
	const listeners = new Set<PageListener>();

	const emit = (page: YtPageData) => {
		current = page;
		// Keeps the background's region/client version in step with the page.
		void syncConfigToBackground();
		for (const listener of listeners) {
			try {
				listener(page);
			} catch (error) {
				console.error("[open-vidiq] page listener failed", error);
			}
		}
	};

	const handle = (incoming: YtPageData) => {
		if (ctx.isInvalid) return;
		// The bridge may report a URL we already moved past; trust location.
		const page =
			incoming.url === location.href
				? incoming
				: { ...fromLocation(), capturedAt: incoming.capturedAt };
		const sameUrl = page.url === current.url;
		const gainedData =
			sameUrl &&
			page.videoId === current.videoId &&
			!current.playerResponse &&
			!!page.playerResponse;
		if (!sameUrl || gainedData) emit(page);
	};

	const off = onNavigate(handle);
	void syncConfigToBackground();
	void getCurrentPageData()
		.then((page) => {
			if (page) handle(page);
		})
		.catch(() => {});
	ctx.setInterval(() => {
		if (location.href !== current.url) handle(fromLocation());
	}, 1_000);
	ctx.onInvalidated(() => {
		off();
		listeners.clear();
	});

	return {
		get current() {
			return current;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
