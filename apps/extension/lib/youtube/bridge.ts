/**
 * Isolated-world client for the MAIN-world bridge. Use from content scripts
 * on youtube.com only.
 *
 *   const cfg = await getYtConfig();
 *   const page = await getCurrentPageData();
 *   const off = onNavigate((page) => { ... });
 */
import {
	BRIDGE_CONNECT,
	BRIDGE_READY,
	type BridgeEvent,
} from "./bridge-protocol";
import { DEFAULT_YT_CONFIG } from "./innertube";
import { detectPageType, videoIdFromUrl } from "./page-type";
import type { YtConfig, YtPageData } from "./types";

const REQUEST_TIMEOUT_MS = 4_000;

let portPromise: Promise<MessagePort> | null = null;
let nextId = 1;
const pending = new Map<number, (event: BridgeEvent) => void>();
const navListeners = new Set<(page: YtPageData) => void>();
let lastConfig: YtConfig | null = null;
let lastPage: YtPageData | null = null;

function onPortMessage(event: MessageEvent) {
	const data = event.data as BridgeEvent;
	if (!data || typeof data !== "object") return;
	if ("id" in data && typeof data.id === "number") {
		const resolve = pending.get(data.id);
		if (resolve) {
			pending.delete(data.id);
			resolve(data);
		}
	}
	if (data.type === "config" && data.config) lastConfig = data.config;
	if (data.type === "page") {
		lastPage = data.data;
		if (data.reason !== "request") {
			for (const cb of navListeners) {
				try {
					cb(data.data);
				} catch (error) {
					console.error("[GrowTube] onNavigate listener failed", error);
				}
			}
		}
	}
}

function connect(): Promise<MessagePort> {
	if (portPromise) return portPromise;
	portPromise = new Promise<MessagePort>((resolve, reject) => {
		let attempts = 0;
		let done = false;
		const channels: MessageChannel[] = [];
		let timer: ReturnType<typeof setTimeout> | null = null;

		const finish = (winner: MessageChannel) => {
			done = true;
			if (timer) clearTimeout(timer);
			window.removeEventListener("message", onReady);
			for (const c of channels) if (c !== winner) c.port1.close();
			winner.port1.onmessage = onPortMessage;
			resolve(winner.port1);
		};

		const attempt = () => {
			if (done) return;
			attempts++;
			const channel = new MessageChannel();
			channels.push(channel);
			channel.port1.onmessage = (event) => {
				if (!done && (event.data as BridgeEvent)?.type === "hello")
					finish(channel);
			};
			window.postMessage({ type: BRIDGE_CONNECT }, location.origin, [
				channel.port2,
			]);
			if (attempts < 40) timer = setTimeout(attempt, 250);
			else {
				timer = setTimeout(() => {
					if (done) return;
					window.removeEventListener("message", onReady);
					for (const c of channels) c.port1.close();
					portPromise = null;
					reject(new Error("GrowTube bridge did not respond"));
				}, 500);
			}
		};
		// The bridge announces itself when it loads after us.
		const onReady = (event: MessageEvent) => {
			if (
				event.source === window &&
				(event.data as { type?: string })?.type === BRIDGE_READY
			) {
				if (timer) clearTimeout(timer);
				attempt();
			}
		};
		window.addEventListener("message", onReady);
		attempt();
	});
	return portPromise;
}

async function request(
	type: "get-config" | "get-page",
): Promise<BridgeEvent | null> {
	try {
		const port = await connect();
		const id = nextId++;
		return await new Promise<BridgeEvent | null>((resolve) => {
			const t = setTimeout(() => {
				pending.delete(id);
				resolve(null);
			}, REQUEST_TIMEOUT_MS);
			pending.set(id, (event) => {
				clearTimeout(t);
				resolve(event);
			});
			port.postMessage({ type, id });
		});
	} catch {
		return null;
	}
}

/**
 * The page's public InnerTube client identity (client version, API key, hl/gl).
 * Falls back to defaults (`source: "default"`) if the bridge is unavailable.
 */
export async function getYtConfig(): Promise<YtConfig> {
	if (lastConfig) return lastConfig;
	const event = await request("get-config");
	if (event?.type === "config" && event.config) {
		lastConfig = event.config;
		return event.config;
	}
	return { ...DEFAULT_YT_CONFIG };
}

/**
 * Current page's raw data: player response (watch/shorts) and ytInitialData
 * (or the latest SPA navigation response). Null if the bridge is unavailable.
 */
export async function getCurrentPageData(): Promise<YtPageData | null> {
	const event = await request("get-page");
	if (event?.type === "page") {
		lastPage = event.data;
		return event.data;
	}
	if (lastPage && lastPage.url === location.href) return lastPage;
	return null;
}

/**
 * Called after every SPA navigation (yt-navigate-finish), page-data update
 * and initial load, with the fresh page data. Returns an unsubscribe fn.
 */
export function onNavigate(cb: (page: YtPageData) => void): () => void {
	navListeners.add(cb);
	void connect().catch(() => {
		// Bridge unavailable: fall back to URL polling so callers still react.
		startUrlPolling();
	});
	return () => {
		navListeners.delete(cb);
	};
}

let polling = false;
function startUrlPolling() {
	if (polling) return;
	polling = true;
	let last = location.href;
	setInterval(() => {
		if (location.href === last) return;
		last = location.href;
		const page: YtPageData = {
			url: last,
			pageType: detectPageType(last),
			videoId: videoIdFromUrl(last),
			playerResponse: null,
			initialData: null,
			capturedAt: Date.now(),
		};
		for (const cb of navListeners) cb(page);
	}, 1_000);
}
