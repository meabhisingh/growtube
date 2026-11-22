/**
 * AI coach prompt building: context rendering, the system prompt, the preset
 * questions, and YouTube tag-length helpers.
 *
 * Pure and zod-free on purpose: the YouTube content script imports this
 * module (watch panel coach + tags), and pulling `prompts.ts` (zod
 * generators) into it would add ~100 KB to every youtube.com page.
 * `prompts.ts` re-exports everything here, so either import path works.
 */
import {
	formatCompact,
	formatDuration,
	formatNumber,
	formatOutlier,
	formatPercent,
	formatRelative,
} from "@growtube/shared/format";

import type { CoachContext } from "./types";

// ---------------------------------------------------------------------------
// Context rendering
// ---------------------------------------------------------------------------

/** Truncates to `max` characters with an ellipsis ("" for empty input). */
export const clipText = (s: string | undefined | null, max: number) =>
	!s ? "" : s.length > max ? `${s.slice(0, max)}…` : s;
const clip = clipText;

const line = (label: string, value: string | number | null | undefined) =>
	value === undefined || value === null || value === ""
		? null
		: `- ${label}: ${value}`;

function dateLabel(iso: string | null | undefined): string | null {
	if (!iso) return null;
	return `${iso.slice(0, 10)} (${formatRelative(iso)})`;
}

