/**
 * Keyword Research: expand a seed with YouTube autocomplete, then score each
 * keyword lazily (as it scrolls into view) from the live search results.
 * Scoring formulas: see ./scoring.ts.
 */
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { cn } from "@growtube/ui/lib/utils";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Search,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common";

import { useLocalPref, useOnVisible } from "../../../hooks";
import { ScoreBadge } from "../../../ui/badges";
import { InfoTip, SearchForm } from "../../../ui/controls";
import { EmptyState, Spinner } from "../../../ui/feedback";
import { normalizeKey } from "../../../utils";
import type { ToolProps } from "../../nav";
import { ToolScroll } from "../../shared";
import { KeywordDetail } from "./KeywordDetail";
import { FORMULA_HELP, type KeywordMetrics } from "./scoring";
import {
	type KeywordRow,
	type ScoreEntry,
	type SortKey,
	sortRows,
	useKeywordResearch,
} from "./useKeywordResearch";

const EXAMPLES = [
	"budget travel",
	"home workout",
	"minecraft builds",
	"sourdough",
];

export function KeywordsTool({ intent }: ToolProps) {
	const research = useKeywordResearch();
	const [lastSeed, setLastSeed] = useLocalPref("keywords.seed", "");
	const [input, setInput] = useState(lastSeed);
	const [selected, setSelected] = useState<string | null>(null);
	const [sort, setSort] = useState<{ by: SortKey; dir: "asc" | "desc" }>({
		by: "default",
		dir: "desc",
	});
	const [filter, setFilter] = useState("");

	const start = useCallback(
		(seed: string) => {
			setInput(seed);
			setLastSeed(seed);
			setSelected(null);
			setFilter("");
			setSort({ by: "default", dir: "desc" });
			void research.research(seed);
		},
		[research.research, setLastSeed],
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent?.prefill) start(intent.prefill);
	}, [intent?.id]);

	const visibleRows = useMemo(() => {
		const f = normalizeKey(filter);
		const rows = f
			? research.rows.filter((r) => r.key.includes(f))
			: research.rows;
		return sortRows(rows, research.metrics, sort.by, sort.dir);
	}, [research.rows, research.metrics, sort, filter]);

	const selectedRow = selected
		? research.rows.find((r) => r.key === selected)
		: undefined;

	useEffect(() => {
		if (selected) research.score(selected);
	}, [selected, research.score]);

	const toggleSort = (by: SortKey) =>
		setSort((s) =>
			s.by === by
				? s.dir === "desc"
					? { by, dir: "asc" }
					: { by: "default", dir: "desc" }
				: { by, dir: by === "keyword" ? "asc" : "desc" },
		);

	const csv = () =>
		[
			"keyword,volume,competition,overall",
			...visibleRows.map((r) => {
				const m = research.metrics.get(r.key);
				return `"${r.keyword.replace(/"/g, '""')}",${m?.volume ?? ""},${m?.competition ?? ""},${m?.overall ?? ""}`;
			}),
		].join("\n");

	if (selectedRow) {
		return (
			<ToolScroll>
				<KeywordDetail
					row={selectedRow}
					entry={research.scores[selectedRow.key]}
					metrics={research.metrics.get(selectedRow.key)}
					related={research.rows
						.filter((r) => r.key !== selectedRow.key)
						.map((r) => r.keyword)}
					onBack={() => setSelected(null)}
					onResearch={start}
					onRetry={() => research.score(selectedRow.key)}
					onChannelsLoaded={research.channelsUpdated}
				/>
			</ToolScroll>
		);
	}

	const scoredCount = research.metrics.size;

	return (
		<ToolScroll>
			<SearchForm
				value={input}
				onChange={setInput}
				onSubmit={start}
				placeholder="Seed keyword, e.g. budget travel"
				inputLabel="Seed keyword"
				buttonLabel="Research"
				loading={research.expanding}
				autoFocus
			/>

			{!research.seed ? (
				<EmptyState icon={Search} title="Find keywords worth ranking for">
					Enter a topic. GrowTube expands it with YouTube autocomplete (a–z,
					questions, comparisons) and scores every keyword for volume,
					competition and overall opportunity. Unlimited searches.
					<div className="mt-3 flex flex-wrap justify-center gap-1">
						{EXAMPLES.map((e) => (
							<button
								key={e}
								type="button"
								onClick={() => start(e)}
								className="bg-surface hover:border-brand/40 hover:text-brand focus-visible:ring-ring/50 rounded-lg border px-2 py-0.5 text-[11px] transition-colors duration-150 outline-none focus-visible:ring-2"
							>
								{e}
							</button>
						))}
					</div>
				</EmptyState>
			) : (
				<>
					<div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
						{research.expanding ? (
							<span className="flex items-center gap-1.5">
								<Spinner className="size-3" />
								Expanding with autocomplete… {research.progress.done}/
								{research.progress.total}
							</span>
						) : (
							<span>
								{research.rows.length} keywords · {scoredCount} scored
								{research.progress.failed
									? ` · ${research.progress.failed} lookups failed`
									: ""}
							</span>
						)}
						<div className="flex-1" />
						<Button
							size="xs"
							variant="outline"
							onClick={research.scoreAll}
							disabled={scoredCount >= research.rows.length}
						>
							<Sparkles /> Score all
						</Button>
						<CopyButton text={csv} label="CSV" title="Copy as CSV" size={11} />
					</div>
					{research.progress.total > 0 && research.expanding ? (
						<div className="bg-muted h-1 w-full overflow-hidden rounded-full">
							<div
								className="bg-brand h-full rounded-full transition-[width] duration-200"
								style={{
									width: `${(research.progress.done / research.progress.total) * 100}%`,
								}}
							/>
						</div>
					) : null}
					{research.rows.length > 12 ? (
						<Input
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder="Filter keywords"
							aria-label="Filter keywords"
						/>
					) : null}

					<div className="bg-card ring-foreground/7 flex flex-col overflow-clip rounded-xl shadow-xs ring-1">
						<div className="bg-card/95 text-muted-foreground sticky top-0 z-10 grid grid-cols-[1fr_repeat(3,54px)] items-center gap-1 border-b px-1.5 py-2 text-[11px] font-medium backdrop-blur">
							<SortHeader
								label="Keyword"
								by="keyword"
								sort={sort}
								onSort={toggleSort}
								align="left"
							/>
							<SortHeader
								label="Vol"
								by="volume"
								sort={sort}
								onSort={toggleSort}
								help={FORMULA_HELP.volume}
							/>
							<SortHeader
								label="Comp"
								by="competition"
								sort={sort}
								onSort={toggleSort}
								help={FORMULA_HELP.competition}
							/>
							<SortHeader
								label="Score"
								by="overall"
								sort={sort}
								onSort={toggleSort}
								help={FORMULA_HELP.overall}
							/>
						</div>
						{visibleRows.map((row) => (
							<KeywordTableRow
								key={row.key}
								row={row}
								entry={research.scores[row.key]}
								metrics={research.metrics.get(row.key)}
								onVisible={() => research.score(row.key)}
								onOpen={() => setSelected(row.key)}
							/>
						))}
						{visibleRows.length === 0 && !research.expanding ? (
							<div className="text-muted-foreground py-6 text-center text-xs">
								No keywords match.
							</div>
						) : null}
					</div>
					<p className="text-muted-foreground text-[11px] leading-relaxed">
						Scores are estimates from public signals (autocomplete + current top
						results), not YouTube's private search volume. Hover the column
						headers for the formulas.
					</p>
				</>
			)}
		</ToolScroll>
	);
}

