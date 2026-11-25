/** One keyword: score breakdown, top results with VPH/outliers, AI insights. */
import { formatCompact, formatPercent } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import {
	ArrowLeft,
	Gauge,
	Image,
	MessagesSquare,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo } from "react";

import { CopyButton } from "@/components/common";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { ai, yt } from "@/lib/client";

import { useOutliers } from "../../../baselines";
import { useAsyncTask } from "../../../hooks";
import {
	Badge,
	levelLabel,
	OutlierBadge,
	scoreLabel,
	scoreTone,
	VphBadge,
} from "../../../ui/badges";
import { InfoTip } from "../../../ui/controls";
import { ErrorNotice, LoadingBlock, SkeletonList } from "../../../ui/feedback";
import { Eyebrow, Section, StatGrid, StatTile } from "../../../ui/layout";
import { VideoRow } from "../../../ui/video";
import { createQueue, vphOf } from "../../../utils";
import { usePanel } from "../../nav";
import { AiSetupNotice } from "../../shared";
import { SaveToPlannerButton } from "../planner/SaveToPlannerButton";
import { FORMULA_HELP, type KeywordMetrics, topResults } from "./scoring";
import {
	channelSubsCache,
	type KeywordRow,
	type ScoreEntry,
} from "./useKeywordResearch";

const channelQueue = createQueue(3);

