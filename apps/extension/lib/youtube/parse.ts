/**
 * Parsers for YouTube's English UI text. We always request `hl=en` from
 * InnerTube, so these only need to understand English — but they accept both
 * the long ("6.3 thousand views", "11 hours ago") and the compact ("6.3K",
 * "11h ago") forms YouTube mixes across renderers.
 */
import { parseDurationText } from "@open-vidiq/shared/format";
import { CHANNEL_ID_RE, HANDLE_RE } from "@open-vidiq/shared/youtube";

const WORD_MULT: Record<string, number> = {
	k: 1e3,
	thousand: 1e3,
	m: 1e6,
	million: 1e6,
	b: 1e9,
	billion: 1e9,
};

export type ParsedCount = { value: number; exact: boolean };

/**
 * "6,387 views" -> {6387, exact}, "6.3K" -> {6300, rounded},
 * "6.3 thousand views" -> {6300, rounded}, "No views" -> {0, exact},
 * "14,348 watching" -> {14348, exact}. Null when there is no number.
 */
export function parseCount(
	text: string | null | undefined,
): ParsedCount | null {
	if (!text) return null;
	const t = text.trim().toLowerCase().replace(/ /g, " ");
	if (/^no\b/.test(t)) return { value: 0, exact: true };
	const m = t.match(
		/(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|[kmb])?(?![a-z])/,
	);
	if (!m?.[1]) return null;
	const n = Number.parseFloat(m[1].replace(/,/g, ""));
	if (!Number.isFinite(n)) return null;
	const suffix = m[2];
	if (!suffix) return { value: Math.round(n), exact: true };
	return { value: Math.round(n * (WORD_MULT[suffix] ?? 1)), exact: false };
}

export function parseCountValue(
	text: string | null | undefined,
): number | null {
	return parseCount(text)?.value ?? null;
}

const AGO_UNITS: [RegExp, number][] = [
	[/^(?:s|secs?|seconds?)$/, 1_000],
	[/^(?:m|mins?|minutes?)$/, 60_000],
	[/^(?:h|hrs?|hours?)$/, 3_600_000],
	[/^(?:d|days?)$/, 86_400_000],
	[/^(?:w|wks?|weeks?)$/, 7 * 86_400_000],
	[/^(?:mo|mos|months?)$/, 30 * 86_400_000],
	[/^(?:y|yrs?|years?)$/, 365 * 86_400_000],
];

/**
 * "11 hours ago", "11h ago", "Streamed 4y ago", "Premiered 3 weeks ago",
 * "3mo ago" -> approximate Date. Null if not a relative time.
 */
export function parseAgo(
	text: string | null | undefined,
	now: number = Date.now(),
): Date | null {
	if (!text) return null;
	const t = text.toLowerCase().replace(/ /g, " ");
	const m = t.match(/(\d+)\s*([a-z]+)\s+ago\b/);
	if (!m?.[1] || !m[2]) return null;
	const unit = AGO_UNITS.find(([re]) => re.test(m[2] as string))?.[1];
	if (!unit) return null;
	return new Date(now - Number.parseInt(m[1], 10) * unit);
}

/** "9:26" -> 566, "1:01:14" -> 3674. Null for "LIVE", "SHORTS", etc. */
export function parseClock(text: string | null | undefined): number | null {
	if (!text) return null;
	const m = text.match(/\d+(?::\d{1,2}){1,2}/);
	return m ? parseDurationText(m[0]) : null;
}

/** "9 minutes, 26 seconds" -> 566 (accessibility labels) */
export function parseSpokenDuration(
	text: string | null | undefined,
): number | null {
	if (!text) return null;
	const t = text.toLowerCase();
	let total = 0;
	let found = false;
	for (const [re, mult] of [
		[/(\d+)\s*hours?/, 3600],
		[/(\d+)\s*minutes?/, 60],
		[/(\d+)\s*seconds?/, 1],
	] as const) {
		const m = t.match(re);
		if (m?.[1]) {
			total += Number.parseInt(m[1], 10) * mult;
			found = true;
		}
	}
	return found ? total : null;
}

