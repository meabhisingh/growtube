/**
 * Wire protocol between the MAIN-world bridge (entrypoints/youtube-bridge.content.ts)
 * and isolated-world content scripts (lib/youtube/bridge.ts).
 *
 * Handshake: the isolated side posts `{ type: BRIDGE_CONNECT }` on `window`
 * with a MessagePort; all further traffic flows over that private port, so
 * YouTube's own `message` listeners never see the (large) payloads.
 * The page can forge messages too, so treat everything as untrusted page data.
 * Never add a request that makes the isolated side message the background or
 * read storage on the page's behalf (sign-in state, token, settings).
 */
import type { YtConfig, YtPageData } from "./types";

export const BRIDGE_CONNECT = "ovq:bridge:connect";
export const BRIDGE_READY = "ovq:bridge:ready";

/** isolated -> main */
export type BridgeRequest =
	| { type: "get-config"; id: number }
	| { type: "get-page"; id: number };

export type PageEventReason = "load" | "navigate" | "data-updated" | "request";

/** main -> isolated */
export type BridgeEvent =
	| { type: "hello" }
	| { type: "config"; id?: number; config: YtConfig | null }
	| { type: "page"; id?: number; reason: PageEventReason; data: YtPageData };
