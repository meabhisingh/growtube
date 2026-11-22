/** YouTube search autocomplete (the suggestions shown under the search box). */
import { cached, TTL } from "../cache";
import { loadInnertubeConfig, ytFetch } from "./innertube";

export const SUGGEST_ORIGIN = "https://suggestqueries-clients6.youtube.com";

/** Parses `window.google.ac.h([query, [[suggestion, 0, [...]], ...], {...}])`. */
export function parseSuggestionsJsonp(body: string): string[] {
	const start = body.indexOf("(");
	const end = body.lastIndexOf(")");
	const json = start >= 0 && end > start ? body.slice(start + 1, end) : body;
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(data) || !Array.isArray(data[1])) return [];
	const out: string[] = [];
	for (const item of data[1] as unknown[]) {
		const s = Array.isArray(item) ? item[0] : item;
		if (typeof s === "string" && s.trim() && !out.includes(s)) out.push(s);
	}
	return out;
}

/**
 * Autocomplete suggestions for a partial query, as YouTube ranks them
 * (a strong signal of real search demand). Cached 1 day.
 */
export async function getSearchSuggestions(
	query: string,
	opts: { hl?: string; gl?: string; signal?: AbortSignal } = {},
): Promise<string[]> {
	const q = query.trim();
	if (!q) return [];
	const hl = opts.hl ?? "en";
	// Default to the region of the user's youtube.com pages.
	const gl = (
		opts.gl ??
		((await loadInnertubeConfig()).gl || "us")
	).toLowerCase();
	return cached(
		`suggest:${hl}:${gl}:${q.toLowerCase()}`,
		TTL.suggestions,
		async () => {
			const url = new URL(`${SUGGEST_ORIGIN}/complete/search`);
			url.searchParams.set("client", "youtube");
			url.searchParams.set("ds", "yt");
			url.searchParams.set("oe", "utf-8");
			url.searchParams.set("hl", hl);
			url.searchParams.set("gl", gl);
			url.searchParams.set("q", q);
			const res = await ytFetch(url.toString(), { signal: opts.signal });
			const charset =
				/charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1] ??
				"utf-8";
			let body: string;
			try {
				body = new TextDecoder(charset).decode(await res.arrayBuffer());
			} catch {
				body = await res.text();
			}
			return parseSuggestionsJsonp(body);
		},
	);
}
