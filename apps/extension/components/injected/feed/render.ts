/**
 * Badge row rendering with plain DOM (hundreds of cards per page: no React
 * roots, one tiny shadow root each). Writes are batched per animation frame.
 */
import {
	formatCompact,
	formatNumber,
	formatOutlier,
} from "@growtube/shared/format";
import { type OutlierTier, outlierTier } from "@growtube/shared/metrics";

import { isYouTubeDark } from "@/lib/dom";

import { FEED_BADGES_TAG } from "../selectors";
import badgesCss from "./badges.css?inline";

export type PillSpec =
	| { kind: "skeleton"; id: string }
	| {
			kind: "pill";
			id: string;
			text: string;
			title: string;
			tone?: "subs" | OutlierTier;
	  };

export type BadgeHost = {
	host: HTMLElement;
	row: HTMLDivElement;
	/** Serialized last render, to skip no-op DOM writes */
	last: string;
};

export function createBadgeHost(): BadgeHost {
	const host = document.createElement(FEED_BADGES_TAG);
	const shadow = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.textContent = badgesCss;
	const row = document.createElement("div");
	row.className = "row";
	shadow.append(style, row);
	host.hidden = true;
	host.toggleAttribute("dark", isYouTubeDark());
	return { host, row, last: "" };
}

/** Re-themes every badge row when YouTube switches light/dark. */
export function syncBadgeTheme(dark: boolean): void {
	for (const host of document.querySelectorAll(FEED_BADGES_TAG)) {
		host.toggleAttribute("dark", dark);
	}
}

export function renderPills(target: BadgeHost, pills: PillSpec[]): void {
	const serialized = JSON.stringify(pills);
	if (serialized === target.last) return;
	target.last = serialized;
	const nodes = pills.map((p) => {
		const el = document.createElement("span");
		if (p.kind === "skeleton") {
			el.className = "pill skeleton";
			el.setAttribute("aria-hidden", "true");
			return el;
		}
		el.className = p.tone ? `pill ${p.tone}` : "pill";
		el.textContent = p.text;
		el.title = p.title;
		return el;
	});
	target.row.replaceChildren(...nodes);
	target.host.hidden = nodes.length === 0;
}

export function vphPill(
	vph: number,
	approximate: boolean,
	recent: boolean,
): PillSpec {
	const text = `${formatCompact(vph, 1)} VPH`;
	const title = recent
		? `${formatNumber(vph)} views per hour over the last ~48 hours (GrowTube server)`
		: `${formatNumber(vph)} views per hour since upload${approximate ? " (approximate: from the card's rounded views and age)" : ""}`;
	return { kind: "pill", id: "vph", text, title };
}

export function outlierPill(
	score: number,
	baseline: number,
	format: "long" | "short",
): PillSpec {
	const tier = outlierTier(score) ?? "normal";
	return {
		kind: "pill",
		id: "outlier",
		text: formatOutlier(score),
		tone: tier,
		title: `Outlier score: ${formatOutlier(score)} the channel's typical ${format === "short" ? "Short" : "video"} (median ${formatCompact(baseline)} views over its recent uploads)`,
	};
}

export function subsPill(subscribers: number): PillSpec {
	return {
		kind: "pill",
		id: "subs",
		text: `${formatCompact(subscribers, subscribers >= 1e6 ? 2 : 1)} Subscribers`,
		tone: "subs",
		title: `${formatNumber(subscribers)} subscribers (rounded public count)`,
	};
}

export function sizePill(size: string): PillSpec {
	return { kind: "pill", id: "size", text: size, title: "Playlist size" };
}

export const skeleton = (id: string): PillSpec => ({ kind: "skeleton", id });
