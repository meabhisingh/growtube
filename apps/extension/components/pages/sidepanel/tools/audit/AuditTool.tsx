/**
 * Channel Audit: stats, average views, upload cadence, best posting slots,
 * top outliers, underperformers, SEO scores of the latest uploads and an AI
 * audit (channelAudit generator). Defaults to My channel.
 */
import {
	formatCompact,
	formatNumber,
	formatOutlier,
	formatPercent,
	formatRelative,
} from "@growtube/shared/format";
import {
	computeAverage,
	computeBestPostingSlots,
	computeEngagementRate,
	computeUploadsPerWeek,
	median,
	type PostingSlot,
} from "@growtube/shared/metrics";
import { computeSeoScore, type SeoResult } from "@growtube/shared/seo";
import { channelUrl } from "@growtube/shared/youtube";
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import {
	CalendarClock,
	ChartColumn,
	Crown,
	ExternalLink,
	Gauge,
	MonitorPlay,
	Sparkles,
	TrendingDown,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AreaChart } from "@/components/common";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { ai, yt } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { myChannel } from "@/lib/settings";
import type { ChannelInfo, VideoDetails } from "@/lib/youtube/types";

import {
	channelSummary,
	coachChannel,
	resolveChannelInput,
	settledVideos,
} from "../../../data";
import { useAsyncTask } from "../../../hooks";
import {
	Badge,
	OutlierBadge,
	ScoreBadge,
	scoreTone,
	VphBadge,
} from "../../../ui/badges";
import { IconButton, SearchForm } from "../../../ui/controls";
import { EmptyState, ErrorNotice, LoadingBlock } from "../../../ui/feedback";
import {
	Collapsible,
	Eyebrow,
	Section,
	StatGrid,
	StatTile,
} from "../../../ui/layout";
import { Avatar, VideoRow } from "../../../ui/video";
import {
	ageHoursOf,
	formatHour,
	openLink,
	outlierOf,
	vphOf,
	WEEKDAYS,
} from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { AiSetupNotice, ToolScroll } from "../../shared";
import { resolveTabChannel } from "../competitors/CompetitorsTool";

type AuditOutput = GeneratorOutput<"channelAudit">;

type AuditVideo = VideoDetails & {
	vph: number | null;
	outlier: number | null;
	seo: SeoResult;
};

type AuditData = {
	channel: ChannelInfo;
	videos: AuditVideo[];
	baselineLong: number | null;
	baselineShort: number | null;
	avgViews: number | null;
	medianViews: number | null;
	uploadsPerWeek: number | null;
	engagement: number | null;
	avgSeo: number | null;
	slots: PostingSlot[];
	weekdays: { weekday: number; avgOutlier: number | null; count: number }[];
};

