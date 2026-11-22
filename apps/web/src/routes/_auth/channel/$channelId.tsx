import {
	type ChannelHistoryResponse,
	channelUrl,
	formatCompact,
	formatNumber,
	isChannelId,
} from "@growtube/shared";
import { isYouTubeImageUrl } from "@growtube/shared/images";
import { buttonVariants } from "@growtube/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@growtube/ui/components/card";
import { Skeleton } from "@growtube/ui/components/skeleton";
import { cn } from "@growtube/ui/lib/utils";
import {
	createFileRoute,
	Link,
	stripSearchParams,
	useLocation,
} from "@tanstack/react-router";
import {
	CalendarDays,
	Clapperboard,
	ExternalLink,
	Eye,
	History,
	SearchX,
	TrendingUp,
	Users,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { z } from "zod";

import { AreaChart } from "@/components/charts/area-chart";
import { LookupForm } from "@/components/lookup-form";
import { Segmented, type SegmentedOption } from "@/components/segmented";
import { StatTile } from "@/components/stat-tile";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states";
import { ApiError, getChannelHistory } from "@/lib/api";
import { channelSeries, dayToMs, gainOver, lastDays } from "@/lib/series";
import { useApi } from "@/lib/use-api";

const searchDefaults = { metric: "subs", period: "all" } as const;

const channelSearchSchema = z.object({
	metric: z
		.enum(["subs", "views"])
		.default(searchDefaults.metric)
		.catch(searchDefaults.metric),
	period: z
		.enum(["28d", "90d", "1y", "all"])
		.default(searchDefaults.period)
		.catch(searchDefaults.period),
});

type ChannelSearch = z.output<typeof channelSearchSchema>;

export const Route = createFileRoute("/_auth/channel/$channelId")({
	validateSearch: channelSearchSchema,
	search: { middlewares: [stripSearchParams(searchDefaults)] },
	head: () => ({ meta: [{ title: "Channel stats · GrowTube" }] }),
	component: ChannelPage,
});

const metricOptions: readonly SegmentedOption<ChannelSearch["metric"]>[] = [
	{ value: "subs", label: "Subscribers" },
	{ value: "views", label: "Total views" },
];

const periodOptions: readonly SegmentedOption<ChannelSearch["period"]>[] = [
	{ value: "28d", label: "28 days" },
	{ value: "90d", label: "90 days" },
	{ value: "1y", label: "1 year" },
	{ value: "all", label: "All" },
];

const PERIOD_DAYS: Record<ChannelSearch["period"], number | null> = {
	"28d": 28,
	"90d": 90,
	"1y": 365,
	all: null,
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeZone: "UTC",
});

function ChannelPage() {
	const { channelId } = Route.useParams();
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
			<LookupForm />
			{isChannelId(channelId) ? (
				<ChannelStats key={channelId} channelId={channelId} />
			) : (
				<EmptyState
					role="alert"
					icon={SearchX}
					title="That isn't a YouTube channel ID"
					description="Channel IDs start with UC and are 24 characters long. Paste the channel's youtube.com/channel/UC… link above."
				/>
			)}
		</div>
	);
}

