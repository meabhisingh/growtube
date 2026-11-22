/**
 * Video SEO score (0–100) from metadata alone: title, description, tags.
 * Each check carries a weight; the score is the sum of passed weights, so the
 * checklist UI and the number always agree. Weights sum to exactly 100.
 */

export type SeoInput = {
	title: string;
	description: string;
	tags: string[];
	/** Keyword to optimize for; defaults to the first tag. */
	targetKeyword?: string | null;
	durationSec?: number | null;
	isShort?: boolean | null;
};

export type SeoCheck = {
	id: string;
	label: string;
	passed: boolean;
	weight: number;
	/** What to do when the check fails */
	hint: string;
};

export type SeoResult = {
	score: number;
	keyword: string | null;
	checks: SeoCheck[];
};

export function normalizeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^\p{L}\p{N}#\s]/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function countWords(text: string): number {
	const t = normalizeText(text);
	return t ? t.split(" ").length : 0;
}

function countOccurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	const h = ` ${normalizeText(haystack)} `;
	const n = ` ${normalizeText(needle)} `;
	let count = 0;
	let i = h.indexOf(n);
	while (i !== -1) {
		count++;
		i = h.indexOf(n, i + n.length - 1);
	}
	return count;
}

function containsPhrase(haystack: string, needle: string): boolean {
	return countOccurrences(haystack, needle) > 0;
}

/**
 * Character offset of the first whole-phrase match of `needle` in the
 * normalized `haystack` (same word-boundary rule as containsPhrase), or -1.
 */
function phrasePosition(haystack: string, needle: string): number {
	const n = normalizeText(needle);
	if (!n) return -1;
	// The match starts with the padding space, which sits right before the
	// phrase, so the index in the padded string is the phrase's offset.
	return ` ${normalizeText(haystack)} `.indexOf(` ${n} `);
}

const CHAPTER_RE = /(^|\n)\s*\(?(?:\d{1,2}:)?\d{1,2}:\d{2}\)?\s+\S/;
const HASHTAG_RE = /(^|\s)#[\p{L}\p{N}_]+/gu;
const LINK_RE = /https?:\/\/\S+/i;

export function computeSeoScore(input: SeoInput): SeoResult {
	const title = input.title ?? "";
	const description = input.description ?? "";
	const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
	const keyword =
		(input.targetKeyword?.trim() || tags[0] || "").toLowerCase() || null;
	const isShort =
		input.isShort ?? (input.durationSec != null && input.durationSec <= 180);

	const tagChars =
		tags.reduce((n, t) => n + t.length, 0) + Math.max(tags.length - 1, 0);
	const descWords = countWords(description);
	const hashtags = [...`${title} ${description}`.matchAll(HASHTAG_RE)].length;
	const titleWords = new Set(normalizeText(title).split(" "));
	const tagsInTitle = tags.filter((t) =>
		normalizeText(t)
			.split(" ")
			.every((w) => titleWords.has(w)),
	).length;

	const titleHasKeyword = !!keyword && containsPhrase(title, keyword);
	const keywordPos =
		titleHasKeyword && keyword ? phrasePosition(title, keyword) : -1;

	const checks: SeoCheck[] = [
		{
			id: "title_length",
			label: "Title is 30–70 characters",
			passed: title.length >= 30 && title.length <= 70,
			weight: 10,
			hint: `Title is ${title.length} characters. Aim for 30–70 so it isn't truncated in search.`,
		},
		{
			id: "title_keyword",
			label: "Title contains the target keyword",
			passed: titleHasKeyword,
			weight: 15,
			hint: keyword
				? `Work "${keyword}" into the title.`
				: "Add tags (the first tag is treated as the target keyword).",
		},
		{
			id: "title_keyword_front",
			label: "Keyword appears early in the title",
			// Same whole-phrase match as title_keyword, so the two never disagree.
			passed: keywordPos >= 0 && keywordPos <= 40,
			weight: 5,
			hint: "Put the keyword in the first 40 characters of the title.",
		},
		{
			id: "description_length",
			label: "Description has 150+ words",
			passed: descWords >= 150,
			weight: 10,
			hint: `Description has ${descWords} words. Longer descriptions give YouTube more context.`,
		},
		{
			id: "description_keyword_early",
			label: "Keyword in the first 150 characters of the description",
			passed: !!keyword && containsPhrase(description.slice(0, 150), keyword),
			weight: 10,
			hint: "Mention the keyword in the first line or two of the description (shown above the fold).",
		},
		{
			id: "description_keyword_repeat",
			label: "Keyword repeated 2+ times in the description",
			passed: !!keyword && countOccurrences(description, keyword) >= 2,
			weight: 5,
			hint: "Use the keyword (or close variants) at least twice in the description.",
		},
		{
			id: "tags_count",
			label: "At least 5 tags",
			passed: tags.length >= 5,
			weight: 10,
			hint: `You have ${tags.length} tag${tags.length === 1 ? "" : "s"}. Add related keywords as tags.`,
		},
		{
			id: "tags_volume",
			label: "Tags use 200–500 characters",
			passed: tagChars >= 200 && tagChars <= 500,
			weight: 5,
			hint: `Tags use ${tagChars}/500 characters. Use most of the allowance without exceeding it.`,
		},
		{
			id: "tags_keyword",
			label: "Target keyword is a tag",
			passed:
				!!keyword &&
				tags.some((t) => normalizeText(t) === normalizeText(keyword)),
			weight: 10,
			hint: "Add the exact target keyword as your first tag.",
		},
		{
			id: "tags_in_title",
			label: "2+ tags appear in the title",
			passed: tagsInTitle >= 2,
			weight: 5,
			hint: "Tags that also appear in the title reinforce relevance.",
		},
		{
			id: "chapters",
			label: isShort
				? "Chapters (not needed for Shorts)"
				: "Description has chapters/timestamps",
			passed: isShort || CHAPTER_RE.test(description),
			weight: 5,
			hint: "Add timestamps (0:00 Intro, 1:23 …) to get chapters and key moments in search.",
		},
		{
			id: "hashtags",
			label: "1–3 hashtags",
			passed: hashtags >= 1 && hashtags <= 3,
			weight: 5,
			hint:
				hashtags > 15
					? "More than 15 hashtags makes YouTube ignore all of them."
					: `You have ${hashtags} hashtags. 1–3 relevant hashtags work best.`,
		},
		{
			id: "links_cta",
			label: "Description has a link or call to action",
			passed:
				LINK_RE.test(description) || /subscribe|follow|join/i.test(description),
			weight: 5,
			hint: "Add links (socials, related videos) or a call to action like subscribing.",
		},
	];

	const score = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
	return { score, keyword, checks };
}
