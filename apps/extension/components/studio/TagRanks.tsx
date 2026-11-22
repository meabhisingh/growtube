/**
 * Tag rank checker: where this video ranks in YouTube search (top 40,
 * anonymous, not personalized) for each tag and the target keyword.
 * Checks run only when asked (section opened / button), results are cached.
 */
import { RefreshCw, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import { yt } from "@/lib/client";

import { useRemembered } from "./prefs";
import { Btn, cx, Notice, Spinner } from "./ui";

const DEPTH = 40;
const CONCURRENCY = 3;

type RankState =
	| { status: "loading" }
	| { status: "done"; rank: number | null; at: number }
	| { status: "error"; message: string };

export function rankTone(rank: number | null): string {
	if (rank == null) return "none";
	if (rank <= 3) return "top";
	if (rank <= 10) return "high";
	if (rank <= 20) return "mid";
	return "low";
}

export function TagRanks({
	memoryKey,
	videoId,
	tags,
	keyword,
	visibilityNote,
	onRanks,
}: {
	memoryKey: string;
	videoId: string | null;
	tags: string[];
	keyword: string;
	/** e.g. "Private videos don't appear in search" */
	visibilityNote?: string | null;
	onRanks?: (ranks: Record<string, number | null>) => void;
}) {
	const [ranks, setRanks] = useRemembered<Record<string, RankState>>(
		`${memoryKey}:ranks`,
		{},
	);
	const ranksRef = useRef(ranks);
	ranksRef.current = ranks;

	const queries = useMemo(() => {
		const seen = new Set<string>();
		const out: { q: string; isKeyword: boolean }[] = [];
		const push = (q: string, isKeyword: boolean) => {
			const t = q.trim();
			if (!t || seen.has(t.toLowerCase())) return;
			seen.add(t.toLowerCase());
			out.push({ q: t, isKeyword });
		};
		if (keyword) push(keyword, true);
		for (const t of tags) push(t, false);
		return out.slice(0, 40);
	}, [tags, keyword]);

	const check = useCallback(
		async (list: string[], force: boolean) => {
			if (!videoId || !list.length) return;
			setRanks((prev) => {
				const next = { ...prev };
				for (const q of list) next[q] = { status: "loading" };
				return next;
			});
			const queue = [...list];
			const worker = async () => {
				for (let q = queue.shift(); q !== undefined; q = queue.shift()) {
					const query = q;
					let state: RankState;
					try {
						const rank = force
							? ((
									await yt.search(query, {
										limit: DEPTH,
										force: true,
										crowdsource: false,
									})
								).results.find((r) => r.videoId === videoId)?.position ?? null)
							: await yt.findVideoRank(query, videoId, DEPTH);
						state = { status: "done", rank, at: Date.now() };
					} catch (error) {
						state = {
							status: "error",
							message: error instanceof Error ? error.message : String(error),
						};
					}
					setRanks((prev) => ({ ...prev, [query]: state }));
				}
			};
			await Promise.all(
				Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker),
			);
		},
		[videoId, setRanks],
	);

	// Lazily check queries we haven't seen yet (this section is only mounted when open).
	useEffect(() => {
		const missing = queries.map((x) => x.q).filter((q) => !ranksRef.current[q]);
		if (missing.length) void check(missing, false);
	}, [queries, check]);

	useEffect(() => {
		if (!onRanks) return;
		const done: Record<string, number | null> = {};
		for (const { q } of queries) {
			const r = ranks[q];
			if (r?.status === "done") done[q] = r.rank;
		}
		onRanks(done);
	}, [ranks, queries, onRanks]);

	if (!videoId) {
		return (
			<Notice>
				Rank checks start once Studio shows this video's link (after the upload
				begins).
			</Notice>
		);
	}
	if (!queries.length) {
		return (
			<Notice>
				Add tags or a target keyword to check where this video ranks.
			</Notice>
		);
	}

	const loading = queries.some((x) => ranks[x.q]?.status === "loading");
	const ranked = queries.filter((x) => {
		const r = ranks[x.q];
		return r?.status === "done" && r.rank != null;
	}).length;

	return (
		<div className="ovq-ranks">
			<div className="ovq-tool-head">
				<p className="ovq-muted ovq-small">
					Position in YouTube search (top {DEPTH}) for each tag.
					{ranked ? ` Ranking for ${ranked} of ${queries.length}.` : ""}
				</p>
				<Btn
					small
					icon={<RefreshCw size={12} />}
					loading={loading}
					onClick={() =>
						void check(
							queries.map((x) => x.q),
							true,
						)
					}
					title="Search again now (results are cached for 30 minutes)"
				>
					Refresh
				</Btn>
			</div>
			{visibilityNote ? <Notice kind="warn">{visibilityNote}</Notice> : null}
			<ul className="ovq-rank-list">
				{queries.map(({ q, isKeyword }) => {
					const r = ranks[q];
					return (
						<li key={q} className="ovq-rank-row">
							<span className="ovq-rank-query" title={q}>
								{q}
								{isKeyword ? (
									<span className="ovq-pill ovq-pill-accent">keyword</span>
								) : null}
							</span>
							<span className="ovq-rank-value">
								{!r ? (
									<button
										type="button"
										className="ovq-icon-btn"
										title="Check rank"
										aria-label={`Check rank for ${q}`}
										onClick={() => void check([q], false)}
									>
										<Search size={12} />
									</button>
								) : r.status === "loading" ? (
									<Spinner size={12} />
								) : r.status === "error" ? (
									<button
										type="button"
										className="ovq-rank-badge ovq-rank-error"
										title={`${r.message} (click to retry)`}
										onClick={() => void check([q], true)}
									>
										error
									</button>
								) : (
									<span
										className={cx(
											"ovq-rank-badge",
											`ovq-rank-${rankTone(r.rank)}`,
										)}
										title={
											r.rank == null
												? `Not in the top ${DEPTH} results`
												: `Result #${r.rank} on YouTube search`
										}
									>
										{r.rank == null ? `>${DEPTH}` : `#${r.rank}`}
									</span>
								)}
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