function ChannelStats({ channelId }: { channelId: string }) {
	const { metric, period } = Route.useSearch();
	const navigate = Route.useNavigate();
	const linkTitle = useLocation({
		select: (location) => location.state.channelTitle,
	});

	const history = useApi(`channel-history:${channelId}`, (signal) =>
		getChannelHistory(channelId, signal),
	);
	// The server's name wins over whatever the previous page passed along.
	const channelTitle = history.data?.title ?? linkTitle ?? null;
	const handle = history.data?.handle ?? null;
	// Avatars come from crowdsourced reports, so only YouTube's own image
	// hosts are loaded; anything else shows the initial instead.
	const rawAvatarUrl = history.data?.avatarUrl;
	const avatarUrl = isYouTubeImageUrl(rawAvatarUrl) ? rawAvatarUrl : null;
	// Avatar URLs expire; fall back to the initial when one fails to load.
	const [brokenAvatar, setBrokenAvatar] = useState<string | null>(null);
	const setSearch = (patch: Partial<ChannelSearch>) =>
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

	const notTracked =
		(history.error instanceof ApiError && history.error.isNotFound) ||
		(history.data != null && history.data.points.length === 0);

	return (
		<>
			<section
				className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
				aria-labelledby="channel-title"
			>
				<div className="flex min-w-0 items-center gap-4">
					{avatarUrl && brokenAvatar !== avatarUrl ? (
						<img
							src={avatarUrl}
							alt=""
							width={56}
							height={56}
							referrerPolicy="no-referrer"
							onError={() => setBrokenAvatar(avatarUrl)}
							className="bg-muted ring-foreground/10 size-14 shrink-0 rounded-full object-cover ring-1"
						/>
					) : (
						<div
							aria-hidden="true"
							className="bg-muted ring-foreground/10 flex size-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold uppercase ring-1"
						>
							{(channelTitle ?? "?").replace(/^@/, "").charAt(0) || "?"}
						</div>
					)}
					<div className="flex min-w-0 flex-col gap-1">
						<p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
							Channel stats
						</p>
						<h1
							id="channel-title"
							className="truncate text-xl font-semibold tracking-tight md:text-2xl"
						>
							{channelTitle ?? "YouTube channel"}
						</h1>
						<p className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
							{handle && <span className="truncate">{handle}</span>}
							<code className="truncate font-mono">{channelId}</code>
						</p>
					</div>
				</div>
				<a
					href={channelUrl(channelId)}
					target="_blank"
					rel="noreferrer"
					className={cn(
						buttonVariants({ variant: "default" }),
						"self-start sm:self-auto",
					)}
				>
					View on YouTube
					<ExternalLink aria-hidden="true" data-icon="inline-end" />
				</a>
			</section>

			{notTracked ? (
				<EmptyState
					icon={History}
					title="GrowTube hasn't tracked this channel yet"
					description="Channel history is built from public numbers that extension users see on YouTube, one point per day. Visit the channel with the extension installed to start tracking it."
				>
					<a
						href={channelUrl(channelId)}
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
			) : history.error && !history.data ? (
				<ErrorState
					title="Couldn't load this channel's history"
					error={history.error}
					onRetry={history.refetch}
					retrying={history.isFetching}
				/>
			) : (
				<>
					{history.error && history.data && (
						<StaleBanner error={history.error} onRetry={history.refetch} />
					)}
					<ChannelOverview
						data={history.data}
						metric={metric}
						period={period}
						onMetricChange={(value) => setSearch({ metric: value })}
						onPeriodChange={(value) => setSearch({ period: value })}
					/>
				</>
			)}
		</>
	);
}

function signed(value: number | null): string {
	if (value == null) return "—";
	const abs = formatCompact(Math.abs(value), 2);
	return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : "0";
}

interface ChannelOverviewProps {
	data: ChannelHistoryResponse | undefined;
	metric: ChannelSearch["metric"];
	period: ChannelSearch["period"];
	onMetricChange: (metric: ChannelSearch["metric"]) => void;
	onPeriodChange: (period: ChannelSearch["period"]) => void;
}

function ChannelOverview({
	data,
	metric,
	period,
	onMetricChange,
	onPeriodChange,
}: ChannelOverviewProps) {
	const loading = data === undefined;
	const subs = useMemo(
		() => channelSeries(data?.points ?? [], "subscribers"),
		[data],
	);
	const views = useMemo(
		() => channelSeries(data?.points ?? [], "totalViews"),
		[data],
	);
	const videos = useMemo(
		() => channelSeries(data?.points ?? [], "videoCount"),
		[data],
	);

	const active = metric === "subs" ? subs : views;
	const visible = useMemo(
		() => lastDays(active, PERIOD_DAYS[period]),
		[active, period],
	);
	const firstDay = data?.points.reduce<string | null>(
		(min, p) => (min == null || p.day < min ? p.day : min),
		null,
	);

	const latestSubs = subs.at(-1)?.value ?? null;
	const latestViews = views.at(-1)?.value ?? null;
	const latestVideos = videos.at(-1)?.value ?? null;

	let chartBody: ReactNode;
	if (loading) {
		chartBody = <Skeleton className="h-[260px] w-full rounded-lg" />;
	} else if (visible.length === 0) {
		chartBody = (
			<EmptyState
				icon={TrendingUp}
				title={
					metric === "subs"
						? "No subscriber counts recorded"
						: "No total-view counts recorded"
				}
				description={
					metric === "subs"
						? "This channel may hide its subscriber count. Try total views instead."
						: "Total views appear once someone opens the channel's About panel with the extension."
				}
				className="min-h-[260px]"
			>
				<button
					type="button"
					className={buttonVariants({ variant: "outline" })}
					onClick={() => onMetricChange(metric === "subs" ? "views" : "subs")}
				>
					Show {metric === "subs" ? "total views" : "subscribers"}
				</button>
			</EmptyState>
		);
	} else {
		chartBody = (
			<AreaChart
				data={visible}
				label={metric === "subs" ? "Subscribers" : "Total views"}
				height={260}
				timeFormat="date"
			/>
		);
	}

	return (
		<>
			<section
				aria-label="Current stats"
				className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
			>
				<StatTile
					icon={Users}
					label="Subscribers"
					loading={loading}
					value={formatCompact(latestSubs, 2)}
					title={formatNumber(latestSubs)}
				/>
				<StatTile
					icon={TrendingUp}
					label="Subs, 28 days"
					loading={loading}
					value={signed(gainOver(subs, 28))}
					hint="change in tracked period"
				/>
				<StatTile
					icon={Eye}
					label="Total views"
					loading={loading}
					value={formatCompact(latestViews, 2)}
					title={formatNumber(latestViews)}
				/>
				<StatTile
					icon={TrendingUp}
					label="Views, 28 days"
					loading={loading}
					value={signed(gainOver(views, 28))}
					hint="change in tracked period"
				/>
				<StatTile
					icon={Clapperboard}
					label="Videos"
					loading={loading}
					value={formatNumber(latestVideos)}
				/>
				<StatTile
					icon={CalendarDays}
					label="Tracked since"
					loading={loading}
					value={firstDay ? dayFormat.format(dayToMs(firstDay)) : "—"}
					hint={
						data
							? `${data.points.length} day${data.points.length === 1 ? "" : "s"} of data`
							: undefined
					}
				/>
			</section>

			<Card>
				<CardHeader className="gap-3 md:grid-cols-[1fr_auto]">
					<div className="flex flex-col gap-1">
						<CardTitle className="text-base">
							{metric === "subs"
								? "Subscribers over time"
								: "Total views over time"}
						</CardTitle>
						<CardDescription>
							One crowdsourced data point per day (UTC).
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
							label="Period"
							value={period}
							options={periodOptions}
							onChange={onPeriodChange}
						/>
					</div>
				</CardHeader>
				<CardContent>{chartBody}</CardContent>
			</Card>

			{data && data.points.length > 1 && <DailyTable data={data} />}
		</>
	);
}

