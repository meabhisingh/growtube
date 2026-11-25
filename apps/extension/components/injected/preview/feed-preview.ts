/**
 * Live feed preview: a fake video card (the user's own thumbnail + title,
 * sent from the side panel's Thumbnails tool) shown in the real home grid or
 * search results, 3rd position, with a small "GrowTube preview" tag and a
 * floating "Remove preview" bar.
 *
 * Never breaks YouTube: the card is one extra element inserted as a sibling
 * of YouTube's cells (nothing of YouTube's is modified), with its own shadow
 * root. A 1 s check (not a MutationObserver reacting to YouTube's own
 * mutations) re-inserts it when YouTube re-renders the list, and it is
 * removed on navigation, sign-out, the Remove button or an extension reload.
 * The image stays in this tab: a blob URL created here, revoked on removal.
 */
import type { ContentScriptContext } from "#imports";

import { isYouTubeDark, onYouTubeThemeChange } from "@/lib/dom";
import {
	FEED_PREVIEW_PAGE_TYPES,
	type FeedPreviewCard,
	type FeedPreviewResult,
	sanitizeFeedPreviewCard,
} from "@/lib/feed-preview";
import { detectPageType } from "@/lib/youtube/page-type";

import {
	AD_CONTAINER,
	FEED_PREVIEW_BAR_TAG,
	FEED_PREVIEW_TAG,
	HOME_GRID_CONTENTS,
	HOME_GRID_ITEM,
	SEARCH_RESULT_ITEMS,
	SEARCH_RESULT_THUMB,
	SEARCH_SECTION_CONTENTS,
} from "../selectors";
import css from "./feed-preview.css?inline";

type Kind = "home" | "search";

type Slot = { parent: Element; before: Node | null; ref: HTMLElement };

type Active = {
	kind: Kind;
	url: string;
	host: HTMLElement;
	bar: HTMLElement;
	ref: HTMLElement | null;
	resize: ResizeObserver;
	blobUrls: string[];
	reinserts: number;
};

export type FeedPreview = {
	show: (card: unknown) => Promise<FeedPreviewResult>;
	remove: () => FeedPreviewResult;
	/** Call on every SPA navigation: a new URL removes the card. */
	onNavigate: (url: string) => void;
};

/** Position of the fake card among the real ones (0-based: 3rd). */
const TARGET_INDEX = 2;
const WAIT_FOR_GRID_MS = 10_000;
const MAX_REINSERTS = 30;

function isShown(el: Element): boolean {
	const h = el as HTMLElement;
	return !h.hidden && h.offsetParent !== null && h.offsetHeight > 0;
}

function isAd(el: Element): boolean {
	return !!el.closest(AD_CONTAINER) || !!el.querySelector(AD_CONTAINER);
}

function findSlot(kind: Kind): Slot | null {
	if (kind === "home") {
		for (const contents of document.querySelectorAll(HOME_GRID_CONTENTS)) {
			if (!isShown(contents)) continue;
			const items = [...contents.children].filter(
				(el) =>
					el.localName === HOME_GRID_ITEM &&
					isShown(el) &&
					!isAd(el) &&
					!!el.querySelector('a[href*="/watch?v="]'),
			) as HTMLElement[];
			const ref = items[1];
			const before = items[Math.min(TARGET_INDEX, items.length - 1)];
			if (!ref || !before) continue;
			return { parent: contents, before, ref };
		}
		return null;
	}
	for (const contents of document.querySelectorAll(SEARCH_SECTION_CONTENTS)) {
		if (!isShown(contents)) continue;
		const items = [...contents.children].filter(
			(el) =>
				SEARCH_RESULT_ITEMS.includes(el.localName) && isShown(el) && !isAd(el),
		) as HTMLElement[];
		const ref = items[1];
		if (!ref) continue;
		const before = items[TARGET_INDEX] ?? ref.nextSibling;
		return { parent: contents, before, ref };
	}
	return null;
}

function dataUrlToBlobUrl(dataUrl: string): string | null {
	try {
		const comma = dataUrl.indexOf(",");
		const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/jpeg";
		const bin = atob(dataUrl.slice(comma + 1));
		const bytes = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return URL.createObjectURL(new Blob([bytes], { type: mime }));
	} catch {
		return null;
	}
}

function el<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	className?: string,
	text?: string,
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

