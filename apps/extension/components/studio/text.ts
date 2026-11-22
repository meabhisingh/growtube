/**
 * Pure text helpers for the Studio optimizer (no DOM, no zod: safe for the
 * content-script bundle).
 */

/** Non-breaking spaces (char 160), which Studio uses in its text boxes. */
export const NBSP_RE = new RegExp(String.fromCharCode(160), "g");

/** YouTube Studio limits. */
export const LIMITS = {
	title: 100,
	/** Titles longer than this get truncated in search and suggestions */
	titleVisible: 70,
	description: 5000,
	tags: 500,
} as const;

/**
 * Characters YouTube counts for tags: tags are comma separated and tags that
 * contain spaces are counted with surrounding quotes.
 */
export function youtubeTagsLength(tags: string[]): number {
	return tags.reduce(
		(acc, t, i) => acc + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0),
		0,
	);
}

/** Keeps tags within the 500-character limit (deduped, in order). */
export function fitTags(tags: string[], limit: number = LIMITS.tags): string[] {
	const out: string[] = [];
	for (const raw of tags) {
		const tag = cleanTag(raw);
		if (!tag || out.some((t) => t.toLowerCase() === tag.toLowerCase()))
			continue;
		if (youtubeTagsLength([...out, tag]) > limit) continue;
		out.push(tag);
	}
	return out;
}

export function cleanTag(raw: string): string {
	return raw
		.replace(/^#/, "")
		.replace(/[<>,]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Comparison that ignores blank lines and whitespace runs but keeps line order. */
export function normalizeForCompare(text: string): string {
	return text
		.replace(NBSP_RE, " ")
		.split(/\r?\n/)
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter(Boolean)
		.join("\n");
}

/** Studio rejects titles/descriptions containing angle brackets. */
export function hasInvalidChars(text: string): boolean {
	return /[<>]/.test(text);
}

export function sanitizeTitle(text: string): string {
	return text
		.replace(/[\r\n]+/g, " ")
		.replace(/[<>]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, LIMITS.title);
}

export function sanitizeDescription(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.replace(/</g, "‹")
		.replace(/>/g, "›")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.slice(0, LIMITS.description);
}

const URL_RE = /\bhttps?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/gi;

/** Unique URLs in order of appearance. */
export function extractLinks(text: string): string[] {
	return [...new Set(text.match(URL_RE) ?? [])];
}

const TIMESTAMP_LINE_RE =
	/^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(\S.*)$/;

export type Chapter = { time: string; title: string };

/** Lines like "0:00 Intro", "(1:23) Setup", "01:02:03 - Outro". */
export function extractChapters(text: string): Chapter[] {
	const out: Chapter[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = TIMESTAMP_LINE_RE.exec(line);
		if (m?.[1] && m[2]) out.push({ time: m[1], title: m[2].trim() });
	}
	return out;
}

/** YouTube needs 3+ timestamps starting at 0:00 to create chapters. */
export function hasChapters(text: string): boolean {
	const chapters = extractChapters(text);
	return (
		chapters.length >= 3 && /^0?0:00$|^0:00:00$/.test(chapters[0]?.time ?? "")
	);
}

const HASHTAG_RE = /(^|\s)(#[\p{L}\p{N}_]+)/gu;

export function extractHashtags(text: string): string[] {
	return [...text.matchAll(HASHTAG_RE)].map((m) => m[2] ?? "").filter(Boolean);
}

/**
 * Final description from an AI draft, keeping what the creator already had:
 * every link they used and their timestamps (or new chapters from the
 * transcript), plus the suggested hashtags when the draft has none.
 */
export function composeDescription(
	draft: { description: string; hashtags: string[]; chapters: Chapter[] },
	current: string,
): string {
	let text = draft.description.trim();
	const lowerText = () => text.toLowerCase();

	const existingChapters = extractChapters(current);
	const draftChapters = extractChapters(text);
	if (existingChapters.length >= 2 && draftChapters.length < 2) {
		text += `\n\n${existingChapters.map((c) => `${c.time} ${c.title}`).join("\n")}`;
	} else if (draftChapters.length < 2 && draft.chapters.length >= 3) {
		text += `\n\nChapters:\n${draft.chapters.map((c) => `${c.time} ${c.title}`).join("\n")}`;
	}

	const missingLinks = extractLinks(current).filter(
		(link) => !lowerText().includes(link.toLowerCase()),
	);
	if (missingLinks.length) text += `\n\n${missingLinks.join("\n")}`;

	if (!extractHashtags(text).length && draft.hashtags.length) {
		text += `\n\n${draft.hashtags.slice(0, 3).join(" ")}`;
	}
	return sanitizeDescription(text);
}

/** "m:ss text" lines for the AI (transcripts from the background). */
export function segmentsToText(
	segments: { start: number; text: string }[],
	maxChars = 12_000,
): string {
	const fmt = (s: number) => {
		const total = Math.max(0, Math.floor(s));
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		const sec = String(total % 60).padStart(2, "0");
		return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
	};
	const lines: string[] = [];
	let size = 0;
	for (const seg of segments) {
		const line = `${fmt(seg.start)} ${seg.text}`;
		size += line.length + 1;
		if (size > maxChars) break;
		lines.push(line);
	}
	return lines.join("\n");
}

/** Where a term appears, for the controversial-keyword list. */
export function fieldsContaining(
	term: string,
	fields: { title: string; description: string; tags: string[] },
): ("title" | "description" | "tags")[] {
	const re = new RegExp(
		`(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`,
		"iu",
	);
	const out: ("title" | "description" | "tags")[] = [];
	if (re.test(fields.title)) out.push("title");
	if (re.test(fields.description)) out.push("description");
	if (fields.tags.some((t) => re.test(t))) out.push("tags");
	return out;
}
