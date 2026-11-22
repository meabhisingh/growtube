/**
 * YouTube Studio selectors, with fallbacks. Studio is a Polymer app that
 * changes markup without notice, so every lookup tries, in order:
 *
 *   1. stable ids / custom element names (language independent),
 *   2. aria-label / attribute heuristics (English UI),
 *   3. visible label text near a field (English UI, last resort).
 *
 * Keep this file in sync with SELECTORS.md (same folder).
 */

export const SELECTORS = {
	/** The upload / "edit draft" dialog. */
	uploadDialog: [
		"ytcp-uploads-dialog",
		"ytcp-uploads-dialog-v2",
		"#upload-dialog",
	],
	/** Inside the upload dialog: the Details step. */
	uploadDetailsStep: [
		"ytcp-uploads-details",
		"ytcp-uploads-dialog ytcp-video-metadata-editor",
		"#details-step",
	],
	/** Title contenteditable. */
	title: [
		"#title-textarea #textbox",
		"ytcp-social-suggestions-textbox#title-textarea #textbox",
		"#title-textarea [contenteditable]",
		"ytcp-video-title #textbox",
		"#title #textbox",
		'#textbox[aria-label*="title" i]',
		'[contenteditable][aria-label*="title" i]',
	],
	/** Description contenteditable. */
	description: [
		"#description-textarea #textbox",
		"ytcp-social-suggestions-textbox#description-textarea #textbox",
		"#description-textarea [contenteditable]",
		"#description-container #textbox",
		"ytcp-video-description #textbox",
		'#textbox[aria-label*="description" i]',
		'#textbox[aria-label*="tell viewers" i]',
		'[contenteditable][aria-label*="description" i]',
		'[contenteditable][aria-label*="tell viewers" i]',
	],
	/** Container of the tags chip bar (found via the input when missing). */
	tagsContainer: [
		"#tags-container",
		"ytcp-form-input-container#tags-container",
		"ytcp-video-metadata-editor-advanced ytcp-free-text-chip-bar",
		"ytcp-free-text-chip-bar#tags",
		"#tags ytcp-chip-bar",
	],
	/** Text input of the tags chip bar. */
	tagInput: [
		"#tags-container input#text-input",
		"#tags-container input",
		"ytcp-free-text-chip-bar input#text-input",
		'input[aria-label="Tags" i]',
		'input[aria-label*="tags" i]',
		'input[placeholder*="add tag" i]',
	],
	/** Ancestors of the tag input that hold the chips. */
	tagInputAncestors: [
		"#tags-container",
		"ytcp-free-text-chip-bar",
		"ytcp-chip-bar",
		"ytcp-form-input-container",
	],
	/** A single tag chip (relative to the tags container). */
	chip: ["ytcp-chip", "ytcp-chip-v2", ".ytcp-chip", '[role="option"]'],
	/** Text of a chip (relative to a chip). */
	chipText: ["#chip-text", ".chip-text", "#text", ".text"],
	/** Delete button of a chip (relative to a chip). */
	chipDelete: [
		"#delete-icon",
		"#delete-button",
		'[aria-label^="delete" i]',
		'[aria-label^="remove" i]',
		"ytcp-icon-button",
		"tp-yt-iron-icon",
	],
	/** "Remove all" tags button (relative to the tags container). */
	tagsClearAll: [
		"#clear-button",
		'[aria-label*="remove all" i]',
		'[aria-label*="clear all" i]',
		'[aria-label*="delete all" i]',
	],
	/** "Show more" toggle that reveals the advanced section (tags). */
	showMore: [
		"ytcp-video-metadata-editor #toggle-button",
		"#toggle-button",
		'ytcp-button[aria-label*="show more" i]',
		'button[aria-label*="show more" i]',
	],
	/** Where the panel docks: after the video preview card in the right column. */
	dockAfter: [
		"ytcp-video-info",
		"ytcp-video-metadata-editor-sidepanel ytcp-video-info",
		"#right-column ytcp-video-info",
	],
	/** Fallback dock containers (panel appended as last child). */
	dockInto: [
		"ytcp-video-metadata-editor-sidepanel",
		"#right-column",
		"#side-panel",
		"#sidepanel",
	],
	/** The metadata form; the inline fallback goes right before it. */
	metadataEditor: [
		"ytcp-video-metadata-editor",
		"ytcp-video-metadata-editor-basics",
		"#basics",
	],
} as const;

/** Visible labels used by the text-based fallback (English Studio UI). */
export const LABEL_TEXT = {
	title: /^title(\s*\(required\))?\s*\*?$/i,
	description: /^description\s*\*?$/i,
	tags: /^tags$/i,
	showMore: /^show more$/i,
} as const;