function image(src: string, fallback: string): HTMLImageElement {
	const img = el("img");
	img.alt = "";
	img.decoding = "async";
	img.draggable = false;
	// A page CSP that refused blob: would leave it blank: fall back once.
	img.addEventListener("error", () => {
		if (img.src !== fallback) img.src = fallback;
	});
	img.src = src;
	return img;
}

function avatarNode(
	card: FeedPreviewCard,
	avatarUrl: string | null,
): HTMLElement {
	const box = el("div", "avatar");
	box.setAttribute("aria-hidden", "true");
	if (card.avatar && avatarUrl) box.append(image(avatarUrl, card.avatar));
	else box.textContent = card.channel.trim().charAt(0).toUpperCase() || "?";
	return box;
}

function buildCard(
	kind: Kind,
	card: FeedPreviewCard,
	imageUrl: string,
	avatarUrl: string | null,
): HTMLElement {
	const root = el("div", `card ${kind}`);
	root.setAttribute("role", "article");
	root.setAttribute("aria-label", `GrowTube preview: ${card.title}`);

	const thumb = el("div", "thumb");
	thumb.append(
		image(imageUrl, card.image),
		el("span", "tag", "GrowTube preview"),
	);
	if (card.duration) thumb.append(el("span", "time", card.duration));

	const title = el("h3", "title", card.title);
	title.title = card.title;
	const text = el("div", "text");

	if (kind === "home") {
		const meta = el("div", "meta");
		meta.append(el("div", "line", card.channel));
		if (card.meta) meta.append(el("div", "line", card.meta));
		text.append(title, meta);
		const details = el("div", "details");
		details.append(avatarNode(card, avatarUrl), text);
		root.append(thumb, details);
	} else {
		const channel = el("div", "channel");
		channel.append(
			avatarNode(card, avatarUrl),
			el("span", "line", card.channel),
		);
		text.append(title);
		if (card.meta) text.append(el("div", "meta line", card.meta));
		text.append(
			channel,
			el(
				"div",
				"desc",
				"Preview from GrowTube: only you can see this card. Your image and title stay on this computer.",
			),
		);
		root.append(thumb, text);
	}
	// It is not a real video: swallow clicks so YouTube doesn't react.
	root.addEventListener("click", (e) => {
		e.preventDefault();
		e.stopPropagation();
	});
	return root;
}

function shadowHost(tag: string): { host: HTMLElement; shadow: ShadowRoot } {
	const host = document.createElement(tag);
	const shadow = host.attachShadow({ mode: "open" });
	const style = el("style");
	style.textContent = css;
	shadow.append(style);
	host.toggleAttribute("dark", isYouTubeDark());
	return { host, shadow };
}

/** Removes cards left behind by an older instance (extension reloaded). */
export function removeFeedPreviewLeftovers(): void {
	for (const node of document.querySelectorAll(
		`${FEED_PREVIEW_TAG}, ${FEED_PREVIEW_BAR_TAG}`,
	))
		node.remove();
}

