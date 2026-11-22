/**
 * Keyword scores (0–100), computed only from public signals: YouTube
 * autocomplete and the current top search results. There's no official
 * search-volume API, so these are transparent proxies, not absolute numbers.
 *
 * VOLUME (higher = more demand)
 *   Volume = 100 × (0.45·P + 0.40·V + 0.15·R)
 *   P  prominence  = 0.7·(1 − min(rank, 9)/10) + 0.3·min(lists − 1, 4)/4
 *                    rank  = best 0-based position in any autocomplete list,
 *                    lists = how many of the expansion lists contain it;
 *                    0.25 if YouTube never suggested it.
 *   V  velocity    = min(1, log10(1 + median views/hour of the top results) / 4)
 *                    (10K views/h → 1.0, 100/h → 0.5)
 *   R  recency     = share of top results uploaded in the last 180 days
 *
 * COMPETITION (higher = harder to rank)
 *   Competition = 100 × weighted mean of
 *   Cv views       = min(1, log10(1 + median views of the top results) / 7)   weight 0.40
 *                    (10M views → 1.0, 100K → 0.71)
 *   Cc channels    = min(1, log10(1 + mean subscribers of their channels) / 7) weight 0.20
 *                    (only once ≥ 3 channel sizes are known, otherwise left out)
 *   Ct titles      = share of top results whose title contains the exact phrase  weight 0.25
 *   Ca freshness   = 1 − min(1, median age in days / 1095)                     weight 0.15
 *                    (recent top results = an actively contested topic)
 *
 * OVERALL (higher = better opportunity)
 *   Overall = 100 × √(Volume/100 × (1 − Competition/100))
 *   The geometric mean rewards keywords that have demand AND are winnable;
 *   either one at zero gives zero.
 *
 * "Top results" = the first 10 non-live results of an anonymous search.
 */
import { median } from "@open-vidiq/shared/metrics";
import { normalizeText } from "@open-vidiq/shared/seo";

import type { SearchResult } from "@/lib/youtube/types";

import { clamp, vphOf } from "../../../utils";

export const TOP_N = 10;
const DAY_MS = 86_400_000;

export type SuggestionStat = {
	keyword: string;
	/** Best 0-based position in an autocomplete list (null = never suggested) */
	bestRank: number | null;
	/** Number of expansion lists that contained it */
	lists: number;
	isSeed: boolean;
	/** Discovery order (for the default sort) */
	order: number;
};

export type KeywordMetrics = {
	volume: number;
	competition: number;
	overall: number;
	/** Inputs, shown in the detail view */
	sample: number;
	medianViews: number | null;
	medianVph: number | null;
	medianAgeDays: number | null;
	recentShare: number;
	exactTitleMatches: number;
	avgChannelSubs: number | null;
	channelsKnown: number;
	parts: {
		prominence: number;
		velocity: number;
		recency: number;
		views: number;
		channels: number | null;
		titles: number;
		freshness: number;
	};
};

export function topResults(results: SearchResult[]): SearchResult[] {
	return results.filter((r) => !r.isLive).slice(0, TOP_N);
}

export function titleHasPhrase(title: string, keyword: string): boolean {
	const k = normalizeText(keyword);
	if (!k) return false;
	return ` ${normalizeText(title)} `.includes(` ${k} `);
}

export function prominenceOf(stat: SuggestionStat): number {
	if (stat.bestRank == null) return 0.25;
	const rankScore = 1 - Math.min(stat.bestRank, 9) / 10;
	const listScore = Math.min(Math.max(stat.lists - 1, 0), 4) / 4;
	return 0.7 * rankScore + 0.3 * listScore;
}