function SortHeader({
	label,
	by,
	sort,
	onSort,
	help,
	align = "center",
}: {
	label: string;
	by: SortKey;
	sort: { by: SortKey; dir: "asc" | "desc" };
	onSort: (by: SortKey) => void;
	help?: string;
	align?: "left" | "center";
}) {
	const active = sort.by === by;
	const Icon = active
		? sort.dir === "asc"
			? ArrowUp
			: ArrowDown
		: ArrowUpDown;
	return (
		<div
			className={cn(
				"flex min-w-0 items-center",
				align === "center" ? "justify-center" : "gap-0.5 pl-1",
			)}
		>
			<button
				type="button"
				onClick={() => onSort(by)}
				aria-label={`Sort by ${label}${active ? (sort.dir === "asc" ? ", ascending" : ", descending") : ""}`}
				title={`Sort by ${label}`}
				className={cn(
					"hover:text-foreground focus-visible:text-foreground inline-flex items-center outline-none",
					active && "text-foreground",
				)}
			>
				{label}
				{/* Narrow side panel: the numeric columns only show the arrow of the active sort. */}
				{active || align === "left" ? (
					<Icon className="size-2.5" aria-hidden />
				) : null}
			</button>
			{help ? (
				<InfoTip label={`How ${label} is scored`} className="size-3.5">
					{help}
				</InfoTip>
			) : null}
		</div>
	);
}

function KeywordTableRow({
	row,
	entry,
	metrics,
	onVisible,
	onOpen,
}: {
	row: KeywordRow;
	entry: ScoreEntry | undefined;
	metrics: KeywordMetrics | undefined;
	onVisible: () => void;
	onOpen: () => void;
}) {
	const ref = useOnVisible<HTMLButtonElement>(onVisible, !entry);
	const loading = entry?.status === "loading";
	const failed = entry?.status === "error";
	const summary = metrics
		? `${row.keyword}: volume ${metrics.volume}, competition ${metrics.competition}, overall ${metrics.overall}`
		: `${row.keyword}${loading ? ", scoring" : failed ? ", scoring failed" : ""}`;
	return (
		<button
			ref={ref}
			type="button"
			aria-label={summary}
			onClick={onOpen}
			className="border-border/60 hover:bg-muted/60 focus-visible:bg-muted grid grid-cols-[1fr_repeat(3,54px)] items-center gap-1 border-b px-1.5 py-1.5 text-left transition-colors duration-150 outline-none last:border-b-0"
		>
			<span className="flex min-w-0 items-center gap-1.5 pl-1">
				<span
					className={cn("truncate text-xs", row.isSeed && "font-semibold")}
					title={row.keyword}
				>
					{row.keyword}
				</span>
				{row.isSeed ? (
					<span className="text-brand shrink-0 text-[10px] uppercase">
						seed
					</span>
				) : null}
			</span>
			<span className="flex justify-center">
				<ScoreBadge
					score={metrics?.volume}
					loading={loading}
					title={failed ? "Failed, open to retry" : undefined}
				/>
			</span>
			<span className="flex justify-center">
				<ScoreBadge score={metrics?.competition} loading={loading} invert />
			</span>
			<span className="flex justify-center">
				<ScoreBadge score={metrics?.overall} loading={loading} />
			</span>
		</button>
	);
}
