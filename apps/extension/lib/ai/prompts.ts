/**
 * Prompt builders for the structured generators (zod-validated output), plus
 * re-exports of the coach prompt helpers in `./coach`.
 *
 * Pure (no network, no extension APIs): safe to import from any context, but
 * prefer `./coach` in content scripts (it doesn't pull in zod).
 * Run generators through `ai.generate(kind, input)` in `@/lib/client`, which
 * executes them in the background with JSON validation + one repair retry.
 */
import { formatCompact, formatOutlier } from "@open-vidiq/shared/format";
import { z } from "zod";

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