/** Elements inside these never count as fields (our own UI, Studio pop-ups). */
const IGNORE_INSIDE = "ovq-studio-optimizer";

type Root = Document | Element | ShadowRoot;

export function isVisible(el: Element | null | undefined): boolean {
	if (!el?.isConnected) return false;
	return el.getClientRects().length > 0;
}

function safeQueryAll(root: Root, selector: string): Element[] {
	try {
		return Array.from(root.querySelectorAll(selector));
	} catch {
		return [];
	}
}

/** Walks open shadow roots too (Studio mostly uses shady DOM, but be safe). */
export function deepQueryAll(
	root: Root,
	selector: string,
	max = 50,
): Element[] {
	const out: Element[] = [...safeQueryAll(root, selector)];
	const stack: Root[] = [root];
	let visited = 0;
	while (stack.length && out.length < max && visited < 20_000) {
		const node = stack.pop() as Root;
		const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
		let current = walker.nextNode() as Element | null;
		while (current) {
			visited++;
			const sr = (current as HTMLElement).shadowRoot;
			if (sr && current.localName !== IGNORE_INSIDE) {
				out.push(...safeQueryAll(sr, selector));
				stack.push(sr);
			}
			current = walker.nextNode() as Element | null;
		}
	}
	return out;
}

export type QueryOptions = {
	/** Prefer visible matches (falls back to any match) */
	preferVisible?: boolean;
	/** Extra filter */
	filter?: (el: Element) => boolean;
	/** Skip matches inside this element (e.g. the upload dialog on the edit page) */
	exclude?: Element | null;
	/** Also search open shadow roots when nothing matched */
	deep?: boolean;
};

function accept(el: Element, opts: QueryOptions): boolean {
	if (el.closest(IGNORE_INSIDE)) return false;
	if (opts.exclude?.contains(el)) return false;
	return opts.filter ? opts.filter(el) : true;
}

/** First element matching any of `selectors` (in priority order). */
export function queryFirst<T extends Element = HTMLElement>(
	root: Root,
	selectors: readonly string[],
	opts: QueryOptions = {},
): T | null {
	let fallback: Element | null = null;
	for (const pass of opts.deep ? [false, true] : [false]) {
		for (const selector of selectors) {
			const found = pass
				? deepQueryAll(root, selector)
				: safeQueryAll(root, selector);
			for (const el of found) {
				if (!accept(el, opts)) continue;
				if (!opts.preferVisible || isVisible(el)) return el as T;
				fallback ??= el;
			}
		}
		if (fallback) return fallback as T;
	}
	return null;
}

/** All elements matching any selector, de-duplicated, document order. */
export function queryAll<T extends Element = HTMLElement>(
	root: Root,
	selectors: readonly string[],
	opts: QueryOptions = {},
): T[] {
	for (const selector of selectors) {
		const found = safeQueryAll(root, selector).filter((el) => accept(el, opts));
		if (found.length) return found as T[];
	}
	return [];
}

/** Normalized visible text of a small element. */
export function textOf(el: Element | null | undefined): string {
	if (!el) return "";
	return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Text-based fallback: finds an element whose own text matches `label`, then
 * walks up a few ancestors looking for `target` inside the same block.
 */
export function findNearLabel<T extends Element = HTMLElement>(
	root: Root,
	label: RegExp,
	target: string,
	opts: QueryOptions & { maxDepth?: number } = {},
): T | null {
	const base = root instanceof Document ? root.body : root;
	if (!base) return null;
	const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	let checked = 0;
	while (node && checked < 30_000) {
		checked++;
		const text = (node.nodeValue ?? "").trim();
		if (text && text.length < 40 && label.test(text)) {
			let el: Element | null = node.parentElement;
			for (let depth = 0; el && depth < (opts.maxDepth ?? 6); depth++) {
				const candidates = safeQueryAll(el, target).filter((c) =>
					accept(c, opts),
				);
				const pick = opts.preferVisible
					? (candidates.find(isVisible) ?? candidates[0])
					: candidates[0];
				if (pick) return pick as T;
				el = el.parentElement;
			}
		}
		node = walker.nextNode();
	}
	return null;
}

/** Clickable element (button-ish) whose text or aria-label matches. */
export function findButtonByText(
	root: Root,
	text: RegExp,
	opts: QueryOptions = {},
): HTMLElement | null {
	const candidates = safeQueryAll(
		root,
		'button, ytcp-button, tp-yt-paper-button, [role="button"]',
	);
	for (const el of candidates) {
		if (!accept(el, opts)) continue;
		const label = el.getAttribute("aria-label") ?? "";
		if (text.test(textOf(el)) || text.test(label.trim()))
			return el as HTMLElement;
	}
	return null;
}