async function loadAudit(channel: ChannelInfo): Promise<AuditData> {
	const channelId = channel.channelId;
	const [list, long, short] = await Promise.all([
		yt.getChannelVideos(channelId, { limit: 30 }),
		yt.getChannelBaseline(channelId, "long").catch(() => null),
		yt.getChannelBaseline(channelId, "short").catch(() => null),
	]);
	// Exact views + publish times + descriptions/tags (one player call each, cached).
	const details = await yt.getVideoDetailsBatch(
		list.filter((v) => !v.isUpcoming).map((v) => v.videoId),
		"basic",
	);
	const exact = list
		.map((v) => details[v.videoId])
		.filter((d): d is VideoDetails => !!d && !d.isUpcoming && !d.isLive);
	const settled = settledVideos(exact);
	const baselineLong = long?.baseline ?? median(settled.map((v) => v.views));
	const videos: AuditVideo[] = exact.map((v) => ({
		...v,
		vph: vphOf(v.views, v.publishedAt),
		outlier: outlierOf(v.views, baselineLong),
		seo: computeSeoScore({
			title: v.title,
			description: v.description,
			tags: v.keywords,
			durationSec: v.durationSec,
			isShort: v.isShort,
		}),
	}));
	const dated = settled.filter(
		(v): v is VideoDetails & { publishedAt: string } => !!v.publishedAt,
	);
	const slots = computeBestPostingSlots(
		dated.map((v) => ({ publishedAt: v.publishedAt, views: v.views })),
		baselineLong,
		3,
	);
	const weekdays = WEEKDAYS.map((_, weekday) => {
		const day = dated.filter(
			(v) => new Date(v.publishedAt).getDay() === weekday,
		);
		const scores = day
			.map((v) => outlierOf(v.views, baselineLong))
			.filter((s): s is number => s != null);
		return { weekday, avgOutlier: computeAverage(scores), count: day.length };
	});
	const engagements = settled
		.map((v) => computeEngagementRate(v))
		.filter((e): e is number => e != null);
	return {
		channel,
		videos,
		baselineLong,
		baselineShort: short?.baseline ?? null,
		avgViews: computeAverage(settled.map((v) => v.views)),
		medianViews: median(settled.map((v) => v.views)),
		uploadsPerWeek: computeUploadsPerWeek(dated.map((v) => v.publishedAt)),
		engagement: median(engagements),
		avgSeo: computeAverage(videos.slice(0, 10).map((v) => v.seo.score)),
		slots,
		weekdays,
	};
}

export function AuditTool({ intent, active }: ToolProps) {
	const { activeTab } = usePanel();
	const [mine] = useStorageItem(myChannel);
	const [input, setInput] = useState("");
	const audit = useAsyncTask(
		async (source: { input?: string; channelId?: string; tab?: true }) => {
			const channel = source.tab
				? await resolveTabChannel(activeTab)
				: source.channelId
					? await yt.getChannel({ channelId: source.channelId })
					: await resolveChannelInput(source.input ?? "");
			return loadAudit(channel);
		},
	);
	const data = audit.data;

	const report = useAsyncTask((d: AuditData) =>
		ai.generate("channelAudit", {
			channel: coachChannel(d.channel, {
				baselineLong: d.baselineLong,
				baselineShort: d.baselineShort,
				uploadsPerWeek: d.uploadsPerWeek,
			}),
			recentVideos: d.videos.slice(0, 25).map((v) => ({
				title: v.title,
				views: v.views,
				publishedAt: v.publishedAt,
				isShort: v.isShort,
			})),
			bestSlots: d.slots.map((s) => ({
				weekday: s.weekday,
				hour: s.hour,
				avgOutlier: s.avgOutlier,
			})),
		}),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent?.channelId) {
			report.reset();
			void audit.run({ channelId: intent.channelId });
		} else if (intent?.prefill) {
			setInput(intent.prefill);
			report.reset();
			void audit.run({ input: intent.prefill });
		}
	}, [intent?.id]);

	// Default: audit My channel the first time the tool is opened.
	// biome-ignore lint/correctness/useExhaustiveDependencies: first open only
	useEffect(() => {
		if (
			active &&
			mine &&
			!audit.data &&
			!audit.loading &&
			!audit.error &&
			!intent?.channelId &&
			!intent?.prefill
		)
			void audit.run({ channelId: mine.channelId });
	}, [active, mine?.channelId]);

	const run = (source: Parameters<typeof audit.run>[0]) => {
		report.reset();
		void audit.run(source);
	};

	return (
		<ToolScroll>
			<Section title="Audit a channel" icon={ChartColumn}>
				<SearchForm
					value={input}
					onChange={setInput}
					onSubmit={(v) => run({ input: v })}
					placeholder="Channel URL, @handle or id"
					inputLabel="Channel to audit"
					buttonLabel="Audit"
					loading={audit.loading}
				/>
				<div className="flex flex-wrap gap-1.5">
					{mine ? (
						<Button
							size="xs"
							variant="outline"
							disabled={audit.loading}
							onClick={() => run({ channelId: mine.channelId })}
						>
							<Crown /> My channel
						</Button>
					) : null}
					{activeTab.channelRef || activeTab.videoId ? (
						<Button
							size="xs"
							variant="outline"
							disabled={audit.loading}
							onClick={() => run({ tab: true })}
						>
							<MonitorPlay /> This tab's channel
						</Button>
					) : null}
				</div>
			</Section>

			{audit.error ? (
				<ErrorNotice error={audit.error} />
			) : audit.loading ? (
				<LoadingBlock label="Reading the last 30 uploads…" />
			) : !data ? (
				<EmptyState
					icon={ChartColumn}
					title="Audit any channel, as often as you like"
				>
					Set your channel in Competitors to audit it by default, or paste any
					channel above.
				</EmptyState>
			) : (
				<AuditReport data={data} report={report} />
			)}
		</ToolScroll>
	);
}

