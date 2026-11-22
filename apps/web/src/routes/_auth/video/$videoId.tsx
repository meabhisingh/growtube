import {
	computeEngagementRate,
	computeVph,
	formatCompact,
	formatNumber,
	formatPercent,
	formatRelative,
	type HistoryRange,
	historyRangeSchema,
	isVideoId,
	thumbnailUrl,
	type VideoHistoryResponse,
	videoUrl,
} from "@open-vidiq/shared";
import { buttonVariants } from "@open-vidiq/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@open-vidiq/ui/components/card";
import { Skeleton } from "@open-vidiq/ui/components/skeleton";
import { cn } from "@open-vidiq/ui/lib/utils";
import {
	createFileRoute,
	Link,
	stripSearchParams,
	useLocation,
} from "@tanstack/react-router";
import {
	Activity,
	CalendarDays,
	ChartLine,
	ExternalLink,
	Eye,
	Gauge,
	History,
	MessageCircle,
	Percent,
	SearchX,
	ThumbsUp,
	Users,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { z } from "zod";

import { AreaChart } from "@/components/charts/area-chart";
import { LookupForm } from "@/components/lookup-form";
import { Segmented, type SegmentedOption } from "@/components/segmented";
import { StatTile } from "@/components/stat-tile";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states";
import { ApiError, getVideoHistory } from "@/lib/api";
import { getVideoMeta } from "@/lib/oembed";
import { viewsSeries, vphSeries } from "@/lib/series";
import { useApi } from "@/lib/use-api";

const searchDefaults = { range: "all", metric: "views" } as const;

const videoSearchSchema = z.object({
	range: historyRangeSchema
		.default(searchDefaults.range)
		.catch(searchDefaults.range),
	metric: z
		.enum(["views", "vph"])
		.default(searchDefaults.metric)
		.catch(searchDefaults.metric),
});

type VideoSearch = z.output<typeof videoSearchSchema>;

export const Route = createFileRoute("/_auth/video/$videoId")({
	validateSearch: videoSearchSchema,
	search: { middlewares: [stripSearchParams(searchDefaults)] },
	head: () => ({ meta: [{ title: "Video stats · open-vidiq" }] }),
	component: VideoPage,
});

const rangeOptions: readonly SegmentedOption<HistoryRange>[] = [
	{
		value: "24h",
		label: "24 hours",
		title: "The first 24 hours after publishing",
	},
	{
		value: "7d",
		label: "1st 7 days",
		title: "The first 7 days after publishing",
	},
	{
		value: "28d",
		label: "1st 28 days",
		title: "The first 28 days after publishing",
	},
	{ value: "all", label: "All", title: "Every snapshot we have" },
];

const metricOptions: readonly SegmentedOption<VideoSearch["metric"]>[] = [
	{ value: "views", label: "Views" },
	{ value: "vph", label: "Views / hour" },
];

const RANGE_TEXT: Record<HistoryRange, string> = {
	"24h": "the first 24 hours",
	"7d": "the first 7 days",
	"28d": "the first 28 days",
	all: "all tracked time",
};

const vphValue = (value: number) => `${formatNumber(value)}/h`;
const publishedDate = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function VideoPage() {
	const { videoId } = Route.useParams();
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
			<LookupForm />
			{isVideoId(videoId) ? (
				<VideoStats key={videoId} videoId={videoId} />
			) : (
				<EmptyState
					role="alert"
					icon={SearchX}
					title="That isn't a YouTube video ID"
					description="Video IDs are 11 characters, like dQw4w9WgXcQ. Paste the full YouTube link above and we'll find it."
				/>
			)}
		</div>
	);
}

