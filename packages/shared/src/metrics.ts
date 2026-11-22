/**
 * Core creator metrics. Pure functions, no I/O — used by the extension
 * (badges, watch panel), the server (trending, history) and the web app, so
 * the same number is shown everywhere.
 */

const HOUR_MS = 3_600_000;

type DateLike = Date | string | number;

function toMs(date: DateLike): number {
	return date instanceof Date ? date.getTime() : new Date(date).getTime();
}

export function hoursSince(date: DateLike, now: number = Date.now()): number {
	const t = toMs(date);
	if (Number.isNaN(t)) return Number.NaN;
	return Math.max((now - t) / HOUR_MS, 0);
}

/**
 * Lifetime-average views per hour since publish. Ages under one hour count as
 * one hour so a 2-minute-old video doesn't show an absurd VPH.
 */
export function computeVph(
	views: number,
	publishedAt: DateLike,
	now: number = Date.now(),
): number | null {
	const h = hoursSince(publishedAt, now);
	if (!Number.isFinite(h) || views < 0) return null;
	return views / Math.max(h, 1);
}

export type ViewPoint = { t: DateLike; views: number };

/**
 * Current momentum: views gained per hour across the most recent
 * `windowHours` of snapshots (needs ≥ 2 points spanning ≥ 30 minutes).
 * This is what powers "VPH" once the server has history for a video.
 */
export function computeRecentVph(
	points: ViewPoint[],
	windowHours = 48,
): number | null {
	if (points.length < 2) return null;
	const sorted = points
		.map((p) => ({ t: toMs(p.t), views: p.views }))
		.filter((p) => Number.isFinite(p.t))
		.sort((a, b) => a.t - b.t);
	const last = sorted.at(-1);
	if (!last) return null;
	const cutoff = last.t - windowHours * HOUR_MS;
	const first = sorted.find((p) => p.t >= cutoff);
	if (!first || first === last) return null;
	const spanHours = (last.t - first.t) / HOUR_MS;
	if (spanHours < 0.5) return null;
	return Math.max(last.views - first.views, 0) / spanHours;
}

export function median(values: number[]): number | null {
	const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (nums.length === 0) return null;
	const mid = Math.floor(nums.length / 2);
	// biome-ignore lint/style/noNonNullAssertion: index is in range
	return nums.length % 2 ? nums[mid]! : (nums[mid - 1]! + nums[mid]!) / 2;
}

/**
 * A channel's "typical" video performance: the median views of its recent
 * uploads of the same format (long-form vs Shorts), ignoring the video being
 * scored. Median (not mean) so one viral hit doesn't skew the baseline.
 */
export function computeChannelBaseline(
	recentViewCounts: number[],
): number | null {
	const m = median(recentViewCounts.filter((v) => v >= 0));
	return m && m > 0 ? m : null;
}

/**
 * Outlier score = video views ÷ channel baseline. 1x is a normal video for
 * that channel; 5x+ is a strong outlier.
 */
export function computeOutlierScore(
	views: number,
	baseline: number | null | undefined,
): number | null {
	if (!baseline || baseline <= 0 || views < 0) return null;
	return views / baseline;
}

export type OutlierTier = "low" | "normal" | "good" | "great" | "viral";

export function outlierTier(
	score: number | null | undefined,
): OutlierTier | null {
	if (score == null || !Number.isFinite(score)) return null;
	if (score < 0.5) return "low";
	if (score < 2) return "normal";
	if (score < 5) return "good";
	if (score < 20) return "great";
	return "viral";
}

/** (likes + comments) ÷ views, as a percentage. */
export function computeEngagementRate(input: {
	views: number | null | undefined;
	likes?: number | null;
	comments?: number | null;
}): number | null {
	const { views } = input;
	if (!views || views <= 0) return null;
	if (input.likes == null && input.comments == null) return null;
	return (((input.likes ?? 0) + (input.comments ?? 0)) / views) * 100;
}

/** Average views per upload — rough channel health signal. */
export function computeAverage(values: number[]): number | null {
	const nums = values.filter((v) => Number.isFinite(v));
	if (nums.length === 0) return null;
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Uploads per week over the span covered by the given publish dates. */
export function computeUploadsPerWeek(publishDates: DateLike[]): number | null {
	const ts = publishDates
		.map(toMs)
		.filter(Number.isFinite)
		.sort((a, b) => a - b);
	if (ts.length < 2) return null;
	// biome-ignore lint/style/noNonNullAssertion: length checked
	const spanWeeks = (ts.at(-1)! - ts[0]!) / (7 * 24 * HOUR_MS);
	return spanWeeks > 0 ? (ts.length - 1) / spanWeeks : null;
}

export type PostingSlot = {
	weekday: number;
	hour: number;
	avgOutlier: number;
	count: number;
};

/**
 * "Best time to post" from a channel's own history: groups uploads by
 * weekday/hour (in the viewer's local time zone) and ranks by average
 * outlier score. A free stand-in for YouTube Analytics audience data.
 */
export function computeBestPostingSlots(
	videos: { publishedAt: DateLike; views: number }[],
	baseline: number | null,
	limit = 3,
): PostingSlot[] {
	if (!baseline) return [];
	const buckets = new Map<
		string,
		{ weekday: number; hour: number; sum: number; count: number }
	>();
	for (const v of videos) {
		const d = new Date(toMs(v.publishedAt));
		if (Number.isNaN(d.getTime())) continue;
		const key = `${d.getDay()}-${d.getHours()}`;
		const b = buckets.get(key) ?? {
			weekday: d.getDay(),
			hour: d.getHours(),
			sum: 0,
			count: 0,
		};
		b.sum += v.views / baseline;
		b.count += 1;
		buckets.set(key, b);
	}
	return [...buckets.values()]
		.map((b) => ({
			weekday: b.weekday,
			hour: b.hour,
			avgOutlier: b.sum / b.count,
			count: b.count,
		}))
		.sort((a, b) => b.avgOutlier - a.avgOutlier || b.count - a.count)
		.slice(0, limit);
}
