/** Views tab: engagement / outlier / VPH pills and the "Views over time" chart. */
import type { HistoryRange, VideoHistoryResponse } from "@growtube/shared/api";
import {
	formatCompact,
	formatNumber,
	formatOutlier,
	formatPercent,
} from "@growtube/shared/format";
import { outlierTier } from "@growtube/shared/metrics";
import { useMemo, useState } from "react";

import { AreaChart, type ChartPoint } from "@/components/common/AreaChart";
import { server } from "@/lib/client";
import type { VideoDetails } from "@/lib/youtube/types";
import { isPublicVideo } from "@/lib/youtube/visibility";

import { isServerUnavailable, useAsync } from "../common/async";
import { Card, ErrorNote, Note, Segmented, Skeleton, Stat } from "../common/ui";
import type { WatchData } from "./data";
import { ThumbnailCard } from "./ThumbnailCard";

const RANGES: readonly { id: HistoryRange; label: string }[] = [
	{ id: "24h", label: "24 hours" },
	{ id: "7d", label: "1st 7 days" },
	{ id: "28d", label: "1st 28 days" },
	{ id: "all", label: "All" },
];

const RANGE_HOURS: Record<HistoryRange, number> = {
	"24h": 24,
	"7d": 7 * 24,
	"28d": 28 * 24,
	all: Number.POSITIVE_INFINITY,
};

const HOUR = 3_600_000;

function defaultRange(publishedAt: string | null | undefined): HistoryRange {
	if (!publishedAt) return "all";
	const age = (Date.now() - Date.parse(publishedAt)) / HOUR;
	if (age <= 24) return "24h";
	if (age <= 7 * 24) return "7d";
	if (age <= 28 * 24) return "28d";
	return "all";
}

type Series = {
	points: ChartPoint[];
	snapshots: number;
	liveIncluded: boolean;
};

/**
 * Server snapshots for the window (relative to publish, like "first 7 days"),
 * anchored at 0 views at publish time, plus the live count when "now" is
 * inside the window.
 */
function buildSeries(
	range: HistoryRange,
	history: VideoHistoryResponse | undefined,
	details: VideoDetails,
): Series {
	const publishedIso = details.publishedAt ?? history?.publishedAt ?? null;
	const published = publishedIso ? Date.parse(publishedIso) : null;
	const end =
		published != null
			? published + RANGE_HOURS[range] * HOUR
			: Number.POSITIVE_INFINITY;
	const now = Date.now();
	const pts = (history?.points ?? [])
		.map((p) => ({ x: Date.parse(p.t), y: p.views }))
		.filter((p) => Number.isFinite(p.x) && p.x <= end)
		.sort((a, b) => a.x - b.x);
	const out: { x: number; y: number }[] = [];
	if (published != null && (pts[0]?.x ?? now) > published)
		out.push({ x: published, y: 0 });
	out.push(...pts);
	const last = out.at(-1);
	const liveIncluded = now <= end && (!last || now - last.x > 60_000);
	if (liveIncluded) out.push({ x: now, y: details.views });
	return { points: out, snapshots: pts.length, liveIncluded };
}

function formatAxis(range: HistoryRange) {
	return (x: number) => {
		const d = new Date(x);
		if (range === "24h")
			return d.toLocaleTimeString(undefined, {
				hour: "numeric",
				minute: "2-digit",
			});
		return d.toLocaleDateString(undefined, {
			month: "short",
			day: "numeric",
			...(range === "all" ? { year: "2-digit" } : {}),
		});
	};
}

export function ViewsTab({ w }: { w: WatchData }) {
	const d = w.details.data;
	const m = w.metrics;
	const [rangeChoice, setRange] = useState<HistoryRange | null>(null);
	const range = rangeChoice ?? defaultRange(d?.publishedAt);
	// Waits for details so the default range matches the video's age, and
	// to know the video is public (unlisted/private ids never reach the server).
	const history = useAsync(
		() => server.getVideoHistory(w.videoId, range),
		[w.videoId, range],
		!!d && isPublicVideo(d),
	);

	const series = useMemo(
		() => (d ? buildSeries(range, history.data, d) : null),
		[range, history.data, d],
	);

	const tier = outlierTier(m?.outlierScore);
	const baselineLoading =
		w.baseline.loading || (w.channel.loading && !w.baseline.data);
	const fmtX = useMemo(() => formatAxis(range), [range]);

	return (
		<div>
			<div className="ovq-stats">
				<Stat
					label="Engagement"
					loading={!m}
					value={formatPercent(m?.engagementRate, 2)}
					hint="(Likes + comments) ÷ views"
				/>
				<Stat
					label="Outlier"
					loading={!m || (baselineLoading && m.outlierScore == null)}
					value={formatOutlier(m?.outlierScore)}
					tone={tier}
					hint={
						m?.baseline
							? `Views ÷ the channel's median of ${formatCompact(m.baseline)} views for recent ${m.format === "short" ? "Shorts" : "long-form videos"}`
							: "Not enough recent uploads of this format to compute a baseline"
					}
				/>
				<Stat
					label="VPH"
					loading={!m}
					value={m?.vph != null ? formatCompact(m.vph, 1) : "—"}
					hint={
						m?.vphSource === "recent"
							? "Views per hour over the last ~48h (GrowTube server)"
							: "Average views per hour since upload"
					}
				/>
			</div>

			<Card
				title="Views over time"
				actions={
					history.loading && d ? (
						<span
							className="ovq-spinner"
							aria-label="Loading history"
							role="status"
						/>
					) : null
				}
			>
				<div className="ovq-chart-head">
					<Segmented
						label="Time range"
						options={RANGES}
						value={range}
						onChange={setRange}
					/>
				</div>
				{!d ? (
					w.details.error ? (
						<ErrorNote error={w.details.error} onRetry={w.details.reload} />
					) : (
						<Skeleton height={150} radius="inner" />
					)
				) : (
					<>
						<AreaChart
							data={series?.points ?? []}
							height={150}
							valueLabel="views"
							formatX={fmtX}
							formatY={(y) => formatCompact(y, 1)}
							ariaLabel={`Views over time, ${RANGES.find((r) => r.id === range)?.label}`}
							emptyText={
								range === "all"
									? "No history yet"
									: "No snapshots from this window yet. Try All."
							}
						/>
						<div className="ovq-small ovq-muted" style={{ marginTop: 6 }}>
							{formatNumber(d.views)} views now
							{series && series.snapshots > 0
								? ` · ${series.snapshots} snapshot${series.snapshots === 1 ? "" : "s"}`
								: ""}
						</div>
						{!isPublicVideo(d) ? (
							<Note>
								This video is unlisted or private, so GrowTube neither uploads
								it nor asks the server about it: there is no view history for
								it.
							</Note>
						) : history.error ? (
							isServerUnavailable(history.error) ? (
								<Note tone="warn">
									View history comes from the GrowTube server, which isn't
									reachable right now. The live count is still shown.
								</Note>
							) : (
								<ErrorNote
									error={history.error}
									onRetry={history.reload}
									prefix="Couldn't load history."
								/>
							)
						) : series && series.snapshots < 3 && !history.loading ? (
							<Note>
								Tracking started; history fills in as this video gets views.
							</Note>
						) : null}
					</>
				)}
			</Card>

			{d && <ThumbnailCard details={d} />}
		</div>
	);
}
