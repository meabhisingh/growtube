/**
 * Deep-walk helpers for InnerTube JSON.
 *
 * YouTube ships the same data in several renderer variants (videoRenderer,
 * lockupViewModel, shortsLockupViewModel, reelItemRenderer…) nested at
 * unpredictable depths, and the nesting changes often. Instead of hard-coding
 * paths we search the tree for the keys we understand, in document order.
 */

// biome-ignore lint/suspicious/noExplicitAny: InnerTube JSON is untyped by nature
export type AnyObj = Record<string, any>;

export function isObj(value: unknown): value is AnyObj {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_DEPTH = 64;

/**
 * Collects every value stored under one of `keys`, in document (DFS) order.
 * Does not descend into a match (renderers rarely nest themselves), unless
 * `descendIntoMatches` is set.
 */
export function findAll<T = AnyObj>(
	root: unknown,
	keys: string | readonly string[],
	opts: { limit?: number; descendIntoMatches?: boolean } = {},
): T[] {
	const wanted = new Set(typeof keys === "string" ? [keys] : keys);
	const out: T[] = [];
	const limit = opts.limit ?? Number.POSITIVE_INFINITY;
	const visit = (node: unknown, depth: number): void => {
		if (out.length >= limit || depth > MAX_DEPTH || node === null) return;
		if (Array.isArray(node)) {
			for (const item of node) {
				visit(item, depth + 1);
				if (out.length >= limit) return;
			}
			return;
		}
		if (typeof node !== "object") return;
		for (const [k, v] of Object.entries(node as AnyObj)) {
			if (wanted.has(k)) {
				out.push(v as T);
				if (out.length >= limit) return;
				if (!opts.descendIntoMatches) continue;
			}
			visit(v, depth + 1);
		}
	};
	visit(root, 0);
	return out;
}

/** Like findAll but returns `{ key, value }` so callers can switch on the variant. */
export function findAllEntries(
	root: unknown,
	keys: readonly string[],
	opts: { limit?: number } = {},
): { key: string; value: AnyObj }[] {
	const wanted = new Set(keys);
	const out: { key: string; value: AnyObj }[] = [];
	const limit = opts.limit ?? Number.POSITIVE_INFINITY;
	const visit = (node: unknown, depth: number): void => {
		if (out.length >= limit || depth > MAX_DEPTH || node === null) return;
		if (Array.isArray(node)) {
			for (const item of node) {
				visit(item, depth + 1);
				if (out.length >= limit) return;
			}
			return;
		}
		if (typeof node !== "object") return;
		for (const [k, v] of Object.entries(node as AnyObj)) {
			if (wanted.has(k) && isObj(v)) {
				out.push({ key: k, value: v });
				if (out.length >= limit) return;
				continue;
			}
			visit(v, depth + 1);
		}
	};
	visit(root, 0);
	return out;
}

export function findFirst<T = AnyObj>(
	root: unknown,
	keys: string | readonly string[],
): T | undefined {
	return findAll<T>(root, keys, { limit: 1 })[0];
}

/** Safe nested getter: get(obj, "a", 0, "b") */
export function get<T = unknown>(
	root: unknown,
	...path: (string | number)[]
): T | undefined {
	let cur: unknown = root;
	for (const key of path) {
		if (cur === null || typeof cur !== "object") return undefined;
		cur = (cur as AnyObj)[key as string];
	}
	return cur as T | undefined;
}

/**
 * Extracts display text from any of YouTube's text shapes:
 * `"str"`, `{ simpleText }`, `{ runs: [{ text }] }`, `{ content }`.
 */
export function textOf(node: unknown): string | null {
	if (node == null) return null;
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (!isObj(node)) return null;
	if (typeof node.simpleText === "string") return node.simpleText;
	if (typeof node.content === "string") return node.content;
	if (typeof node.text === "string") return node.text;
	if (Array.isArray(node.runs)) {
		return node.runs
			.map((r: AnyObj) => (typeof r?.text === "string" ? r.text : ""))
			.join("");
	}
	if (isObj(node.text)) return textOf(node.text);
	return null;
}

/** Accessibility label of a text node, used as an unabbreviated fallback. */
export function a11yOf(node: unknown): string | null {
	if (!isObj(node)) return null;
	const label =
		get<string>(node, "accessibility", "accessibilityData", "label") ??
		get<string>(node, "accessibilityLabel");
	return typeof label === "string" ? label : null;
}

/** Highest-resolution URL from `{ thumbnails: [...] }` or `{ sources: [...] }`. */
export function bestImage(node: unknown): string | null {
	const list =
		(get<AnyObj[]>(node, "thumbnails") ?? get<AnyObj[]>(node, "sources")) || [];
	let best: { url: string; area: number } | null = null;
	for (const t of list) {
		if (typeof t?.url !== "string") continue;
		const area = (Number(t.width) || 0) * (Number(t.height) || 0);
		if (!best || area >= best.area) best = { url: t.url, area };
	}
	if (!best) return null;
	return best.url.startsWith("//") ? `https:${best.url}` : best.url;
}

/**
 * Every continuation token under continuationItemRenderer, in order.
 * Only looks at the result list (`contents` / `onResponseReceived*`), never
 * at `header`, where e.g. the channel About panel keeps its own token.
 */
export function findContinuationTokens(root: unknown): string[] {
	const scopes = isObj(root)
		? [
				root.contents,
				root.onResponseReceivedActions,
				root.onResponseReceivedCommands,
				root.onResponseReceivedEndpoints,
				root.continuationContents,
			].filter((s) => s != null)
		: [root];
	return findAll<AnyObj>(
		scopes.length ? scopes : root,
		"continuationItemRenderer",
	)
		.map(
			(c) =>
				get<string>(
					c,
					"continuationEndpoint",
					"continuationCommand",
					"token",
				) ??
				get<string>(
					c,
					"button",
					"buttonRenderer",
					"command",
					"continuationCommand",
					"token",
				),
		)
		.filter((t): t is string => typeof t === "string" && t.length > 0);
}
