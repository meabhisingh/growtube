/**
 * Prompt builders for the structured generators (zod-validated output), plus
 * re-exports of the coach prompt helpers in `./coach`.
 *
 * Pure (no network, no extension APIs): safe to import from any context, but
 * prefer `./coach` in content scripts (it doesn't pull in zod).
 * Run generators through `ai.generate(kind, input)` in `@/lib/client`, which
 * executes them in the background with JSON validation + one repair retry.
 */
import { formatCompact, formatOutlier } from "@growtube/shared/format";
import { z } from "zod";

import { formatTimestamp, validateChapters } from "./chapters";
import { clipText as clip, fitTagsTo500, renderContext } from "./coach";
import type { ChatMessage, CoachContext } from "./types";

export * from "./coach";

// ---------------------------------------------------------------------------
// Generators (structured output)
// ---------------------------------------------------------------------------

type GeneratorDef<I, S extends z.ZodType> = {
	schema: S;
	build: (input: I) => ChatMessage[];
	temperature?: number;
	postProcess?: (output: z.infer<S>, input: I) => z.infer<S>;
};

function defineGenerator<I, S extends z.ZodType>(
	def: GeneratorDef<I, S>,
): GeneratorDef<I, S> {
	return def;
}

const SYSTEM_EXPERT =
	"You are an expert YouTube strategist and copywriter. You write for real creators: specific, natural, never clickbait that the video can't pay off. Match the language of the provided content unless told otherwise.";

/** "1:23" / "01:02:03" / 83 -> seconds */
export function toSeconds(value: unknown): number {
	if (typeof value === "number") return Math.max(0, value);
	if (typeof value !== "string") return 0;
	const parts = value.trim().split(":").map(Number);
	if (parts.some((p) => !Number.isFinite(p)))
		return Number.parseFloat(value) || 0;
	return parts.reduce((acc, p) => acc * 60 + p, 0);
}

const seconds = z.union([z.number(), z.string()]).transform(toSeconds);

/** 0–100, rounded and clamped (models sometimes answer 105 or -3). */
const score100 = z.coerce
	.number()
	.transform((n) => Math.round(Math.min(100, Math.max(0, n))));

type VideoInput = CoachContext["video"];
type ChannelInput = CoachContext["channel"];