export function scoreKeyword(
	stat: SuggestionStat,
	results: SearchResult[],
	channelSubs?: ReadonlyMap<string, number | null>,
	now = Date.now(),
): KeywordMetrics {
	const top = topResults(results);
	const views = top
		.map((r) => r.views)
		.filter((v): v is number => v != null && Number.isFinite(v));
	const vphs = top
		.map((r) => vphOf(r.views, r.publishedAt))
		.filter((v): v is number => v != null && Number.isFinite(v));
	const ages = top
		.map((r) =>
			r.publishedAt ? (now - Date.parse(r.publishedAt)) / DAY_MS : null,
		)
		.filter((d): d is number => d != null && Number.isFinite(d) && d >= 0);
	const dated = ages.length;
	const recent = ages.filter((d) => d <= 180).length;
	const exact = top.filter((r) => titleHasPhrase(r.title, stat.keyword)).length;

	const subs: number[] = [];
	if (channelSubs) {
		const seen = new Set<string>();
		for (const r of top) {
			if (!r.channelId || seen.has(r.channelId)) continue;
			seen.add(r.channelId);
			const s = channelSubs.get(r.channelId);
			if (s != null) subs.push(s);
		}
	}
	const avgSubs = subs.length
		? subs.reduce((a, b) => a + b, 0) / subs.length
		: null;

	const medianViews = median(views);
	const medianVph = median(vphs);
	const medianAge = median(ages);

	const prominence = prominenceOf(stat);
	const velocity = medianVph == null ? 0 : clamp(Math.log10(1 + medianVph) / 4);
	const recency = dated ? recent / dated : 0;
	const volume = 100 * (0.45 * prominence + 0.4 * velocity + 0.15 * recency);

	const cViews =
		medianViews == null ? 0 : clamp(Math.log10(1 + medianViews) / 7);
	const cChannels =
		avgSubs != null && subs.length >= 3
			? clamp(Math.log10(1 + avgSubs) / 7)
			: null;
	const cTitles = top.length ? exact / top.length : 0;
	const cFresh = medianAge == null ? 0.5 : 1 - clamp(medianAge / 1095);
	const weighted =
		cChannels == null
			? (0.4 * cViews + 0.25 * cTitles + 0.15 * cFresh) / 0.8
			: 0.4 * cViews + 0.2 * cChannels + 0.25 * cTitles + 0.15 * cFresh;
	const competition = top.length ? 100 * weighted : 0;

	const overall =
		100 * Math.sqrt(clamp(volume / 100) * (1 - clamp(competition / 100)));

	return {
		volume: Math.round(volume),
		competition: Math.round(competition),
		overall: Math.round(overall),
		sample: top.length,
		medianViews,
		medianVph,
		medianAgeDays: medianAge,
		recentShare: recency,
		exactTitleMatches: exact,
		avgChannelSubs: avgSubs,
		channelsKnown: subs.length,
		parts: {
			prominence,
			velocity,
			recency,
			views: cViews,
			channels: cChannels,
			titles: cTitles,
			freshness: cFresh,
		},
	};
}

/** Short formula text for tooltips. */
export const FORMULA_HELP = {
	volume:
		"Demand proxy: 45% autocomplete prominence (how high and how often YouTube suggests it), 40% median views/hour of the top 10 results, 15% share of top results from the last 6 months.",
	competition:
		"How hard the top 10 results are to beat: 40% their median views, 25% exact-phrase titles, 15% how recent they are, 20% average channel size (once known).",
	overall:
		"Opportunity = √(volume × (100 − competition)). High only when people search for it AND the current results are beatable.",
} as const;

// ---------------------------------------------------------------------------
// Keyword expansion
// ---------------------------------------------------------------------------

export const QUESTION_PREFIXES = ["how to", "why", "what", "best"] as const;

/** Autocomplete queries used to expand a seed keyword. */
export function expansionQueries(seed: string): string[] {
	const s = seed.trim().toLowerCase();
	const letters = "abcdefghijklmnopqrstuvwxyz"
		.split("")
		.map((c) => `${s} ${c}`);
	return [
		s,
		...QUESTION_PREFIXES.map((p) => `${p} ${s}`),
		`${s} vs`,
		...letters,
	];
}