const MONTHS: Record<string, number> = {
	jan: 1,
	feb: 2,
	mar: 3,
	apr: 4,
	may: 5,
	jun: 6,
	jul: 7,
	aug: 8,
	sep: 9,
	sept: 9,
	oct: 10,
	nov: 11,
	dec: 12,
};

/** "Joined Oct 28, 2015" / "Oct 28, 2015" / "28 Oct 2015" -> "2015-10-28" */
export function parseEnglishDate(
	text: string | null | undefined,
): string | null {
	if (!text) return null;
	const t = text.toLowerCase().replace(/ /g, " ");
	let y: number | undefined;
	let mo: number | undefined;
	let d: number | undefined;
	const mdy = t.match(/([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
	const dmy = t.match(/(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{4})/);
	if (mdy?.[1] && mdy[2] && mdy[3]) {
		mo = MONTHS[mdy[1].slice(0, 4)] ?? MONTHS[mdy[1].slice(0, 3)];
		d = Number(mdy[2]);
		y = Number(mdy[3]);
	} else if (dmy?.[1] && dmy[2] && dmy[3]) {
		mo = MONTHS[dmy[2].slice(0, 4)] ?? MONTHS[dmy[2].slice(0, 3)];
		d = Number(dmy[1]);
		y = Number(dmy[3]);
	}
	if (!y || !mo || !d || d > 31) return null;
	return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Channel keywords are one space-separated string with quoted phrases:
 * `carandbike "car and bike" car` -> ["carandbike", "car and bike", "car"]
 */
export function parseKeywordString(text: string | null | undefined): string[] {
	if (!text) return [];
	const out: string[] = [];
	for (const m of text.matchAll(/"([^"]+)"|(\S+)/g)) {
		const kw = (m[1] ?? m[2] ?? "").trim();
		if (kw && !out.includes(kw)) out.push(kw);
	}
	return out;
}

/** "http://www.youtube.com/@carandbike" or "/@carandbike" -> "@carandbike" */
export function handleFromUrl(url: string | null | undefined): string | null {
	if (!url) return null;
	const m = url.match(/\/(@[^/?#]+)/);
	if (!m?.[1]) return null;
	let handle: string;
	try {
		handle = decodeURIComponent(m[1]);
	} catch {
		handle = m[1];
	}
	// Handles may contain non-Latin characters, so HANDLE_RE is only a hint.
	return handle.length > 1 ? handle : null;
}

export function isLikelyHandle(value: string): boolean {
	return HANDLE_RE.test(value) || /^@[^\s/?#]{2,100}$/u.test(value);
}

/** Normalizes user input ("carandbike", "@carandbike", URL) to "@carandbike". */
export function normalizeHandle(input: string): string {
	const fromUrl = handleFromUrl(input);
	if (fromUrl) return fromUrl;
	const t = input.trim();
	return t.startsWith("@") ? t : `@${t}`;
}

function b64UrlDecode(input: string): string {
	try {
		const s = decodeURIComponent(input).replace(/-/g, "+").replace(/_/g, "/");
		const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
		return atob(padded);
	} catch {
		return "";
	}
}

/**
 * Some shorts renderers only carry the uploader in an opaque base64 `params`
 * protobuf; the channel id is embedded as plain ASCII inside it.
 */
export function channelIdFromParams(
	params: string | null | undefined,
): string | null {
	if (!params) return null;
	const decoded = b64UrlDecode(params);
	const m = decoded.match(/UC[\w-]{22}/);
	return m && CHANNEL_ID_RE.test(m[0]) ? m[0] : null;
}

/** Strips ytimg query strings so thumbnails are stable cache keys. */
export function cleanThumbnail(
	url: string | null | undefined,
	videoId: string,
): string {
	if (url?.startsWith("https://i.ytimg.com/")) return url;
	return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function toIso(
	value: string | number | Date | null | undefined,
): string | null {
	if (value == null || value === "") return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toInt(value: unknown): number | null {
	if (value == null || value === "") return null;
	const n =
		typeof value === "number" ? value : Number.parseInt(String(value), 10);
	return Number.isFinite(n) ? n : null;
}