export function KeywordDetail({
	row,
	entry,
	metrics,
	related,
	onBack,
	onResearch,
	onRetry,
	onChannelsLoaded,
}: {
	row: KeywordRow;
	entry: ScoreEntry | undefined;
	metrics: KeywordMetrics | undefined;
	/** Other keywords from the same research (for the AI) */
	related: string[];
	onBack: () => void;
	onResearch: (keyword: string) => void;
	onRetry: () => void;
	onChannelsLoaded: () => void;
}) {
	const { navigate } = usePanel();
	const results = entry?.status === "done" ? entry.response.results : null;
	const top = useMemo(() => (results ? topResults(results) : []), [results]);

	// Learn channel sizes of the top results (refines the competition score).
	useEffect(() => {
		if (!top.length) return;
		let alive = true;
		const missing = [
			...new Set(
				top
					.map((r) => r.channelId)
					.filter((id): id is string => !!id && !channelSubsCache.has(id)),
			),
		];
		if (!missing.length) return;
		void Promise.all(
			missing.map((channelId) =>
				channelQueue(() =>
					yt
						.getChannel({ channelId })
						.then((c) => channelSubsCache.set(channelId, c.subscribers))
						.catch(() => channelSubsCache.set(channelId, null)),
				),
			),
		).then(() => alive && onChannelsLoaded());
		return () => {
			alive = false;
		};
	}, [top, onChannelsLoaded]);

	const outliers = useOutliers(
		top.map((r) => ({
			videoId: r.videoId,
			channelId: r.channelId,
			views: r.views,
			isShort: r.isShort,
		})),
	);

	const insights = useAsyncTask(() =>
		ai.generate("keywordInsights", {
			keyword: row.keyword,
			suggestions: related.slice(0, 25),
			topResults: (results ?? []).slice(0, 20).map((r) => ({
				title: r.title,
				views: r.views,
				channelTitle: r.channelTitle,
				publishedText: r.publishedText,
			})),
		}),
	);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-1.5">
				<Button size="xs" variant="ghost" onClick={onBack}>
					<ArrowLeft /> All keywords
				</Button>
			</div>
			<div className="flex items-start gap-2">
				<h2 className="min-w-0 flex-1 text-base leading-tight font-semibold [overflow-wrap:anywhere]">
					{row.keyword}
				</h2>
				<CopyButton text={row.keyword} title="Copy keyword" size={12} />
				<SaveToPlannerButton
					idea={{
						title: `Video about "${row.keyword}"`,
						source: "keywords",
						targetKeyword: row.keyword,
					}}
				/>
			</div>

			{entry?.status === "error" ? (
				<ErrorNotice error={entry.error} onRetry={onRetry} />
			) : !metrics ? (
				<LoadingBlock label="Analyzing the top results…" />
			) : (
				<>
					<div className="grid grid-cols-3 gap-1.5">
						<BigScore
							label="Volume"
							value={metrics.volume}
							caption={levelLabel(metrics.volume)}
							help={FORMULA_HELP.volume}
						/>
						<BigScore
							label="Competition"
							value={metrics.competition}
							caption={levelLabel(metrics.competition)}
							help={FORMULA_HELP.competition}
							invert
						/>
						<BigScore
							label="Overall"
							value={metrics.overall}
							caption={scoreLabel(metrics.overall)}
							help={FORMULA_HELP.overall}
						/>
					</div>

					<Section title="Why these scores" bodyClassName="gap-2">
						<StatGrid>
							<StatTile
								label="Autocomplete"
								value={row.bestRank == null ? "—" : `#${row.bestRank + 1}`}
								sub={`in ${row.lists} list${row.lists === 1 ? "" : "s"}`}
								title="Best position in YouTube's suggestions, and how many of the expansion lists contain it"
							/>
							<StatTile
								label="Median views/h"
								value={formatCompact(metrics.medianVph, 1)}
								sub="top 10 results"
							/>
							<StatTile
								label="Recent (6 mo)"
								value={formatPercent(metrics.recentShare * 100, 0)}
								sub="of top results"
							/>
							<StatTile
								label="Median views"
								value={formatCompact(metrics.medianViews)}
								sub="top 10 results"
							/>
							<StatTile
								label="Exact-match titles"
								value={`${metrics.exactTitleMatches}/${metrics.sample}`}
								sub="contain the phrase"
							/>
							<StatTile
								label="Avg channel size"
								value={
									metrics.channelsKnown >= 3
										? formatCompact(metrics.avgChannelSubs)
										: "…"
								}
								sub={
									metrics.channelsKnown >= 3
										? `${metrics.channelsKnown} channels`
										: "loading channels"
								}
							/>
							<StatTile
								label="Median age"
								value={
									metrics.medianAgeDays == null
										? "—"
										: metrics.medianAgeDays >= 365
											? `${(metrics.medianAgeDays / 365).toFixed(1)} y`
											: `${Math.round(metrics.medianAgeDays)} d`
								}
								sub="of top results"
							/>
						</StatGrid>
					</Section>
				</>
			)}

			<div className="flex flex-wrap gap-1.5">
				<Button
					size="sm"
					onClick={() => void insights.run()}
					disabled={insights.loading || !results}
				>
					{insights.loading ? (
						<RefreshCw className="animate-spin" />
					) : (
						<Sparkles />
					)}
					AI keyword insights
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() => navigate("optimize", { prefill: row.keyword })}
				>
					<Gauge /> Titles &amp; tags
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() =>
						navigate("thumbnails", { prefill: row.keyword, view: "similar" })
					}
				>
					<Image /> Thumbnails
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() =>
						navigate("coach", {
							prefill: `How can I make a video that ranks for "${row.keyword}" on YouTube?`,
						})
					}
				>
					<MessagesSquare /> Ask coach
				</Button>
			</div>

			{insights.error || insights.data || insights.loading ? (
				<Section title="AI insights" icon={Sparkles}>
					<AiSetupNotice />
					{insights.error ? (
						<ErrorNotice
							error={insights.error}
							onRetry={() => void insights.run()}
						/>
					) : insights.loading && !insights.data ? (
						<LoadingBlock label="Thinking about this keyword…" />
					) : insights.data ? (
						<Insights
							data={insights.data}
							keyword={row.keyword}
							onResearch={onResearch}
						/>
					) : null}
				</Section>
			) : null}

			<Section
				title="Top results"
				description="What you'd compete with today (anonymous search, no personalization)."
			>
				{!results ? (
					entry?.status === "error" ? null : (
						<SkeletonList rows={5} />
					)
				) : top.length === 0 ? (
					<div className="text-muted-foreground text-xs">No results.</div>
				) : (
					<div className="flex flex-col gap-3">
						{top.map((r, i) => (
							<VideoRow
								key={r.videoId}
								rank={i + 1}
								video={r}
								badges={
									<>
										<VphBadge vph={vphOf(r.views, r.publishedAt)} />
										<OutlierBadge
											score={outliers[r.videoId]}
											loading={
												outliers[r.videoId] === undefined && !!r.channelId
											}
										/>
									</>
								}
							/>
						))}
					</div>
				)}
			</Section>
		</div>
	);
}

