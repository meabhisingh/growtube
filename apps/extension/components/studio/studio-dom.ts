/**
 * Reading and writing YouTube Studio's details form.
 *
 * Writes go through the browser's editing pipeline (`execCommand`) so
 * Studio's own listeners see real `beforeinput`/`input` events, mark the form
 * dirty and enable its Save button. Nothing here ever clicks Save.
 */
import { isVideoId } from "@open-vidiq/shared/youtube";

import {
	findButtonByText,
	findNearLabel,
	isVisible,
	LABEL_TEXT,
	queryAll,
	queryFirst,
	SELECTORS,
	textOf,
} from "./selectors";
import { NBSP_RE, normalizeForCompare } from "./text";

// ---------------------------------------------------------------------------
// Where are we?
// ---------------------------------------------------------------------------

export type StudioTargetKind = "edit" | "upload";

export type StudioTarget = {
	kind: StudioTargetKind;
	/** null while Studio hasn't assigned/shown the id yet (fresh uploads) */
	videoId: string | null;
	/** The upload dialog (upload) or null (edit page) */
	dialog: Element | null;
};

const EDIT_PATH_RE = /^\/video\/([\w-]{11})\/edit(?:\/|$)/;

export function videoIdFromStudioPath(pathname: string): string | null {
	const m = EDIT_PATH_RE.exec(pathname);
	return m?.[1] ?? null;
}

/** Visible upload dialog showing its Details step, if any. */
export function findUploadDetailsDialog(): Element | null {
	for (const dialog of queryAll(document, SELECTORS.uploadDialog)) {
		if (!isVisible(dialog)) continue;
		const title = queryFirst(dialog, SELECTORS.title, { preferVisible: true });
		if (title && isVisible(title)) return dialog;
	}
	return null;
}

const VIDEO_LINK_RE =
	/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/video\/)([\w-]{11})(?![\w-])/;

/** Video id shown inside the upload dialog (the "Video link" card). */
export function videoIdFromDialog(dialog: Element): string | null {
	for (const a of Array.from(dialog.querySelectorAll("a[href]"))) {
		const id = VIDEO_LINK_RE.exec(a.getAttribute("href") ?? "")?.[1];
		if (id && isVideoId(id)) return id;
	}
	const info = queryFirst(dialog, ["ytcp-video-info", ".video-url-fadeable"]);
	const id = VIDEO_LINK_RE.exec(textOf(info))?.[1];
	return id && isVideoId(id) ? id : null;
}

/**
 * The editor in front of the user: the upload dialog's Details step wins
 * over the page behind it (it is modal).
 */