/** Renders whatever context is known as compact markdown for the model. */
export function renderContext(ctx: CoachContext | undefined | null): string {
	if (!ctx) return "";
	const parts: string[] = [];
	const v = ctx.video;
	if (v && (v.title || v.videoId)) {
		parts.push(
			[
				"## Video in focus",
				line("Title", v.title),
				line("Channel", v.channelTitle),
				line(
					"Format",
					v.isShort == null
						? null
						: v.isShort
							? "YouTube Short"
							: "Long-form video",
				),
				line("Views", v.views != null ? formatNumber(v.views) : null),
				line("Likes", v.likes != null ? formatNumber(v.likes) : null),
				line("Comments", v.comments != null ? formatNumber(v.comments) : null),
				line("Published", dateLabel(v.publishedAt)),
				line("Duration", v.durationSec ? formatDuration(v.durationSec) : null),
				line("Category", v.category),
				line(
					"Tags",
					v.keywords?.length ? v.keywords.slice(0, 40).join(", ") : "(none)",
				),
				v.description
					? `- Description:\n${clip(v.description, 1_200).replace(/^/gm, "  > ")}`
					: null,
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	const s = ctx.stats;
	if (s) {
		const rows = [
			line(
				"Views per hour (lifetime avg)",
				s.vph != null ? formatCompact(s.vph, 1) : null,
			),
			line(
				"Views per hour (last 48h)",
				s.recentVph != null ? formatCompact(s.recentVph, 1) : null,
			),
			line(
				"Engagement rate",
				s.engagementRate != null ? formatPercent(s.engagementRate, 2) : null,
			),
			line(
				"Outlier score",
				s.outlierScore != null
					? `${formatOutlier(s.outlierScore)} the channel's typical video${s.baseline ? ` (median ${formatCompact(s.baseline)} views)` : ""}`
					: null,
			),
			line(
				"Age",
				s.ageHours != null ? `${Math.round(s.ageHours)} hours` : null,
			),
			line(
				"SEO score",
				s.seoScore != null ? `${Math.round(s.seoScore)}/100` : null,
			),
			s.tagRanks && Object.keys(s.tagRanks).length
				? `- Search rank per tag: ${Object.entries(s.tagRanks)
						.slice(0, 20)
						.map(
							([tag, rank]) =>
								`"${tag}" ${rank ? `#${rank}` : "not in top 40"}`,
						)
						.join("; ")}`
				: null,
		].filter(Boolean);
		if (rows.length) parts.push(["## Performance", ...rows].join("\n"));
	}
	const c = ctx.channel;
	if (c && (c.title || c.channelId)) {
		parts.push(
			[
				"## Channel",
				line(
					"Name",
					c.title ? `${c.title}${c.handle ? ` (${c.handle})` : ""}` : null,
				),
				line(
					"Subscribers",
					c.subscribers != null ? formatCompact(c.subscribers, 2) : null,
				),
				line(
					"Total views",
					c.totalViews != null ? formatCompact(c.totalViews, 2) : null,
				),
				line(
					"Videos",
					c.videoCount != null ? formatNumber(c.videoCount) : null,
				),
				line("Joined", c.joinedAt),
				line("Country", c.country),
				line(
					"Typical long-form views (median)",
					c.baselineLong != null ? formatCompact(c.baselineLong) : null,
				),
				line(
					"Typical Short views (median)",
					c.baselineShort != null ? formatCompact(c.baselineShort) : null,
				),
				line(
					"Uploads per week",
					c.uploadsPerWeek != null ? c.uploadsPerWeek.toFixed(1) : null,
				),
				line(
					"Channel keywords",
					c.keywords?.length ? c.keywords.slice(0, 30).join(", ") : null,
				),
				c.description
					? `- About:\n${clip(c.description, 600).replace(/^/gm, "  > ")}`
					: null,
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	if (ctx.recentVideos?.length) {
		parts.push(
			[
				"## Recent uploads (newest first)",
				...ctx.recentVideos
					.slice(0, 20)
					.map(
						(r) =>
							`- ${clip(r.title, 110)} — ${r.views != null ? `${formatCompact(r.views)} views` : "? views"}${r.publishedAt ? `, ${formatRelative(r.publishedAt)}` : ""}${r.isShort ? " [Short]" : ""}`,
					),
			].join("\n"),
		);
	}
	const m = ctx.myChannel;
	if (m?.title) {
		parts.push(
			[
				"## The user's own channel",
				line("Name", `${m.title}${m.handle ? ` (${m.handle})` : ""}`),
				line(
					"Subscribers",
					m.subscribers != null ? formatCompact(m.subscribers, 2) : null,
				),
				line("Niche", m.niche),
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	if (ctx.transcriptExcerpt) {
		parts.push(`## Transcript excerpt\n${clip(ctx.transcriptExcerpt, 12_000)}`);
	}
	if (ctx.extra) parts.push(`## Notes\n${clip(ctx.extra, 2_000)}`);
	return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Coach
// ---------------------------------------------------------------------------

/** System prompt for the streaming AI coach (side panel / watch panel chat). */
export function coachSystemPrompt(ctx?: CoachContext | null): string {
	const context = renderContext(ctx);
	return [
		"You are the GrowTube Coach: a sharp, practical YouTube growth strategist who has helped thousands of creators grow.",
		"Principles:",
		"- Be specific and actionable. Prefer concrete examples (actual title rewrites, hook scripts, thumbnail text) over generic advice.",
		"- Ground claims in the data provided below. Never invent statistics; if a number you need is missing, say what to check.",
		"- Judge performance relative to the channel's own baseline (outlier score), not absolute views.",
		"- Think in terms of what drives YouTube growth: click-through (title + thumbnail), retention (hook, pacing, payoff), session value, and audience fit.",
		"- Keep answers tight: short paragraphs, bullet lists, bold key takeaways. Use markdown headings only for long answers.",
		"- Answer in the language the user writes in.",
		context
			? `\nWhat you know right now:\n\n${context}`
			: "\nNo video or channel is in focus; ask for one if needed.",
	].join("\n");
}

export type CoachPresetId =
	| "subscribers"
	| "similar-ideas"
	| "summarize"
	| "hook"
	| "why-performance";

export type CoachPreset = {
	id: CoachPresetId;
	label: string;
	/** What context makes this preset useful */
	needs: ("video" | "channel" | "transcript")[];
};

export const COACH_PRESETS: readonly CoachPreset[] = [
	{
		id: "subscribers",
		label: "How do I get more subscribers on my channel?",
		needs: ["channel"],
	},
	{
		id: "similar-ideas",
		label: "Give me 3 similar ideas for my channel",
		needs: ["video"],
	},
	{
		id: "summarize",
		label: "Summarize this video",
		needs: ["video", "transcript"],
	},
	{ id: "hook", label: "Analyze the hook", needs: ["video", "transcript"] },
	{
		id: "why-performance",
		label: "Why did this video do well?",
		needs: ["video"],
	},
];

/** Label that matches the data ("…do well?" vs "…do poorly?"). */
export function presetLabel(
	id: CoachPresetId,
	ctx?: CoachContext | null,
): string {
	if (id === "why-performance") {
		const score = ctx?.stats?.outlierScore;
		return score != null && score < 1
			? "Why did this video do poorly?"
			: "Why did this video do well?";
	}
	return COACH_PRESETS.find((p) => p.id === id)?.label ?? id;
}

/**
 * The user message to send for a preset. The context itself goes into the
 * system prompt via coachSystemPrompt(ctx).
 */
export function buildPresetPrompt(
	id: CoachPresetId,
	ctx?: CoachContext | null,
): string {
	switch (id) {
		case "subscribers":
			return [
				"How do I get more subscribers on my channel?",
				"Based on the channel data, give me: 1) a one-paragraph diagnosis, 2) the 5 highest-leverage changes ranked by impact (with concrete examples for my niche), 3) a simple 4-week plan.",
			].join("\n");
		case "similar-ideas":
			return [
				"Give me 3 video ideas similar to the video in focus that would fit my channel.",
				"For each: a click-worthy title (under 70 characters), the thumbnail concept (text overlay of at most 4 words + visual), the hook for the first 15 seconds, and why it should work (what about the original made it perform).",
			].join("\n");
		case "summarize":
			return ctx?.transcriptExcerpt
				? "Summarize this video: a 2-sentence TL;DR, then the key points as bullets with timestamps, then who it's for."
				: "Summarize this video from its title, description and tags (no transcript is available, so say so briefly).";
		case "hook":
			return [
				"Analyze the hook (the first ~60 seconds in the transcript excerpt).",
				"Score it 1–10, explain what works and what loses viewers (curiosity gap, payoff promise, pacing, pattern interrupts, time-to-value), then write 2 improved hook scripts for the first 15 seconds.",
				ctx?.transcriptExcerpt
					? ""
					: "(No transcript is available: work from the title and description, and say so.)",
			]
				.filter(Boolean)
				.join("\n");
		case "why-performance": {
			const score = ctx?.stats?.outlierScore;
			const direction = score != null && score < 1 ? "poorly" : "well";
			return [
				`Why did this video do ${direction}?`,
				"Compare it with the channel's baseline and recent uploads. Consider topic demand, title and thumbnail packaging, timing, format/length and audience fit. Give the 3 most likely reasons (most likely first), each with evidence from the data, then what to repeat or fix in the next upload.",
			].join("\n");
		}
	}
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/**
 * Keeps tags within YouTube's 500-character limit (tags are joined with
 * commas; tags containing spaces are counted with surrounding quotes).
 */
export function fitTagsTo500(tags: string[], limit = 500): string[] {
	const out: string[] = [];
	let total = 0;
	for (const raw of tags) {
		const tag = raw.replace(/[<>,]/g, "").replace(/\s+/g, " ").trim();
		if (!tag || out.some((t) => t.toLowerCase() === tag.toLowerCase()))
			continue;
		const cost =
			tag.length + (tag.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
		if (total + cost > limit) continue;
		out.push(tag);
		total += cost;
	}
	return out;
}

export function tagsLength(tags: string[]): number {
	return tags.reduce(
		(acc, t, i) => acc + t.length + (t.includes(" ") ? 2 : 0) + (i ? 1 : 0),
		0,
	);
}