function VideoStats({ videoId }: { videoId: string }) {
	const { range, metric } = Route.useSearch();
	const navigate = Route.useNavigate();
	const linkState = useLocation({ select: (location) => location.state });

	const meta = useApi(
		`oembed:${videoId}`,
		(signal) => getVideoMeta(videoId, signal),
		{
			staleMs: 30 * 60_000,
		},
	);
	const overall = useApi(`video-history:${videoId}:all`, (signal) =>
		getVideoHistory(videoId, "all", signal),
	);
	const ranged = useApi(
		range === "all" ? null : `video-history:${videoId}:${range}`,
		(signal) => getVideoHistory(videoId, range, signal),
		{ keepPrevious: true },
	);
	const chart = range === "all" ? overall : ranged;

	const setSearch = (patch: Partial<VideoSearch>) =>
		navigate({
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
			resetScroll: false,
			// keep names passed from the previous page (e.g. a trending card)
			state: ({ videoTitle, channelId, channelTitle }) => ({
				videoTitle,
				channelId,
				channelTitle,
			}),
		});

	// Names: YouTube oEmbed first, then what the server knows, then whatever
	// the previous page passed along.
	const title =
		meta.data?.title ?? overall.data?.title ?? linkState.videoTitle ?? null;
	const channelName =
		meta.data?.channelName ??
		overall.data?.channelTitle ??
		linkState.channelTitle ??
		null;
	const notTracked =
		(overall.error instanceof ApiError && overall.error.isNotFound) ||
		(overall.data != null && overall.data.points.length === 0);

	return (
		<>
			<VideoHeader
				videoId={videoId}
				title={title}
				titleLoading={
					meta.isPending && !linkState.videoTitle && !overall.data?.title
				}
				channelName={channelName}
				channelUrl={meta.data?.channelUrl ?? null}
				channelId={linkState.channelId ?? overall.data?.channelId ?? null}
				history={overall.data}
			/>

			{notTracked ? (
				<NotTrackedState videoId={videoId} />
			) : overall.error && !overall.data ? (
				<ErrorState
					title="Couldn't load this video's stats"
					error={overall.error}
					onRetry={overall.refetch}
					retrying={overall.isFetching}
				/>
			) : (
				<>
					{overall.error && overall.data && (
						<StaleBanner error={overall.error} onRetry={overall.refetch} />
					)}
					<StatsGrid history={overall.data} />
					<ChartCard
						range={range}
						metric={metric}
						onRangeChange={(value) => setSearch({ range: value })}
						onMetricChange={(value) => setSearch({ metric: value })}
						history={chart.data}
						isPending={chart.isPending}
						isFetching={chart.isFetching}
						error={chart.error}
						onRetry={chart.refetch}
					/>
				</>
			)}
		</>
	);
}

interface VideoHeaderProps {
	videoId: string;
	title: string | null;
	titleLoading: boolean;
	channelName: string | null;
	channelUrl: string | null;
	channelId: string | null;
	history: VideoHistoryResponse | undefined;
}

function VideoHeader({
	videoId,
	title,
	titleLoading,
	channelName,
	channelUrl,
	channelId,
	history,
}: VideoHeaderProps) {
	const publishedAt = history?.publishedAt;
	return (
		<section
			className="grid gap-5 md:grid-cols-[minmax(0,320px)_1fr]"
			aria-labelledby="video-title"
		>
			<a
				href={videoUrl(videoId)}
				target="_blank"
				rel="noreferrer"
				className="group bg-muted ring-foreground/10 relative block aspect-video overflow-hidden ring-1"
				aria-label="Watch on YouTube"
			>
				<img
					src={thumbnailUrl(videoId, "hqdefault")}
					alt=""
					referrerPolicy="no-referrer"
					className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
				/>
			</a>
			<div className="flex min-w-0 flex-col gap-3">
				<div className="flex flex-col gap-1">
					<p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
						Video stats
					</p>
					{titleLoading ? (
						<Skeleton className="h-7 w-3/4" />
					) : (
						<h1
							id="video-title"
							className="text-xl leading-snug font-semibold tracking-tight text-balance md:text-2xl"
						>
							{title ?? "YouTube video"}
						</h1>
					)}
					<div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
						{channelName &&
							(channelId ? (
								<Link
									to="/channel/$channelId"
									params={{ channelId }}
									state={{ channelTitle: channelName }}
									className="hover:text-foreground hover:underline"
								>
									{channelName}
								</Link>
							) : channelUrl ? (
								<a
									href={channelUrl}
									target="_blank"
									rel="noreferrer"
									className="hover:text-foreground hover:underline"
								>
									{channelName}
								</a>
							) : (
								<span>{channelName}</span>
							))}
						{publishedAt && (
							<span title={new Date(publishedAt).toLocaleString()}>
								Published {publishedDate.format(new Date(publishedAt))} (
								{formatRelative(publishedAt)})
							</span>
						)}
						<code className="font-mono text-xs">{videoId}</code>
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					<a
						href={videoUrl(videoId)}
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "default" })}
					>
						Watch on YouTube
						<ExternalLink aria-hidden="true" data-icon="inline-end" />
					</a>
					{channelId && (
						<Link
							to="/channel/$channelId"
							params={{ channelId }}
							state={{ channelTitle: channelName ?? undefined }}
							className={buttonVariants({ variant: "outline" })}
						>
							<Users aria-hidden="true" data-icon="inline-start" />
							Channel stats
						</Link>
					)}
				</div>
			</div>
		</section>
	);
}