export function detectTarget(): StudioTarget | null {
	const dialog = findUploadDetailsDialog();
	if (dialog) {
		return { kind: "upload", videoId: videoIdFromDialog(dialog), dialog };
	}
	const videoId = videoIdFromStudioPath(location.pathname);
	if (videoId) return { kind: "edit", videoId, dialog: null };
	return null;
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

function luminance(color: string): number | null {
	const m = /rgba?\(([^)]+)\)/.exec(color);
	if (!m?.[1]) return null;
	const [r, g, b, a] = m[1].split(",").map((v) => Number.parseFloat(v));
	if (r == null || g == null || b == null) return null;
	if (a != null && a < 0.5) return null;
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Studio dark theme: `dark` attribute on <html>, else the page background. */
export function isStudioDark(): boolean {
	const html = document.documentElement;
	if (html.hasAttribute("dark")) return true;
	if (document.body?.hasAttribute("dark")) return true;
	for (const el of [document.querySelector("ytcp-app"), document.body, html]) {
		if (!el) continue;
		const lum = luminance(getComputedStyle(el).backgroundColor);
		if (lum != null) return lum < 0.4;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Field lookup (cached; re-resolved when Studio swaps elements)
// ---------------------------------------------------------------------------

export type FieldSnapshot = {
	title: string | null;
	description: string | null;
	/** null = tags field not found (often hidden behind "Show more") */
	tags: string[] | null;
};

/** How often the slow fallbacks may run for a field that isn't found. */
const DEEP_SEARCH_INTERVAL_MS = 5_000;

export class StudioFields {
	private cache = new Map<string, Element>();
	private lastDeepSearch = new Map<string, number>();

	constructor(readonly target: StudioTarget) {}

	/** Search root: the dialog, or the page minus any upload dialog. */
	private get root(): Document | Element {
		return this.target.dialog ?? document;
	}

	private get exclude(): Element | null {
		if (this.target.dialog) return null;
		return queryFirst(document, SELECTORS.uploadDialog);
	}

	/**
	 * Cached lookup. `cheap` (selectors) runs every time the cache misses;
	 * `expensive` (label-text and shadow-root walks) at most every few
	 * seconds, so a missing field doesn't make every poll walk the DOM.
	 */
	private resolve<T extends Element>(
		key: string,
		cheap: () => T | null,
		expensive?: () => T | null,
	): T | null {
		const hit = this.cache.get(key);
		if (hit?.isConnected && !this.exclude?.contains(hit)) return hit as T;
		let found = cheap();
		if (!found && expensive) {
			const last = this.lastDeepSearch.get(key) ?? 0;
			if (Date.now() - last >= DEEP_SEARCH_INTERVAL_MS) {
				this.lastDeepSearch.set(key, Date.now());
				found = expensive();
			}
		}
		if (found) this.cache.set(key, found);
		else this.cache.delete(key);
		return found;
	}

	reset(): void {
		this.cache.clear();
		this.lastDeepSearch.clear();
	}

	title(): HTMLElement | null {
		const opts = () => ({ preferVisible: true, exclude: this.exclude });
		return this.resolve(
			"title",
			() => queryFirst(this.root, SELECTORS.title, opts()),
			() =>
				findNearLabel(
					this.root,
					LABEL_TEXT.title,
					"[contenteditable]",
					opts(),
				) ?? queryFirst(this.root, SELECTORS.title, { ...opts(), deep: true }),
		);
	}

	description(): HTMLElement | null {
		const opts = () => ({
			preferVisible: true,
			exclude: this.exclude,
			filter: (el: Element) => el !== this.title(),
		});
		return this.resolve(
			"description",
			() => queryFirst(this.root, SELECTORS.description, opts()),
			() =>
				findNearLabel(
					this.root,
					LABEL_TEXT.description,
					"[contenteditable]",
					opts(),
				) ??
				queryFirst(this.root, SELECTORS.description, { ...opts(), deep: true }),
		);
	}

	tagInput(): HTMLInputElement | null {
		const opts = () => ({
			preferVisible: true,
			exclude: this.exclude,
			filter: (el: Element) => el instanceof HTMLInputElement,
		});
		return this.resolve(
			"tagInput",
			() => {
				const container = this.tagsContainerDirect();
				return (
					(container
						? queryFirst<HTMLInputElement>(
								container,
								["input#text-input", "input"],
								opts(),
							)
						: null) ??
					queryFirst<HTMLInputElement>(this.root, SELECTORS.tagInput, opts())
				);
			},
			() =>
				findNearLabel<HTMLInputElement>(
					this.root,
					LABEL_TEXT.tags,
					"input",
					opts(),
				) ??
				queryFirst<HTMLInputElement>(this.root, SELECTORS.tagInput, {
					...opts(),
					deep: true,
				}),
		);
	}

	private tagsContainerDirect(): Element | null {
		return queryFirst(this.root, SELECTORS.tagsContainer, {
			preferVisible: true,
			exclude: this.exclude,
		});
	}

	tagsContainer(): Element | null {
		return this.resolve("tagsContainer", () => {
			const direct = this.tagsContainerDirect();
			if (direct) return direct;
			const input = this.tagInput();
			if (!input) return null;
			for (const sel of SELECTORS.tagInputAncestors) {
				const anc = input.closest(sel);
				if (anc) return anc;
			}
			return input.parentElement?.parentElement ?? input.parentElement;
		});
	}

	/** Chip elements currently in the tags bar. */
	chips(): Element[] {
		const container = this.tagsContainer();
		if (!container) return [];
		return queryAll(container, SELECTORS.chip);
	}

	readTags(): string[] | null {
		const container = this.tagsContainer();
		if (!container) return null;
		const tags: string[] = [];
		for (const chip of this.chips()) {
			const label = queryFirst(chip, SELECTORS.chipText);
			const text = label ? textOf(label) : textOf(chip);
			if (text) tags.push(text);
		}
		return tags;
	}

	read(): FieldSnapshot {
		const title = this.title();
		const description = this.description();
		return {
			title: title ? readEditable(title) : null,
			description: description ? readEditable(description) : null,
			tags: this.readTags(),
		};
	}

	/** Studio's "Show more" toggle (reveals tags). */
	showMoreButton(): HTMLElement | null {
		const opts = { preferVisible: true, exclude: this.exclude };
		const btn =
			queryFirst(this.root, SELECTORS.showMore, opts) ??
			findButtonByText(this.root, LABEL_TEXT.showMore, opts);
		return btn && /show less/i.test(textOf(btn)) ? null : btn;
	}
}

/** Text of a Studio contenteditable, with line breaks. */
export function readEditable(el: HTMLElement): string {
	// innerText (not textContent) keeps the line breaks Studio renders as <br>/<div>.
	// biome-ignore lint/performance/useDomNodeTextContent: line breaks matter here
	const raw = isVisible(el) ? el.innerText : (el.textContent ?? "");
	return raw.replace(NBSP_RE, " ").replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type WriteResult = {
	ok: boolean;
	/** Which strategy worked (for debugging) */
	method?: "insertText" | "lines" | "innerText";
	previous: string;
};

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

/** True when `el` (or something inside it) has keyboard focus. */
function hasFocus(el: Element): boolean {
	const root = el.getRootNode() as Document | ShadowRoot;
	const active = root.activeElement;
	return !!active && (active === el || el.contains(active));
}

/**
 * Focuses `el` and selects all of its contents. Returns false when focus or
 * the selection did not land inside `el` (hidden/disabled field): callers
 * must then NOT use execCommand, which would edit whatever else is focused.
 */
function selectContents(el: HTMLElement): boolean {
	el.focus();
	if (!hasFocus(el)) return false;
	const sel = window.getSelection();
	if (!sel) return false;
	const range = document.createRange();
	range.selectNodeContents(el);
	sel.removeAllRanges();
	sel.addRange(range);
	return !!sel.anchorNode && el.contains(sel.anchorNode);
}

function exec(command: string, value?: string): boolean {
	try {
		return document.execCommand(command, false, value);
	} catch {
		return false;
	}
}

function fireInput(el: HTMLElement, data: string | null): void {
	el.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			composed: true,
			inputType: "insertText",
			data,
		}),
	);
}

function fireChange(el: HTMLElement): void {
	el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

const trimEnd = (s: string) => s.replace(/\s+$/, "");

/** Same text, line breaks included. */
function exact(el: HTMLElement, text: string): boolean {
	return trimEnd(readEditable(el)) === trimEnd(text);
}

/** Same lines, ignoring blank-line and whitespace differences. */
function matches(el: HTMLElement, text: string): boolean {
	return normalizeForCompare(readEditable(el)) === normalizeForCompare(text);
}

function insertLines(el: HTMLElement, value: string): boolean {
	if (!selectContents(el)) return false;
	exec("delete");
	const lines = value.split("\n");
	lines.forEach((line, i) => {
		if (line) exec("insertText", line);
		// <br> line breaks round-trip exactly; paragraphs (<div>) can add blank lines.
		if (i < lines.length - 1 && !exec("insertLineBreak"))
			exec("insertParagraph");
	});
	return true;
}

/**
 * Replaces the text of a Studio contenteditable so Studio registers the
 * edit (Save becomes enabled). Tries, in order: one `insertText`, line by
 * line with `insertLineBreak`, then `innerText` + synthetic input events.
 * Each attempt is verified by reading the field back: an exact match
 * (line breaks included) wins; otherwise the attempt that kept every line
 * in order is accepted.
 */
export async function writeEditable(
	el: HTMLElement,
	text: string,
): Promise<WriteResult> {
	const previous = readEditable(el);
	const value = text.replace(/\r\n?/g, "\n");
	const multiline = value.includes("\n");

	// 1. Whole text at once (plaintext-only editors keep "\n" as-is).
	const focused = selectContents(el);
	const inserted =
		focused && (value ? exec("insertText", value) : exec("delete"));
	await tick(30);
	if (inserted && exact(el, value)) {
		fireChange(el);
		return { ok: true, method: "insertText", previous };
	}
	const firstKeptLines = inserted && matches(el, value);

	// 2. Line by line with <br> breaks (rich editors turn "\n" into <div>s).
	if (multiline && focused && insertLines(el, value)) {
		await tick(30);
		if (matches(el, value)) {
			fireChange(el);
			return { ok: true, method: "lines", previous };
		}
	}
	if (firstKeptLines && !multiline) {
		fireChange(el);
		return { ok: true, method: "insertText", previous };
	}

	// 3. Direct DOM write + synthetic events.
	try {
		el.focus();
		// biome-ignore lint/performance/useDomNodeTextContent: innerText turns line breaks into <br>
		el.innerText = value;
		fireInput(el, value);
		fireChange(el);
	} catch {
		// fall through to verification
	}
	await tick(30);
	return { ok: matches(el, value), method: "innerText", previous };
}

function setInputValue(input: HTMLInputElement, value: string): void {
	input.focus();
	// execCommand edits the focused element: only use it when that's the input.
	if (hasFocus(input)) {
		input.select();
		if (
			(value ? exec("insertText", value) : exec("delete")) &&
			input.value === value
		)
			return;
	}
	// Native setter so frameworks that track `value` notice the change.
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	if (setter) setter.call(input, value);
	else input.value = value;
	input.dispatchEvent(
		new InputEvent("input", {
			bubbles: true,
			composed: true,
			inputType: "insertText",
			data: value,
		}),
	);
}

function pressEnter(input: HTMLInputElement): void {
	const init: KeyboardEventInit & { keyCode: number; which: number } = {
		key: "Enter",
		code: "Enter",
		keyCode: 13,
		which: 13,
		bubbles: true,
		cancelable: true,
		composed: true,
	};
	input.dispatchEvent(new KeyboardEvent("keydown", init));
	input.dispatchEvent(new KeyboardEvent("keypress", init));
	input.dispatchEvent(new KeyboardEvent("keyup", init));
}

const lower = (s: string) => s.trim().toLowerCase();

export type AddTagsResult = {
	added: string[];
	/** Already present */
	skipped: string[];
	failed: string[];
	/** No tags input found at all */
	noField: boolean;
};

/**
 * Adds tags as chips by typing into Studio's tag input and pressing Enter
 * (falls back to a trailing comma, which Studio also splits on). Verifies
 * each chip appears.
 */
export async function addTags(
	fields: StudioFields,
	tags: string[],
): Promise<AddTagsResult> {
	const result: AddTagsResult = {
		added: [],
		skipped: [],
		failed: [],
		noField: false,
	};
	const input = fields.tagInput();
	if (!input) {
		result.noField = true;
		result.failed = [...tags];
		return result;
	}
	const has = (tag: string) =>
		(fields.readTags() ?? []).some((t) => lower(t) === lower(tag));

	for (const raw of tags) {
		const tag = raw.replace(/[,<>]/g, " ").replace(/\s+/g, " ").trim();
		if (!tag) continue;
		if (has(tag)) {
			result.skipped.push(tag);
			continue;
		}
		const field = fields.tagInput() ?? input;
		setInputValue(field, tag);
		pressEnter(field);
		await tick(80);
		if (!has(tag)) {
			setInputValue(field, `${tag},`);
			await tick(80);
		}
		if (!has(tag)) {
			field.dispatchEvent(
				new Event("change", { bubbles: true, composed: true }),
			);
			await tick(80);
		}
		if (has(tag)) {
			result.added.push(tag);
		} else {
			result.failed.push(tag);
			if (field.value) setInputValue(field, "");
		}
	}
	return result;
}

/** Removes every tag chip ("Remove all" button, else each chip's delete icon). */
export async function removeAllTags(fields: StudioFields): Promise<boolean> {
	const container = fields.tagsContainer();
	if (!container) return false;
	if (!fields.chips().length) return true;
	const clear = queryFirst(container, SELECTORS.tagsClearAll, {
		preferVisible: true,
	});
	if (clear) {
		clear.click();
		await tick(120);
		if (!fields.chips().length) return true;
	}
	// Click delete icons one by one (re-query: Studio re-renders the list).
	for (let guard = 0; guard < 600 && fields.chips().length; guard++) {
		const chip = fields.chips()[0];
		const del = chip ? queryFirst(chip, SELECTORS.chipDelete) : null;
		if (!del) break;
		const before = fields.chips().length;
		del.click();
		await tick(40);
		if (fields.chips().length >= before) break;
	}
	return fields.chips().length === 0;
}

// ---------------------------------------------------------------------------
// Docking anchors
// ---------------------------------------------------------------------------

export type DockSpot = { el: Element; how: "after" | "append" | "before" };

/** Right column (below the video preview card), if Studio shows one. */
export function findDockSpot(target: StudioTarget): DockSpot | null {
	const root = target.dialog ?? document;
	const exclude = target.dialog
		? null
		: queryFirst(document, SELECTORS.uploadDialog);
	const after = queryFirst(root, SELECTORS.dockAfter, {
		preferVisible: true,
		exclude,
		filter: isVisible,
	});
	if (after?.parentElement) return { el: after, how: "after" };
	const into = queryFirst(root, SELECTORS.dockInto, {
		preferVisible: true,
		exclude,
		filter: isVisible,
	});
	return into ? { el: into, how: "append" } : null;
}

/** Inline fallback inside the upload dialog: right above the details form. */
export function findInlineSpot(target: StudioTarget): DockSpot | null {
	const root = target.dialog ?? document;
	const editor = queryFirst(root, SELECTORS.metadataEditor, {
		preferVisible: true,
		filter: isVisible,
	});
	if (editor?.parentElement) return { el: editor, how: "before" };
	const fields = new StudioFields(target);
	const title = fields.title();
	// Climb to a block-level ancestor of the title field.
	let block: Element | null | undefined = title?.parentElement;
	for (let i = 0; block && i < 4; i++) block = block.parentElement;
	return block?.parentElement ? { el: block, how: "before" } : null;
}

/** Width of the column a dock spot lives in. */
export function dockWidth(spot: DockSpot): number {
	const el = spot.how === "append" ? spot.el : spot.el.parentElement;
	return el?.getBoundingClientRect().width ?? 0;
}
