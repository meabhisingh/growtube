/**
 * Keyword expansion (YouTube autocomplete) + lazy, concurrency-limited,
 * cached scoring (YouTube search). Scores are recomputed from the cached
 * search results on every render, so they pick up channel sizes as soon as
 * the detail view learns them.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { yt } from "@/lib/client";
import type { SearchResponse } from "@/lib/youtube/types";

import { createQueue, normalizeKey } from "../../../utils";
import {
	expansionQueries,
	type KeywordMetrics,
	type SuggestionStat,
	scoreKeyword,
} from "./scoring";

export type KeywordRow = SuggestionStat & { key: string };

export type ScoreEntry =
	| { status: "loading" }
	| { status: "done"; response: SearchResponse }
	| { status: "error"; error: unknown };

// Session-wide caches (the background caches too; these make re-renders and
// repeated seeds instant).
const searchCache = new Map<string, Promise<SearchResponse>>();
/** channelId -> subscribers (null = hidden) */
export const channelSubsCache = new Map<string, number | null>();

const suggestQueue = createQueue(4);
const scoreQueue = createQueue(3);

export function searchKeyword(keyword: string): Promise<SearchResponse> {
	const key = normalizeKey(keyword);
	let p = searchCache.get(key);
	if (!p) {
		p = yt.search(keyword, { limit: 20 });
		searchCache.set(key, p);
		p.catch(() => searchCache.delete(key));
	}
	return p;
}

export type SortKey =
	| "default"
	| "keyword"
	| "volume"
	| "competition"
	| "overall";

export function useKeywordResearch() {
	const [seed, setSeed] = useState<string | null>(null);
	const [rows, setRows] = useState<KeywordRow[]>([]);
	const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
	const [scores, setScores] = useState<Record<string, ScoreEntry>>({});
	const [subsVersion, setSubsVersion] = useState(0);
	const runId = useRef(0);
	const rowsRef = useRef<Map<string, KeywordRow>>(new Map());
	const scoresRef = useRef(scores);
	scoresRef.current = scores;

	const research = useCallback(async (rawSeed: string) => {
		const seedText = rawSeed.trim().replace(/\s+/g, " ");
		if (!seedText) return;
		const id = ++runId.current;
		const seedKey = normalizeKey(seedText);
		const map = new Map<string, KeywordRow>();
		map.set(seedKey, {
			key: seedKey,
			keyword: seedText.toLowerCase(),
			bestRank: null,
			lists: 0,
			isSeed: true,
			order: 0,
		});
		rowsRef.current = map;
		let order = 1;
		const queries = expansionQueries(seedText);
		setSeed(seedText);
		setRows([...map.values()]);
		const counts = { done: 0, total: queries.length, failed: 0 };
		setProgress({ ...counts });

		await Promise.all(
			queries.map((q) =>
				suggestQueue(async () => {
					if (id !== runId.current) return;
					try {
						const list = await yt.getSearchSuggestions(q);
						if (id !== runId.current) return;
						const seen = new Set<string>();
						list.forEach((s, index) => {
							const key = normalizeKey(s);
							if (!key || seen.has(key)) return;
							seen.add(key);
							const row = map.get(key) ?? {
								key,
								keyword: s.trim().toLowerCase(),
								bestRank: null,
								lists: 0,
								isSeed: false,
								order: order++,
							};
							row.bestRank =
								row.bestRank == null ? index : Math.min(row.bestRank, index);
							row.lists += 1;
							map.set(key, row);
						});
					} catch {
						counts.failed++;
					} finally {
						if (id === runId.current) {
							counts.done++;
							setProgress({ ...counts });
							setRows([...map.values()].map((r) => ({ ...r })));
						}
					}
				}),
			),
		);
	}, []);

	/** Queues scoring for a keyword (no-op if already scored or in flight). */
	const score = useCallback((key: string) => {
		const existing = scoresRef.current[key];
		if (existing && existing.status !== "error") return;
		const row = rowsRef.current.get(key);
		if (!row) return;
		scoresRef.current = { ...scoresRef.current, [key]: { status: "loading" } };
		setScores((s) => ({ ...s, [key]: { status: "loading" } }));
		scoreQueue(() => searchKeyword(row.keyword)).then(
			(response) =>
				setScores((s) => ({ ...s, [key]: { status: "done", response } })),
			(error) =>
				setScores((s) => ({ ...s, [key]: { status: "error", error } })),
		);
	}, []);

	const scoreAll = useCallback(() => {
		for (const key of rowsRef.current.keys()) score(key);
	}, [score]);

	/** Call after adding entries to channelSubsCache to refresh scores. */
	const channelsUpdated = useCallback(() => setSubsVersion((v) => v + 1), []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: subsVersion invalidates channel-size inputs
	const metrics = useMemo(() => {
		const out = new Map<string, KeywordMetrics>();
		for (const row of rows) {
			const s = scores[row.key];
			if (s?.status === "done")
				out.set(
					row.key,
					scoreKeyword(row, s.response.results, channelSubsCache),
				);
		}
		return out;
	}, [rows, scores, subsVersion]);

	// Cancel the expansion when unmounting.
	useEffect(
		() => () => {
			runId.current++;
		},
		[],
	);

	return {
		seed,
		rows,
		progress,
		expanding: progress.done < progress.total,
		scores,
		metrics,
		research,
		score,
		scoreAll,
		channelsUpdated,
	};
}

export function sortRows(
	rows: KeywordRow[],
	metrics: Map<string, KeywordMetrics>,
	by: SortKey,
	dir: "asc" | "desc",
): KeywordRow[] {
	const sign = dir === "asc" ? 1 : -1;
	const sorted = [...rows];
	if (by === "default") {
		sorted.sort((a, b) => {
			if (a.isSeed !== b.isSeed) return a.isSeed ? -1 : 1;
			if (b.lists !== a.lists) return b.lists - a.lists;
			return (a.bestRank ?? 99) - (b.bestRank ?? 99) || a.order - b.order;
		});
		return sorted;
	}
	if (by === "keyword") {
		sorted.sort((a, b) => sign * a.keyword.localeCompare(b.keyword));
		return sorted;
	}
	sorted.sort((a, b) => {
		const ma = metrics.get(a.key);
		const mb = metrics.get(b.key);
		// Unscored rows always last
		if (!ma && !mb) return a.order - b.order;
		if (!ma) return 1;
		if (!mb) return -1;
		return sign * (ma[by] - mb[by]);
	});
	return sorted;
}