function BigScore({
	label,
	value,
	caption,
	help,
	invert,
}: {
	label: string;
	value: number;
	caption: string;
	help: string;
	invert?: boolean;
}) {
	const tone = scoreTone(invert ? 100 - value : value);
	return (
		<div className="bg-surface-2 flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-center">
			<div className="text-muted-foreground flex items-center gap-1 text-[11px]">
				{label}
				<InfoTip label={`How ${label.toLowerCase()} is scored`}>{help}</InfoTip>
			</div>
			<Badge tone={tone} className="h-7 rounded-lg px-2.5 text-base">
				{value}
			</Badge>
			<div className="text-muted-foreground text-[11px]">{caption}</div>
		</div>
	);
}

type InsightsData = GeneratorOutput<"keywordInsights">;

function Insights({
	data,
	keyword,
	onResearch,
}: {
	data: InsightsData;
	keyword: string;
	onResearch: (keyword: string) => void;
}) {
	return (
		<div className="flex flex-col gap-3 text-xs">
			<div className="flex flex-wrap items-center gap-1.5">
				<Badge tone={scoreTone(data.opportunityScore)}>
					Opportunity {data.opportunityScore}
				</Badge>
				<Badge
					tone={
						data.competition === "low"
							? "emerald"
							: data.competition === "medium"
								? "amber"
								: "red"
					}
				>
					{data.competition} competition
				</Badge>
			</div>
			<p className="leading-relaxed">{data.summary}</p>
			<InsightBlock title="Search intent">
				<p className="text-muted-foreground leading-relaxed">
					{data.searchIntent}
				</p>
			</InsightBlock>
			{data.titleAngles.length ? (
				<InsightBlock title="Title angles">
					<ul className="flex flex-col gap-1">
						{data.titleAngles.map((t) => (
							<li key={t} className="flex items-start gap-1.5">
								<span className="min-w-0 flex-1 leading-relaxed">{t}</span>
								<CopyButton text={t} size={11} style={{ padding: 3 }} />
								<SaveToPlannerButton
									idea={{
										title: t,
										notes: `Title angle for the keyword "${keyword}".\n${data.summary}`,
										source: "keywords",
										targetKeyword: keyword,
									}}
								/>
							</li>
						))}
					</ul>
				</InsightBlock>
			) : null}
			{data.contentGaps.length ? (
				<InsightBlock title="Content gaps">
					<ul className="list-disc pl-4 leading-relaxed">
						{data.contentGaps.map((g) => (
							<li key={g}>{g}</li>
						))}
					</ul>
				</InsightBlock>
			) : null}
			{data.relatedKeywords.length ? (
				<InsightBlock title="Related keywords (click to research)">
					<div className="flex flex-wrap gap-1">
						{data.relatedKeywords.map((k) => (
							<button
								key={k}
								type="button"
								onClick={() => onResearch(k)}
								className="bg-surface hover:border-brand/40 hover:text-brand focus-visible:ring-ring/50 rounded-lg border px-1.5 py-0.5 text-[11px] transition-colors duration-150 outline-none focus-visible:ring-2"
							>
								{k}
							</button>
						))}
					</div>
				</InsightBlock>
			) : null}
		</div>
	);
}

function InsightBlock({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Eyebrow>{title}</Eyebrow>
			{children}
		</div>
	);
}