function StatsGrid({ history }: { history: VideoHistoryResponse | undefined }) {
	const loading = history === undefined;
	const lastPoint = history?.points.at(-1);
	const views = lastPoint?.views ?? null;
	const lifetimeVph =
		views != null && history?.publishedAt
			? computeVph(views, history.publishedAt)
			: null;
	const engagement = computeEngagementRate({
		views,
		likes: lastPoint?.likes,
		comments: lastPoint?.comments,
	});

	return (
		<section
			aria-label="Current stats"
			className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
		>
			<StatTile
				icon={Eye}
				label="Views"
				loading={loading}
				value={formatCompact(views, 2)}
				title={formatNumber(views)}
				hint={
					lastPoint ? `as of ${formatRelative(lastPoint.t)}` : "no snapshot yet"
				}
			/>
			<StatTile
				icon={Activity}
				label="Views / hour"
				loading={loading}
				value={formatCompact(history?.recentVph)}
				title={
					history?.recentVph != null ? vphValue(history.recentVph) : undefined
				}
				hint={
					history?.recentVph != null
						? "recent momentum"
						: "needs 2+ recent snapshots"
				}
			/>
			<StatTile
				icon={Gauge}
				label="Avg views / hour"
				loading={loading}
				value={formatCompact(lifetimeVph)}
				title={lifetimeVph != null ? vphValue(lifetimeVph) : undefined}
				hint={lifetimeVph != null ? "since publishing" : "publish date unknown"}
			/>
			<StatTile
				icon={Percent}
				label="Engagement"
				loading={loading}
				value={formatPercent(engagement, 2)}
				hint="(likes + comments) / views"
			/>
			<StatTile
				icon={ThumbsUp}
				label="Likes"
				loading={loading}
				value={formatCompact(lastPoint?.likes, 2)}
				title={formatNumber(lastPoint?.likes)}
			/>
			<StatTile
				icon={MessageCircle}
				label="Comments"
				loading={loading}
				value={formatCompact(lastPoint?.comments, 2)}
				title={formatNumber(lastPoint?.comments)}
			/>
		</section>
	);
}

interface ChartCardProps {
	range: HistoryRange;
	metric: VideoSearch["metric"];
	onRangeChange: (range: HistoryRange) => void;
	onMetricChange: (metric: VideoSearch["metric"]) => void;
	history: VideoHistoryResponse | undefined;
	isPending: boolean;
	isFetching: boolean;
	error: Error | undefined;
	onRetry: () => void;
}

