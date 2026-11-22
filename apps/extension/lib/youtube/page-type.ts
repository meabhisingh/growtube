/** URL classification shared by the MAIN-world bridge and content scripts. */
import { extractVideoId } from "@growtube/shared/youtube";

import type { YtPageType } from "./types";

export function detectPageType(href: string): YtPageType {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return "other";
	}
	if (url.hostname.startsWith("studio.")) return "studio";
	const path = url.pathname;
	if (path === "/watch" || path.startsWith("/live/")) return "watch";
	if (path.startsWith("/shorts/")) return "shorts";
	if (path === "/results") return "search";
	if (path === "/" || path === "") return "home";
	if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(path))
		return "channel";
	if (path.startsWith("/feed/") || path.startsWith("/playlist"))
		return "browse";
	return "other";
}

/** Video id of a watch / shorts / live URL, else null. */
export function videoIdFromUrl(href: string): string | null {
	const type = detectPageType(href);
	return type === "watch" || type === "shorts" ? extractVideoId(href) : null;
}