export function createFeedPreview(ctx: ContentScriptContext): FeedPreview {
	let active: Active | null = null;
	let showSeq = 0;
	let offTheme: (() => void) | null = null;

	const result = (status: FeedPreviewResult["status"]): FeedPreviewResult => ({
		status,
		pageType: detectPageType(location.href),
	});

	/** Copies the neighbouring real cell's box so the grid stays aligned. */
	const mirror = (state: Active) => {
		const ref = state.ref;
		if (!ref?.isConnected) return;
		const cs = getComputedStyle(ref);
		const s = state.host.style;
		s.marginTop = cs.marginTop;
		s.marginBottom = cs.marginBottom;
		if (state.kind === "home") {
			s.width = cs.width;
			s.marginLeft = cs.marginLeft;
			s.marginRight = cs.marginRight;
			s.flex = "none";
		} else {
			const thumb = ref.querySelector(
				SEARCH_RESULT_THUMB,
			) as HTMLElement | null;
			const thumbWidth = thumb?.getBoundingClientRect().width ?? 0;
			const rowWidth = ref.getBoundingClientRect().width;
			if (thumbWidth > 0)
				s.setProperty("--ovq-thumb-w", `${Math.round(thumbWidth)}px`);
			const card = state.host.shadowRoot?.querySelector(".card");
			card?.classList.toggle(
				"stacked",
				thumbWidth > 0 && rowWidth > 0 && thumbWidth >= rowWidth * 0.85,
			);
		}
	};

	const place = (state: Active): boolean => {
		const slot = findSlot(state.kind);
		if (!slot) return false;
		if (slot.before !== state.host)
			slot.parent.insertBefore(state.host, slot.before);
		if (state.ref !== slot.ref) {
			if (state.ref) state.resize.unobserve(state.ref);
			state.ref = slot.ref;
			state.resize.observe(slot.ref);
		}
		mirror(state);
		return true;
	};

	const remove = (): FeedPreviewResult => {
		showSeq++;
		const state = active;
		active = null;
		offTheme?.();
		offTheme = null;
		if (state) {
			state.resize.disconnect();
			state.host.remove();
			state.bar.remove();
			for (const url of state.blobUrls) URL.revokeObjectURL(url);
		}
		removeFeedPreviewLeftovers();
		return result("removed");
	};

	const buildBar = (): HTMLElement => {
		const { host, shadow } = shadowHost(FEED_PREVIEW_BAR_TAG);
		const bar = el("div", "bar");
		bar.setAttribute("role", "status");
		const show = el("button", "", "Show");
		show.type = "button";
		show.title = "Scroll to the preview card";
		const close = el("button", "primary", "Remove preview");
		close.type = "button";
		bar.append(el("span", "label", "GrowTube thumbnail preview"), show, close);
		show.addEventListener("click", (e) => {
			e.stopPropagation();
			active?.host.scrollIntoView({ behavior: "smooth", block: "center" });
		});
		close.addEventListener("click", (e) => {
			e.stopPropagation();
			remove();
		});
		// Keep YouTube's keyboard shortcuts away from our buttons.
		bar.addEventListener("keydown", (e) => e.stopPropagation());
		shadow.append(bar);
		return host;
	};

	const show = async (raw: unknown): Promise<FeedPreviewResult> => {
		const card = sanitizeFeedPreviewCard(raw);
		const pageType = detectPageType(location.href);
		if (!card) return result("no-grid");
		if (!FEED_PREVIEW_PAGE_TYPES.has(pageType))
			return result("unsupported-page");
		remove();
		const seq = ++showSeq;
		const kind: Kind = pageType === "home" ? "home" : "search";
		const url = location.href;

		// The grid may still be rendering (fresh navigation): wait for it.
		const started = Date.now();
		while (!findSlot(kind)) {
			if (Date.now() - started > WAIT_FOR_GRID_MS) return result("no-grid");
			await new Promise((r) => setTimeout(r, 250));
			if (seq !== showSeq || ctx.isInvalid || location.href !== url)
				return result("removed");
		}

		const blobUrls: string[] = [];
		const imageUrl = dataUrlToBlobUrl(card.image) ?? card.image;
		if (imageUrl.startsWith("blob:")) blobUrls.push(imageUrl);
		const avatarUrl = card.avatar
			? (dataUrlToBlobUrl(card.avatar) ?? card.avatar)
			: null;
		if (avatarUrl?.startsWith("blob:")) blobUrls.push(avatarUrl);

		const { host, shadow } = shadowHost(FEED_PREVIEW_TAG);
		shadow.append(buildCard(kind, card, imageUrl, avatarUrl));
		const bar = buildBar();
		const state: Active = {
			kind,
			url,
			host,
			bar,
			ref: null,
			resize: new ResizeObserver(() => {
				if (active === state) mirror(state);
			}),
			blobUrls,
			reinserts: 0,
		};
		active = state;
		if (!place(state)) {
			remove();
			return result("no-grid");
		}
		document.body.append(bar);
		offTheme = onYouTubeThemeChange((dark) => {
			host.toggleAttribute("dark", dark);
			bar.toggleAttribute("dark", dark);
		});
		return result("shown");
	};

	// Safety net: navigation the hub missed, and YouTube re-rendering the list
	// (chip filters, continuation reloads) which can drop our element.
	ctx.setInterval(() => {
		const state = active;
		if (!state) return;
		if (location.href !== state.url) {
			remove();
			return;
		}
		if (state.host.isConnected && state.ref?.isConnected) return;
		// Give up (and clean up) if YouTube keeps dropping it.
		if (++state.reinserts > MAX_REINSERTS) remove();
		else place(state);
	}, 1_000);
	ctx.onInvalidated(() => {
		remove();
	});

	return {
		show,
		remove,
		onNavigate(url) {
			if (active && url !== active.url) remove();
		},
	};
}