interface DailyRow {
	day: string;
	subscribers: number | null;
	subsDelta: number | null;
	totalViews: number | null;
	viewsDelta: number | null;
	videoCount: number | null;
}

function buildDailyRows(
	data: ChannelHistoryResponse,
	limit: number,
): DailyRow[] {
	const sorted = [...data.points].sort((a, b) => a.day.localeCompare(b.day));
	const rows: DailyRow[] = sorted.map((p, i) => {
		const prev = sorted[i - 1];
		const delta = (cur: number | null, before: number | null | undefined) =>
			cur != null && before != null ? cur - before : null;
		return {
			day: p.day,
			subscribers: p.subscribers,
			subsDelta: delta(p.subscribers, prev?.subscribers),
			totalViews: p.totalViews,
			viewsDelta: delta(p.totalViews, prev?.totalViews),
			videoCount: p.videoCount,
		};
	});
	return rows.reverse().slice(0, limit);
}

function Delta({ value }: { value: number | null }) {
	if (value == null) return <span className="text-muted-foreground">—</span>;
	return (
		<span
			className={cn(
				"tabular-nums",
				value > 0 && "text-emerald-700 dark:text-emerald-400",
				value < 0 && "text-red-700 dark:text-red-400",
				value === 0 && "text-muted-foreground",
			)}
			title={formatNumber(value)}
		>
			{signed(value)}
		</span>
	);
}

function DailyTable({ data }: { data: ChannelHistoryResponse }) {
	const rows = useMemo(() => buildDailyRows(data, 14), [data]);
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Daily changes</CardTitle>
				<CardDescription>
					The most recent {rows.length} tracked days. Each change is measured
					from the previous tracked day.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="border-border/80 overflow-x-auto rounded-lg border">
					<table className="w-full min-w-[560px] text-left text-xs">
						<thead className="bg-muted/40 text-muted-foreground">
							<tr className="border-b">
								<th scope="col" className="px-3 py-2 font-medium">
									Date (UTC)
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Subscribers
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Change
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Total views
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Change
								</th>
								<th scope="col" className="px-3 py-2 text-right font-medium">
									Videos
								</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr
									key={row.day}
									className="hover:bg-muted/30 border-b transition-colors last:border-0"
								>
									<th scope="row" className="px-3 py-2 font-normal">
										{dayFormat.format(dayToMs(row.day))}
									</th>
									<td
										className="px-3 py-2 text-right tabular-nums"
										title={formatNumber(row.subscribers)}
									>
										{formatCompact(row.subscribers, 2)}
									</td>
									<td className="px-3 py-2 text-right">
										<Delta value={row.subsDelta} />
									</td>
									<td
										className="px-3 py-2 text-right tabular-nums"
										title={formatNumber(row.totalViews)}
									>
										{formatCompact(row.totalViews, 2)}
									</td>
									<td className="px-3 py-2 text-right">
										<Delta value={row.viewsDelta} />
									</td>
									<td className="px-3 py-2 text-right tabular-nums">
										{formatNumber(row.videoCount)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}