function AuditReport({
	data,
	report,
}: {
	data: AuditData;
	report: {
		run: (d: AuditData) => Promise<unknown>;
		loading: boolean;
		error: unknown;
		data: AuditOutput | undefined;
	};
}) {
	const c = data.channel;
	const settled = data.videos.filter((v) => {
		const h = ageHoursOf(v.publishedAt);
		return h == null || h >= 48;
	});
	const top = useMemo(
		() =>
			[...settled]
				.filter((v) => v.outlier != null)
				.sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))
				.slice(0, 5),
		[settled],
	);
	const under = useMemo(
		() =>
			[...settled]
				.filter((v) => v.outlier != null && v.outlier < 0.7)
				.sort((a, b) => (a.outlier ?? 0) - (b.outlier ?? 0))
				.slice(0, 5),
		[settled],
	);
	const chart = [...data.videos]
		.filter((v) => v.publishedAt)
		.reverse()
		.map((v) => ({ x: v.publishedAt as string, y: v.views }));
	const maxWeekday = Math.max(
		...data.weekdays.map((w) => w.avgOutlier ?? 0),
		1,
	);

	return (
		<>
			<Section>
				<div className="flex items-center gap-3">
					<Avatar src={c.avatarUrl} size={44} />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="truncate text-sm font-semibold">{c.title}</span>
						<span className="text-muted-foreground truncate text-[11px]">
							{channelSummary(c)}
						</span>
						<span className="text-muted-foreground truncate text-[11px]">
							{[c.joinedAt ? `Joined ${c.joinedAt}` : null, c.country]
								.filter(Boolean)
								.join(" · ")}
						</span>
					</div>
					<IconButton
						label="Open on YouTube"
						icon={ExternalLink}
						onClick={(e) => openLink(channelUrl(c.channelId), e)}
					/>
				</div>
				<StatGrid>
					<StatTile
						label="Subscribers"
						value={formatCompact(c.subscribers, 2)}
					/>
					<StatTile
						label="Total views"
						value={formatCompact(c.totalViews, 2)}
					/>
					<StatTile label="Videos" value={formatNumber(c.videoCount)} />
					<StatTile
						label="Avg views"
						value={formatCompact(data.avgViews)}
						sub="last 30 uploads"
					/>
					<StatTile
						label="Median views"
						value={formatCompact(data.medianViews)}
						sub="typical video"
					/>
					<StatTile
						label="Uploads / week"
						value={
							data.uploadsPerWeek == null ? "—" : data.uploadsPerWeek.toFixed(1)
						}
					/>
					<StatTile
						label="Engagement"
						value={formatPercent(data.engagement, 2)}
						sub="median likes per view"
					/>
					<StatTile
						label="Avg SEO"
						value={data.avgSeo == null ? "—" : `${Math.round(data.avgSeo)}/100`}
						sub="last 10 uploads"
					/>
				</StatGrid>
				{chart.length >= 2 ? (
					<div className="flex flex-col gap-1">
						<Eyebrow>Views per upload (oldest → newest)</Eyebrow>
						<AreaChart data={chart} height={120} valueLabel="views" />
					</div>
				) : null}
			</Section>

			<Section
				title="Best time to post"
				icon={CalendarClock}
				description="From this channel's own uploads: weekday/hour slots (your local time) ranked by average outlier score."
			>
				{data.slots.length === 0 ? (
					<div className="text-muted-foreground text-xs">
						Not enough dated uploads yet.
					</div>
				) : (
					<ol className="flex flex-col gap-1">
						{data.slots.map((s, i) => (
							<li
								key={`${s.weekday}-${s.hour}`}
								className="flex items-center gap-2 text-xs"
							>
								<span className="text-muted-foreground w-4 font-semibold">
									{i + 1}
								</span>
								<span className="flex-1 font-medium">
									{WEEKDAYS[s.weekday]} · {formatHour(s.hour)}
								</span>
								<OutlierBadge score={s.avgOutlier} />
								<span className="text-muted-foreground w-14 text-right text-[11px]">
									{s.count} upload{s.count === 1 ? "" : "s"}
								</span>
							</li>
						))}
					</ol>
				)}
				<div className="grid grid-cols-7 gap-1">
					{data.weekdays.map((w) => (
						<div key={w.weekday} className="flex flex-col items-center gap-1">
							<div className="bg-surface-2 flex h-14 w-full items-end overflow-hidden rounded-lg">
								<div
									className="bg-brand/70 w-full rounded-md transition-[height] duration-200"
									style={{
										height: `${((w.avgOutlier ?? 0) / maxWeekday) * 100}%`,
									}}
									title={`${WEEKDAYS[w.weekday]}: ${formatOutlier(w.avgOutlier)} avg over ${w.count} uploads`}
								/>
							</div>
							<span className="text-muted-foreground text-[10px]">
								{WEEKDAYS[w.weekday]?.slice(0, 2)}
							</span>
						</div>
					))}
				</div>
			</Section>

			<Section
				title="Top outliers"
				icon={Zap}
				description="Uploads that beat the channel's median the most."
			>
				{top.length === 0 ? (
					<div className="text-muted-foreground text-xs">No data.</div>
				) : (
					top.map((v) => (
						<VideoRow
							key={v.videoId}
							video={v}
							badges={
								<>
									<OutlierBadge score={v.outlier} />
									<VphBadge vph={v.vph} />
								</>
							}
						/>
					))
				)}
			</Section>

			<Section
				title="Underperformers"
				icon={TrendingDown}
				description="Under 0.7x the median: worth a new title or thumbnail?"
			>
				{under.length === 0 ? (
					<div className="text-muted-foreground text-xs">
						No upload in the last 30 fell well below the median. Consistent!
					</div>
				) : (
					under.map((v) => (
						<VideoRow
							key={v.videoId}
							video={v}
							badges={<OutlierBadge score={v.outlier} />}
						/>
					))
				)}
			</Section>

			<Section title="SEO of the latest uploads" icon={Gauge}>
				<div className="flex flex-col gap-2">
					{data.videos.slice(0, 10).map((v) => {
						const failed = v.seo.checks.filter((ch) => !ch.passed);
						return (
							<div
								key={v.videoId}
								className="border-border/60 flex flex-col gap-1 border-b pb-2 last:border-0"
							>
								<div className="flex items-start gap-2">
									<ScoreBadge score={v.seo.score} title="SEO score" />
									<button
										type="button"
										onClick={(e) =>
											openLink(
												`https://www.youtube.com/watch?v=${v.videoId}`,
												e,
											)
										}
										className="ovq-clamp-2 hover:text-brand focus-visible:ring-ring/50 min-w-0 flex-1 rounded-sm text-left text-xs leading-snug transition-colors duration-150 outline-none focus-visible:ring-2"
									>
										{v.title}
									</button>
									<span className="text-muted-foreground shrink-0 text-[10px]">
										{v.publishedAt ? formatRelative(v.publishedAt) : ""}
									</span>
								</div>
								{failed.length ? (
									<Collapsible
										summary={`${failed.length} fix${failed.length === 1 ? "" : "es"}`}
									>
										<ul className="flex flex-col gap-1 pl-1">
											{failed.map((ch) => (
												<li
													key={ch.id}
													className="text-muted-foreground text-[11px] leading-relaxed"
												>
													<span className="text-foreground">{ch.label}:</span>{" "}
													{ch.hint}
												</li>
											))}
										</ul>
									</Collapsible>
								) : null}
							</div>
						);
					})}
				</div>
			</Section>

			<Section
				title="AI audit"
				icon={Sparkles}
				actions={
					<Button
						size="xs"
						onClick={() => void report.run(data)}
						disabled={report.loading}
					>
						<Sparkles /> {report.data ? "Re-run" : "Run AI audit"}
					</Button>
				}
			>
				<AiSetupNotice />
				{report.error ? (
					<ErrorNotice
						error={report.error}
						onRetry={() => void report.run(data)}
					/>
				) : report.loading ? (
					<LoadingBlock label="Auditing the channel…" />
				) : report.data ? (
					<AiAudit data={report.data} />
				) : (
					<div className="text-muted-foreground text-xs">
						A prioritized action plan from these numbers: strengths, weaknesses,
						content pillars and next steps.
					</div>
				)}
			</Section>
		</>
	);
}

