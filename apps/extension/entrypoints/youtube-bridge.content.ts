/**
 * MAIN-world bridge: runs in YouTube's own JS context (no extension APIs) and
 * exposes the page's ytcfg + already-loaded player/page data to our
 * isolated-world content scripts over a private MessagePort.
 *
 * Keep this file dependency-light: it is injected into every youtube.com page.
 * It only reads data; it never modifies YouTube's state.
 *
 * Security: this world is YouTube's, so anything here is reachable by page
 * scripts. It has no extension APIs (no chrome.runtime / chrome.storage, and
 * the manifest has no externally_connectable), must never import extension
 * modules that use them, and the isolated side only accepts the read-only
 * events in bridge-protocol.ts. So the page can't send `auth.*` (or any
 * other) messages to the background, nor read the sign-in state or token.
 */
import { defineContentScript } from "#imports";

import {
	BRIDGE_CONNECT,
	BRIDGE_READY,
	type BridgeEvent,
	type BridgeRequest,
	type PageEventReason,
} from "@/lib/youtube/bridge-protocol";
import { detectPageType, videoIdFromUrl } from "@/lib/youtube/page-type";
import type { YtConfig, YtPageData } from "@/lib/youtube/types";

type AnyObj = Record<string, unknown>;

type YtcfgGlobal = { get?: (key: string) => unknown; data_?: AnyObj };
type PlayerElement = HTMLElement & { getPlayerResponse?: () => unknown };
type PolymerElement = HTMLElement & {
	data?: AnyObj;
	getCurrentData?: () => AnyObj;
};

declare global {
	interface Window {
		ytcfg?: YtcfgGlobal;
		ytInitialPlayerResponse?: unknown;
		ytInitialData?: unknown;
		__ovqBridgeInstalled?: boolean;
	}
}

export default defineContentScript({
	matches: ["*://*.youtube.com/*"],
	world: "MAIN",
	runAt: "document_start",
	main() {
		if (window.__ovqBridgeInstalled) return;
		window.__ovqBridgeInstalled = true;
		installBridge();
	},
});

function cfg(key: string): unknown {
	const yc = window.ytcfg;
	try {
		return yc?.get?.(key) ?? yc?.data_?.[key];
	} catch {
		return yc?.data_?.[key];
	}
}

/**
 * Only the public client identity: no sign-in state, session or channel ids,
 * visitor id or raw INNERTUBE_CONTEXT ever leave this world (the extension
 * has no feature that needs them).
 */
function readConfig(): YtConfig | null {
	const clientVersion = cfg("INNERTUBE_CLIENT_VERSION");
	if (typeof clientVersion !== "string") return null;
	const context = cfg("INNERTUBE_CONTEXT") as AnyObj | undefined;
	const client = (context?.client as AnyObj | undefined) ?? {};
	return {
		apiKey: (cfg("INNERTUBE_API_KEY") as string | undefined) ?? null,
		clientName: String(
			cfg("INNERTUBE_CLIENT_NAME") ?? client.clientName ?? "WEB",
		),
		clientVersion,
		hl: String(cfg("HL") ?? client.hl ?? "en"),
		gl: String(cfg("GL") ?? client.gl ?? "US"),
		// The background learns its own anonymous one from InnerTube answers.
		visitorData: null,
		source: "page",
	};
}

function videoIdOf(playerResponse: unknown): string | null {
	const id = (playerResponse as { videoDetails?: { videoId?: unknown } } | null)
		?.videoDetails?.videoId;
	return typeof id === "string" ? id : null;
}

/** Last navigation payload from yt-navigate-finish (SPA navigations). */
let lastNav: {
	url: string;
	response: unknown;
	playerResponse: unknown;
} | null = null;

function readPlayerResponse(videoId: string | null): unknown {
	if (!videoId) return null;
	const candidates: unknown[] = [];
	for (const id of ["movie_player", "shorts-player"]) {
		const el = document.getElementById(id) as PlayerElement | null;
		try {
			candidates.push(el?.getPlayerResponse?.());
		} catch {
			// player not ready
		}
	}
	candidates.push(lastNav?.playerResponse, window.ytInitialPlayerResponse);
	return candidates.find((c) => videoIdOf(c) === videoId) ?? null;
}

function readInitialData(): unknown {
	if (lastNav && lastNav.url === location.href && lastNav.response)
		return lastNav.response;
	const app = document.querySelector("ytd-app") as PolymerElement | null;
	const fromApp = (app?.data as AnyObj | undefined)?.response;
	if (fromApp) return fromApp;
	const pm = document.querySelector(
		"ytd-page-manager",
	) as PolymerElement | null;
	try {
		const current = pm?.getCurrentData?.();
		if (current?.response) return current.response;
	} catch {
		// ignore
	}
	return window.ytInitialData ?? null;
}

function readPage(): YtPageData {
	const url = location.href;
	const videoId = videoIdFromUrl(url);
	return {
		url,
		pageType: detectPageType(url),
		videoId,
		playerResponse: readPlayerResponse(videoId),
		initialData: readInitialData(),
		capturedAt: Date.now(),
	};
}

function installBridge() {
	const ports = new Set<MessagePort>();

	const send = (port: MessagePort, event: BridgeEvent) => {
		try {
			port.postMessage(event);
		} catch {
			// Non-cloneable values: fall back to a JSON round-trip.
			try {
				port.postMessage(JSON.parse(JSON.stringify(event)));
			} catch {
				ports.delete(port);
			}
		}
	};

	const broadcastPage = (reason: PageEventReason) => {
		if (!ports.size) return;
		const data = readPage();
		for (const port of ports) send(port, { type: "page", reason, data });
	};

	/** ytcfg is populated by inline scripts shortly after document_start. */
	const waitForConfig = (timeoutMs = 8_000): Promise<YtConfig | null> =>
		new Promise((resolve) => {
			const started = Date.now();
			const tick = () => {
				const c = readConfig();
				if (c || Date.now() - started > timeoutMs) resolve(c);
				else setTimeout(tick, 100);
			};
			tick();
		});

	const handle = async (port: MessagePort, req: BridgeRequest) => {
		if (req?.type === "get-config") {
			send(port, { type: "config", id: req.id, config: await waitForConfig() });
		} else if (req?.type === "get-page") {
			if (document.readyState === "loading") {
				await new Promise((r) =>
					document.addEventListener("DOMContentLoaded", r, { once: true }),
				);
			}
			send(port, {
				type: "page",
				id: req.id,
				reason: "request",
				data: readPage(),
			});
		}
	};

	window.addEventListener("message", (event) => {
		if (
			event.source !== window ||
			(event.data as AnyObj | null)?.type !== BRIDGE_CONNECT
		)
			return;
		const port = event.ports[0];
		if (!port) return;
		ports.add(port);
		port.onmessage = (e) => void handle(port, e.data as BridgeRequest);
		send(port, { type: "hello" });
	});

	document.addEventListener("yt-navigate-finish", (event) => {
		const detail = (event as CustomEvent).detail as AnyObj | undefined;
		const response = (detail?.response as AnyObj | undefined) ?? undefined;
		lastNav = {
			url: location.href,
			response: response?.response ?? null,
			playerResponse: response?.playerResponse ?? null,
		};
		broadcastPage("navigate");
	});
	document.addEventListener("yt-page-data-updated", () =>
		broadcastPage("data-updated"),
	);
	document.addEventListener("DOMContentLoaded", () => broadcastPage("load"), {
		once: true,
	});

	// Isolated scripts that loaded first are waiting for this to connect.
	window.postMessage({ type: BRIDGE_READY }, location.origin);
}