export const GENERATORS = {
	titleIdeas: defineGenerator({
		schema: z.object({
			titles: z
				.array(
					z.object({
						title: z.string().min(1),
						angle: z
							.string()
							.describe(
								"The packaging angle, e.g. curiosity, listicle, challenge",
							),
						why: z
							.string()
							.describe("One sentence on why it should earn clicks"),
					}),
				)
				.min(1),
		}),
		temperature: 0.9,
		build: (input: {
			topic?: string;
			video?: VideoInput;
			keywords?: string[];
			count?: number;
			style?: string;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Write ${input.count ?? 10} YouTube title ideas.`,
					input.topic ? `Topic: ${input.topic}` : "",
					input.keywords?.length
						? `Target keywords (use the main one naturally, near the start): ${input.keywords.join(", ")}`
						: "",
					input.style ? `Style: ${input.style}` : "",
					input.video ? renderContext({ video: input.video }) : "",
					"Rules: under 70 characters (hard max 100), no ALL CAPS sentences, no emoji spam, vary the angles, front-load the hook.",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out) => ({
			titles: out.titles.map((t) => ({
				...t,
				title: t.title.replace(/^["']|["']$/g, "").slice(0, 100),
			})),
		}),
	}),

	descriptionDraft: defineGenerator({
		schema: z.object({
			description: z.string().min(1),
			hashtags: z.array(z.string()).default([]),
			chapters: z
				.array(z.object({ time: z.string(), title: z.string() }))
				.default([]),
		}),
		temperature: 0.6,
		build: (input: {
			title: string;
			keywords?: string[];
			transcriptExcerpt?: string;
			channel?: ChannelInput;
			links?: string[];
			includeChapters?: boolean;
			currentDescription?: string;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Write an SEO-friendly YouTube description for the video "${input.title}".`,
					input.keywords?.length
						? `Keywords to include naturally (main keyword in the first sentence): ${input.keywords.join(", ")}`
						: "",
					input.currentDescription
						? `Current description (improve it, keep important links):\n${clip(input.currentDescription, 3_000)}`
						: "",
					input.links?.length
						? `Links to include: ${input.links.join(" ")}`
						: "",
					input.channel ? renderContext({ channel: input.channel }) : "",
					input.transcriptExcerpt
						? `Transcript (timestamped):\n${clip(input.transcriptExcerpt, 10_000)}`
						: "",
					"Structure: a 2–3 sentence hook paragraph (shown above the fold), a short summary of what viewers will learn, then links/CTA. 150–300 words. No keyword stuffing.",
					input.includeChapters && input.transcriptExcerpt
						? 'Also return chapters from the transcript ("0:00" first, at least 3, each at least 10 seconds apart).'
						: "Return an empty chapters array.",
					"Return 3–5 relevant hashtags (with #).",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out) => ({
			...out,
			hashtags: out.hashtags
				.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""))
				.slice(0, 15),
		}),
	}),

	tagSet: defineGenerator({
		schema: z.object({ tags: z.array(z.string()).min(1) }),
		temperature: 0.5,
		build: (input: {
			title: string;
			description?: string;
			keywords?: string[];
			existingTags?: string[];
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Suggest YouTube tags for the video "${input.title}".`,
					input.description
						? `Description:\n${clip(input.description, 1_500)}`
						: "",
					input.keywords?.length
						? `Keywords with real search demand: ${input.keywords.join(", ")}`
						: "",
					input.existingTags?.length
						? `Current tags: ${input.existingTags.join(", ")}`
						: "",
					"Order: the exact main keyword first, then close variations, then broader topic tags, then 1–2 channel/brand tags. 15–30 tags, lowercase, no hashtags, no duplicates. The whole list must fit YouTube's 500-character tag limit.",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out) => ({
			tags: fitTagsTo500(out.tags.map((t) => t.replace(/^#/, ""))),
		}),
	}),

	thumbnailConcepts: defineGenerator({
		schema: z.object({
			concepts: z
				.array(
					z.object({
						headline: z
							.string()
							.describe("Text overlay, at most 4 words (may be empty)"),
						visual: z.string().describe("The main subject and what it's doing"),
						composition: z.string(),
						colors: z.array(z.string()).default([]),
						emotion: z.string(),
						imagePrompt: z
							.string()
							.describe("A detailed prompt for an image model, 16:9, no text"),
					}),
				)
				.min(1),
		}),
		temperature: 0.9,
		build: (input: {
			title: string;
			topic?: string;
			video?: VideoInput;
			count?: number;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Design ${input.count ?? 3} distinct YouTube thumbnail concepts for "${input.title}".`,
					input.topic ? `Topic: ${input.topic}` : "",
					input.video ? renderContext({ video: input.video }) : "",
					"Each concept should complement (not repeat) the title, read clearly at small sizes, have one focal point and strong contrast. The imagePrompt must describe a 16:9 image without any text (text is added later).",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
	}),

	dailyIdeas: defineGenerator({
		schema: z.object({
			ideas: z
				.array(
					z.object({
						title: z.string(),
						hook: z.string().describe("Opening line for the first 10 seconds"),
						why: z
							.string()
							.describe("Why this should work for this channel now"),
						format: z.enum(["long", "short"]),
						keywords: z.array(z.string()).default([]),
					}),
				)
				.min(1),
		}),
		temperature: 1,
		build: (input: {
			channel?: ChannelInput;
			recentVideos?: CoachContext["recentVideos"];
			niche?: string;
			count?: number;
			trending?: { title: string; views?: number | null }[];
			date?: string;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Give me ${input.count ?? 5} fresh video ideas for today${input.date ? ` (${input.date})` : ""}.`,
					input.niche ? `Niche: ${input.niche}` : "",
					renderContext({
						channel: input.channel,
						recentVideos: input.recentVideos,
					}),
					input.trending?.length
						? `Currently trending in this space:\n${input.trending
								.slice(0, 15)
								.map(
									(t) =>
										`- ${t.title}${t.views != null ? ` (${formatCompact(t.views)} views)` : ""}`,
								)
								.join("\n")}`
						: "",
					"Lean on what already outperforms on this channel, avoid repeating recent uploads, mix long-form and Shorts.",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
	}),

	clipFinder: defineGenerator({
		schema: z.object({
			clips: z.array(
				z.object({
					start: seconds,
					end: seconds,
					title: z.string(),
					hook: z.string().describe("The first line viewers hear/see"),
					reason: z
						.string()
						.describe("Why this moment works as a standalone Short"),
					score: z.coerce.number().min(0).max(100),
				}),
			),
		}),
		temperature: 0.4,
		build: (input: {
			transcript: string;
			videoTitle?: string;
			maxClips?: number;
			minSec?: number;
			maxSec?: number;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Find up to ${input.maxClips ?? 5} moments in this video that would make great standalone Shorts/clips.`,
					input.videoTitle ? `Video: ${input.videoTitle}` : "",
					`Each clip: ${input.minSec ?? 15}–${input.maxSec ?? 60} seconds, starts on a strong hook, has a self-contained payoff. Use the transcript timestamps; start and end are in seconds from the start of the video. Score 0–100 for viral potential; sort best first.`,
					`Transcript ("m:ss text" lines):\n${clip(input.transcript, 30_000)}`,
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out, input) => ({
			clips: out.clips
				.filter((c) => c.end > c.start)
				.map((c) => {
					const max = input.maxSec ?? 90;
					return {
						...c,
						end: Math.min(c.end, c.start + max),
						score: Math.round(c.score),
					};
				})
				.sort((a, b) => b.score - a.score)
				.slice(0, input.maxClips ?? 5),
		}),
	}),

	keywordInsights: defineGenerator({
		schema: z.object({
			summary: z.string(),
			searchIntent: z.string(),
			competition: z.enum(["low", "medium", "high"]),
			opportunityScore: z.coerce.number().min(0).max(100),
			relatedKeywords: z.array(z.string()).default([]),
			titleAngles: z.array(z.string()).default([]),
			contentGaps: z.array(z.string()).default([]),
		}),
		temperature: 0.4,
		build: (input: {
			keyword: string;
			suggestions?: string[];
			topResults?: {
				title: string;
				views?: number | null;
				channelTitle?: string | null;
				publishedText?: string | null;
			}[];
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Analyze the YouTube search keyword "${input.keyword}".`,
					input.suggestions?.length
						? `YouTube autocomplete suggestions: ${input.suggestions.join(" | ")}`
						: "",
					input.topResults?.length
						? `Current top results:\n${input.topResults
								.slice(0, 20)
								.map(
									(r, i) =>
										`${i + 1}. ${clip(r.title, 100)} — ${r.channelTitle ?? "?"}, ${r.views != null ? `${formatCompact(r.views)} views` : "? views"}${r.publishedText ? `, ${r.publishedText}` : ""}`,
								)
								.join("\n")}`
						: "",
					"Judge competition from how established/old/high-view the top results are; opportunity is high when demand exists but top results are weak, old or off-intent. Give 8–15 related keywords worth targeting, 5 title angles and 3–5 content gaps.",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out) => ({
			...out,
			opportunityScore: Math.round(out.opportunityScore),
		}),
	}),

	channelAudit: defineGenerator({
		schema: z.object({
			summary: z.string(),
			score: z.coerce.number().min(0).max(100),
			strengths: z.array(z.string()),
			weaknesses: z.array(z.string()),
			actions: z.array(
				z.object({
					title: z.string(),
					detail: z.string(),
					impact: z.enum(["high", "medium", "low"]),
				}),
			),
			contentPillars: z.array(z.string()).default([]),
		}),
		temperature: 0.4,
		build: (input: {
			channel: ChannelInput;
			recentVideos?: CoachContext["recentVideos"];
			bestSlots?: { weekday: number; hour: number; avgOutlier: number }[];
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					"Audit this YouTube channel.",
					renderContext({
						channel: input.channel,
						recentVideos: input.recentVideos,
					}),
					input.bestSlots?.length
						? `Best posting slots from its own history (weekday 0=Sun, local hour, avg outlier): ${input.bestSlots
								.map(
									(s) =>
										`${s.weekday}@${s.hour}h ${formatOutlier(s.avgOutlier)}`,
								)
								.join(", ")}`
						: "",
					"Score 0–100 for growth readiness. Strengths/weaknesses must cite the data (e.g. which uploads outperform). Give 5–8 prioritized actions and the 3–5 content pillars that work best.",
				]
					.filter(Boolean)
					.join("\n"),
			},
		],
		postProcess: (out) => ({ ...out, score: Math.round(out.score) }),
	}),

	// --- Script tool (hook score, outline, chapters & description) ---------

	hookScore: defineGenerator({
		schema: z.object({
			score: score100.describe("Overall hook strength 0-100"),
			subscores: z.object({
				curiosity: score100.describe(
					"Opens a question the viewer needs answered",
				),
				clarity: score100.describe("Instantly clear what the video is about"),
				payoff: score100.describe("Promises a concrete, believable payoff"),
				pacing: score100.describe("No wasted words, gets to the point fast"),
				titleMatch: score100
					.nullable()
					.describe("Delivers on the title's promise; null when no title"),
			}),
			verdict: z.string().describe("One or two sentences, the overall read"),
			works: z.array(z.string()).default([]),
			fixes: z.array(z.string()).default([]),
			rewrites: z
				.array(
					z.object({
						style: z
							.string()
							.describe(
								"Short label, e.g. Cold open, Bold claim, Question, Story, Stakes",
							),
						opening: z
							.string()
							.describe(
								"The rewritten first 15-30 seconds, ready to read aloud",
							),
						why: z.string().describe("One sentence on why it's stronger"),
					}),
				)
				.default([]),
		}),
		temperature: 0.6,
		build: (input: {
			script: string;
			title?: string;
			referenceHook?: string;
			referenceTitle?: string;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					"Score the hook (the first 30-60 seconds) of this YouTube video script. Be honest and specific: quote the exact words that work or hurt.",
					input.title
						? `Planned title: ${clip(input.title, 200)}`
						: "No title given: set subscores.titleMatch to null.",
					input.referenceHook
						? `For reference, the opening of a video the creator admires${input.referenceTitle ? ` ("${clip(input.referenceTitle, 150)}")` : ""}. Learn from its techniques, don't copy its content:\n${clip(input.referenceHook, 2_000)}`
						: "",
					`Script (the opening matters most):\n${clip(input.script, 6_000)}`,
					"Scores 0-100 (50 = an average YouTube hook, 80+ = top creators). 2-5 items each for works and fixes. Then exactly 3 rewritten openings in clearly different styles, keeping the creator's topic, facts and voice; no clickbait the video can't pay off.",
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
		postProcess: (out, input) => ({
			...out,
			subscores: {
				...out.subscores,
				titleMatch: input.title?.trim() ? out.subscores.titleMatch : null,
			},
			works: out.works.filter((s) => s.trim()).slice(0, 6),
			fixes: out.fixes.filter((s) => s.trim()).slice(0, 6),
			rewrites: out.rewrites.filter((r) => r.opening.trim()).slice(0, 3),
		}),
	}),

	scriptOutline: defineGenerator({
		schema: z.object({
			workingTitle: z.string(),
			hook: z.string().describe("The opening lines, word for word"),
			introPromise: z
				.string()
				.describe("What the viewer gets by watching to the end"),
			sections: z
				.array(
					z.object({
						title: z.string(),
						minutes: z.coerce.number().nullable().default(null),
						beats: z.array(z.string()).default([]),
						retention: z
							.array(
								z.object({
									type: z
										.string()
										.describe(
											"e.g. Open loop, Pattern interrupt, Payoff, Re-hook, B-roll",
										),
									detail: z.string(),
								}),
							)
							.default([]),
					}),
				)
				.min(1),
			ctas: z
				.array(
					z.object({
						placement: z
							.string()
							.describe('Where, e.g. "After section 2 (~4:30)"'),
						text: z.string(),
					}),
				)
				.default([]),
			chapterTitles: z.array(z.string()).default([]),
			outro: z.string().default(""),
		}),
		temperature: 0.7,
		build: (input: {
			topic: string;
			targetMinutes?: number;
			audience?: string;
			referenceHook?: string;
			referenceTitle?: string;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Write a retention-focused outline for a YouTube video about: ${clip(input.topic, 500)}`,
					input.targetMinutes
						? `Target length: about ${input.targetMinutes} minutes (section minutes should add up to it).`
						: "",
					input.audience ? `Audience: ${clip(input.audience, 300)}` : "",
					input.referenceHook
						? `Opening of a video the creator admires${input.referenceTitle ? ` ("${clip(input.referenceTitle, 150)}")` : ""}, for style only:\n${clip(input.referenceHook, 2_000)}`
						: "",
					"Include: a word-for-word hook (under 30 seconds spoken), the intro promise, 3-8 sections with concrete beats and retention devices (open loops that pay off later, pattern interrupts, re-hooks before likely drop-off points), where to place CTAs (subscribe / related video / link; never in the first 30 seconds), an outro that points to the next video, and YouTube chapter titles (short, keyword-friendly, one per section plus an intro).",
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
	}),

	videoChapters: defineGenerator({
		schema: z.object({
			chapters: z
				.array(
					z.object({
						time: z
							.union([z.string(), z.number()])
							.transform(String)
							.describe('"m:ss" or "h:mm:ss"'),
						title: z.string(),
					}),
				)
				.default([]),
			description: z.string(),
			hashtags: z.array(z.string()).default([]),
			pinnedComment: z.string(),
		}),
		temperature: 0.5,
		build: (input: {
			/** "m:ss text" lines (see compactTranscript in ./chapters) */
			transcript: string;
			durationSec?: number | null;
			title?: string;
			keywords?: string[];
			currentDescription?: string;
			/** Lines were shortened to fit the budget */
			truncated?: boolean;
		}) => [
			{ role: "system", content: SYSTEM_EXPERT },
			{
				role: "user",
				content: [
					`Create YouTube chapters, an SEO description and a pinned comment for${input.title ? ` the video "${clip(input.title, 200)}"` : " this video"}.`,
					input.durationSec
						? `Video length: ${formatTimestamp(input.durationSec)} (no timestamp may be at or after it).`
						: "",
					input.keywords?.length
						? `Keywords (use the main one naturally in the first sentence): ${input.keywords.slice(0, 15).join(", ")}`
						: "",
					input.currentDescription
						? `Current description (keep its important links and credits):\n${clip(input.currentDescription, 2_500)}`
						: "",
					'Chapters: the first must be "0:00", at least 3 (usually 5-12 for a long video), each at least 10 seconds after the previous one, placed where the topic actually changes in the transcript. Titles under 50 characters, descriptive and searchable (not "Part 2").',
					"Description: the first 2 lines show above the fold and in search, so they must hook and contain the main keyword. Then a short summary of what viewers learn, then links/CTA. 120-300 words. Do NOT put the chapter list in the description (it is added separately). No keyword stuffing.",
					'Hashtags: 3-5 relevant ones (with #). Pinned comment: 1-3 short sentences that invite replies (a specific question) or point to a resource; no generic "like and subscribe".',
					`Transcript ("m:ss text" lines${input.truncated ? "; long lines were shortened to fit, timestamps are exact" : ""}):\n${clip(input.transcript, 30_000)}`,
				]
					.filter(Boolean)
					.join("\n\n"),
			},
		],
		postProcess: (out, input) => ({
			...out,
			// Never trust model timestamps: fixed, or all dropped if they can't be valid.
			chapters: validateChapters(out.chapters, input.durationSec).chapters,
			description: out.description.trim(),
			pinnedComment: out.pinnedComment.trim(),
			hashtags: out.hashtags
				.map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, ""))
				.filter((h) => h.length > 1)
				.slice(0, 8),
		}),
	}),
} as const;

export type GeneratorKind = keyof typeof GENERATORS;
export type GeneratorInput<K extends GeneratorKind> = Parameters<
	(typeof GENERATORS)[K]["build"]
>[0];
export type GeneratorOutput<K extends GeneratorKind> = z.infer<
	(typeof GENERATORS)[K]["schema"]
>;

export function isGeneratorKind(kind: string): kind is GeneratorKind {
	return Object.hasOwn(GENERATORS, kind);
}