function AiAudit({ data }: { data: AuditOutput }) {
	return (
		<div className="flex flex-col gap-3 text-xs">
			<div className="flex items-center gap-2">
				<Badge
					tone={scoreTone(data.score)}
					className="h-7 rounded-lg px-2.5 text-base"
				>
					{data.score}
				</Badge>
				<span className="text-muted-foreground text-[11px]">
					growth readiness / 100
				</span>
			</div>
			<p className="leading-relaxed">{data.summary}</p>
			<div className="grid gap-3 min-[460px]:grid-cols-2">
				<div className="flex flex-col gap-1">
					<Eyebrow className="text-emerald-600 dark:text-emerald-400">
						Strengths
					</Eyebrow>
					<ul className="list-disc pl-4 leading-relaxed">
						{data.strengths.map((s) => (
							<li key={s}>{s}</li>
						))}
					</ul>
				</div>
				<div className="flex flex-col gap-1">
					<Eyebrow className="text-red-600 dark:text-red-400">
						Weaknesses
					</Eyebrow>
					<ul className="list-disc pl-4 leading-relaxed">
						{data.weaknesses.map((s) => (
							<li key={s}>{s}</li>
						))}
					</ul>
				</div>
			</div>
			<div className="flex flex-col gap-1.5">
				<Eyebrow>Action plan</Eyebrow>
				<ol className="flex flex-col gap-1.5">
					{data.actions.map((a, i) => (
						<li
							key={a.title}
							className="bg-surface-2 flex gap-2 rounded-lg p-2.5"
						>
							<span className="text-muted-foreground font-semibold">
								{i + 1}
							</span>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<div className="flex items-center gap-1.5">
									<span className="font-medium">{a.title}</span>
									<Badge
										tone={
											a.impact === "high"
												? "emerald"
												: a.impact === "medium"
													? "amber"
													: "neutral"
										}
										className={cn("ml-auto")}
									>
										{a.impact}
									</Badge>
								</div>
								<span className="text-muted-foreground leading-relaxed">
									{a.detail}
								</span>
							</div>
						</li>
					))}
				</ol>
			</div>
			{data.contentPillars.length ? (
				<div className="flex flex-col gap-1">
					<Eyebrow>Content pillars</Eyebrow>
					<div className="flex flex-wrap gap-1">
						{data.contentPillars.map((p) => (
							<Badge key={p} tone="brand">
								{p}
							</Badge>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}
