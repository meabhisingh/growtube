/** Display formatting + parsing of YouTube's human-readable text. */

const compactFormatters = new Map<number, Intl.NumberFormat>();

/** 6812 -> "6.8K", 1_410_000 -> "1.41M" (with digits = 2). */
export function formatCompact(
	value: number | null | undefined,
	digits = 1,
): string {
	if (value == null || !Number.isFinite(value)) return "—";
	let f = compactFormatters.get(digits);
	if (!f) {
		f = new Intl.NumberFormat("en", {
			notation: "compact",
			maximumFractionDigits: digits,
		});
		compactFormatters.set(digits, f);
	}
	return f.format(value);
}

export function formatNumber(value: number | null | undefined): string {
	if (value == null || !Number.isFinite(value)) return "—";
	return new Intl.NumberFormat("en").format(Math.round(value));
}

/** Outlier multiplier label the way vidIQ shows it: "0.4x", "3.2x", "12x", ">100x". */
export function formatOutlier(score: number | null | undefined): string {
	if (score == null || !Number.isFinite(score)) return "N/A";
	if (score >= 100) return ">100x";
	if (score >= 10) return `${Math.round(score)}x`;
	return `${score.toFixed(1)}x`;
}

export function formatPercent(
	value: number | null | undefined,
	digits = 1,
): string {
	if (value == null || !Number.isFinite(value)) return "—";
	return `${value.toFixed(digits)}%`;
}

/** 754 -> "12:34", 3723 -> "1:02:03" */
export function formatDuration(
	totalSeconds: number | null | undefined,
): string {
	if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 3600],
	["month", 30 * 24 * 3600],
	["week", 7 * 24 * 3600],
	["day", 24 * 3600],
	["hour", 3600],
	["minute", 60],
];

/** "10 hours ago", "2 days ago" */
export function formatRelative(
	date: Date | string | number | null | undefined,
	now: number = Date.now(),
): string {
	if (date == null) return "—";
	const t = new Date(date).getTime();
	if (Number.isNaN(t)) return "—";
	const diffSec = Math.round((t - now) / 1000);
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	for (const [unit, sec] of UNITS) {
		if (Math.abs(diffSec) >= sec)
			return rtf.format(Math.trunc(diffSec / sec), unit);
	}
	return "just now";
}

/** "11 years old", "4 months old" */
export function formatAge(
	date: Date | string | number | null | undefined,
	now: number = Date.now(),
): string {
	if (date == null) return "—";
	const t = new Date(date).getTime();
	if (Number.isNaN(t)) return "—";
	const days = Math.max(0, (now - t) / 86_400_000);
	if (days >= 365) {
		const y = Math.floor(days / 365);
		return `${y} year${y === 1 ? "" : "s"} old`;
	}
	if (days >= 30) {
		const m = Math.floor(days / 30);
		return `${m} month${m === 1 ? "" : "s"} old`;
	}
	const d = Math.floor(days);
	return `${d} day${d === 1 ? "" : "s"} old`;
}

// ---------------------------------------------------------------------------
// Parsing YouTube UI text (English UI; returns null when it can't parse)
// ---------------------------------------------------------------------------

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "1.41M subscribers" -> 1410000, "5,912 views" -> 5912, "685K" -> 685000,
 * "No views" -> 0. Returns null if no number is found.
 */
export function parseCompactNumber(
	text: string | null | undefined,
): number | null {
	if (!text) return null;
	const t = text.trim().toLowerCase();
	if (/^no\b/.test(t)) return 0;
	const match = t.match(/(\d[\d,]*(?:\.\d+)?)\s*([kmb])?\b/);
	if (!match?.[1]) return null;
	const n = Number.parseFloat(match[1].replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	const mult = match[2] ? (SUFFIX[match[2]] ?? 1) : 1;
	return Math.round(n * mult);
}

const REL_UNITS: Record<string, number> = {
	second: 1_000,
	minute: 60_000,
	hour: 3_600_000,
	day: 86_400_000,
	week: 7 * 86_400_000,
	month: 30 * 86_400_000,
	year: 365 * 86_400_000,
};

/**
 * "10 hours ago" / "Streamed 2 days ago" / "Premiered 1 year ago" -> Date
 * (approximate — YouTube rounds these).
 */
export function parseRelativeTime(
	text: string | null | undefined,
	now: number = Date.now(),
): Date | null {
	if (!text) return null;
	const m = text
		.toLowerCase()
		.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
	if (!m?.[1] || !m[2]) return null;
	const unit = REL_UNITS[m[2]];
	if (!unit) return null;
	return new Date(now - Number.parseInt(m[1], 10) * unit);
}

/** "12:34" -> 754, "1:02:03" -> 3723 */
export function parseDurationText(
	text: string | null | undefined,
): number | null {
	if (!text) return null;
	const parts = text
		.trim()
		.split(":")
		.map((p) => Number.parseInt(p, 10));
	if (parts.length < 2 || parts.length > 3 || parts.some(Number.isNaN))
		return null;
	return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** ISO-8601 duration from the YouTube Data API: "PT1H2M3S" -> 3723 */
export function parseIsoDuration(
	text: string | null | undefined,
): number | null {
	if (!text) return null;
	const m = text.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
	if (!m) return null;
	const [, d, h, min, s] = m.map((x) => (x ? Number.parseInt(x, 10) : 0));
	return (d ?? 0) * 86400 + (h ?? 0) * 3600 + (min ?? 0) * 60 + (s ?? 0);
}