function ChartCard({
	range,
	metric,
	onRangeChange,
	onMetricChange,
	history,
	isPending,
	isFetching,
	error,
	onRetry,
}: ChartCardProps) {
	const points = history?.range === range ? history.points : undefined;
	const series = useMemo(() => {
		if (!points) return [];
		return metric === "views" ? viewsSeries(points) : vphSeries(points);
	}, [points, metric]);

	const first = points?.[0];
	const last = points?.at(-1);
	const gained =
		first && last && points && points.length > 1
			? last.views - first.views
			: null;
	const label = metric === "views" ? "Views" : "Views per hour";

	let body: ReactNode;
	if (isPending || (isFetching && !points)) {
		body = <Skeleton className="h-[260px] w-full" />;
	} else if (error && !points) {
		body = (
			<ErrorState
				title="Couldn't load this range"
				error={error}
				onRetry={onRetry}
				retrying={isFetching}
				className="h-[260px]"
			/>
		);
	} else if (!points || points.length === 0) {
		body = (
			<EmptyState
				icon={History}
				title={`No snapshots from ${RANGE_TEXT[range]}`}
				description={
					history?.firstSeenAt
						? `open-vidiq first saw this video ${formatRelative(history.firstSeenAt)}, so there's no data from ${RANGE_TEXT[range]} after publishing.`
						: "This range has no snapshots yet."
				}
				className="min-h-[260px]"
			>
				{range !== "all" && (
					<button
						type="button"
						className={buttonVariants({ variant: "outline" })}
						onClick={() => onRangeChange("all")}
					>
						Show all history
					</button>
				)}
			</EmptyState>
		);
	} else if (series.length === 0) {
		body = (
			<EmptyState
				icon={ChartLine}
				title="Not enough snapshots for views per hour"
				description="We need at least two snapshots an hour apart. Check back soon or switch to total views."
				className="min-h-[260px]"
			>
				<button
					type="button"
					className={buttonVariants({ variant: "outline" })}
					onClick={() => onMetricChange("views")}
				>
					Show total views
				</button>
			</EmptyState>
		);
	} else {
		body = (
			<div className={cn("transition-opacity", isFetching && "opacity-60")}>
				<AreaChart
					data={series}
					label={label}
					height={260}
					variant={metric === "views" ? "area" : "line"}
					formatValue={metric === "views" ? formatNumber : vphValue}
					zeroBaseline={metric === "vph"}
				/>
			</div>
		);
	}

	return (
		<Card>
			<CardHeader className="gap-3 md:grid-cols-[1fr_auto]">
				<div className="flex flex-col gap-1">
					<CardTitle className="text-base">
						{metric === "views" ? "Views over time" : "Views per hour"}
					</CardTitle>
					<CardDescription>
						{range === "all"
							? "Every crowdsourced snapshot of this video."
							: `Snapshots from ${RANGE_TEXT[range]} after publishing.`}
					</CardDescription>
				</div>
				<div className="flex flex-wrap gap-2 md:justify-end">
					<Segmented
						label="Metric"
						value={metric}
						options={metricOptions}
						onChange={onMetricChange}
					/>
					<Segmented
						label="Time range"
						value={range}
						options={rangeOptions}
						onChange={onRangeChange}
					/>
				</div>
			</CardHeader>
			<CardContent>{body}</CardContent>
			{points && points.length > 0 && (
				<CardFooter className="text-muted-foreground flex-wrap justify-between gap-2">
					<span className="flex items-center gap-1.5">
						<CalendarDays className="size-3.5" aria-hidden="true" />
						{points.length} snapshot{points.length === 1 ? "" : "s"}
						{history?.firstSeenAt &&
							` · first seen ${formatRelative(history.firstSeenAt)}`}
					</span>
					{gained != null && (
						<span className="tabular-nums">
							+{formatNumber(gained)} views in{" "}
							{range === "all" ? "this period" : RANGE_TEXT[range]}
						</span>
					)}
				</CardFooter>
			)}
		</Card>
	);
}

function NotTrackedState({ videoId }: { videoId: string }) {
	return (
		<EmptyState
			icon={History}
			title="open-vidiq hasn't tracked this video yet"
			description="View history is built from public stats that signed-in extension users see on YouTube. Open this video with the extension installed and tracking starts right away. Unlisted and private videos are never tracked."
		>
			<a
				href={videoUrl(videoId)}
				target="_blank"
				rel="noreferrer"
				className={buttonVariants({ variant: "default" })}
			>
				Open on YouTube
				<ExternalLink aria-hidden="true" data-icon="inline-end" />
			</a>
			<Link
				to="/"
				hash="install"
				className={buttonVariants({ variant: "outline" })}
			>
				Install the extension
			</Link>
		</EmptyState>
	);
}
