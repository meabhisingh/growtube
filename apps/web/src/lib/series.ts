import type { ChannelHistoryPoint, VideoHistoryPoint } from "@growtube/shared";

import type { ChartPoint } from "@/components/charts/area-chart";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function sortByTime<T extends ChartPoint>(points: readonly T[]): T[] {
	return [...points]
		.filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value))
		.sort((a, b) => a.t - b.t);
}

/** Cumulative views as chart points. */
export function viewsSeries(
	points: readonly VideoHistoryPoint[],
): ChartPoint[] {
	return sortByTime(
		points.map((p) => ({ t: Date.parse(p.t), value: p.views })),
	);
}

/**
 * Views gained per hour between snapshots. Snapshots closer than
 * `minGapHours` are merged so crowdsourced bursts don't make the line spiky.
 */
export function vphSeries(
	points: readonly VideoHistoryPoint[],
	minGapHours = 1,
): ChartPoint[] {
	const sorted = viewsSeries(points);
	const out: ChartPoint[] = [];
	let anchor = sorted[0];
	for (const p of sorted.slice(1)) {
		if (!anchor) break;
		const hours = (p.t - anchor.t) / HOUR_MS;
		if (hours < minGapHours) continue;
		out.push({ t: p.t, value: Math.max(p.value - anchor.value, 0) / hours });
		anchor = p;
	}
	return out;
}

export type ChannelMetric = "subscribers" | "totalViews" | "videoCount";

/** UTC midnight of a YYYY-MM-DD day, as ms. */
export function dayToMs(day: string): number {
	return Date.parse(`${day}T00:00:00Z`);
}

export function channelSeries(
	points: readonly ChannelHistoryPoint[],
	metric: ChannelMetric,
): ChartPoint[] {
	const out: ChartPoint[] = [];
	for (const p of points) {
		const value = p[metric];
		if (value != null) out.push({ t: dayToMs(p.day), value });
	}
	return sortByTime(out);
}

export function latest(series: readonly ChartPoint[]): ChartPoint | undefined {
	return series.at(-1);
}

/**
 * Change over the last `days` days of a (sorted) series, measured from the
 * oldest point inside the window. Null when the window has < 2 points.
 */
export function gainOver(
	series: readonly ChartPoint[],
	days: number,
): number | null {
	const last = series.at(-1);
	if (!last) return null;
	const cutoff = last.t - days * DAY_MS;
	const first = series.find((p) => p.t >= cutoff);
	if (!first || first === last) return null;
	return last.value - first.value;
}

/** Keeps points newer than `days` days before the latest point. */
export function lastDays<T extends ChartPoint>(
	series: readonly T[],
	days: number | null,
): T[] {
	const last = series.at(-1);
	if (!last || days == null) return [...series];
	const cutoff = last.t - days * DAY_MS;
	return series.filter((p) => p.t >= cutoff);
}
