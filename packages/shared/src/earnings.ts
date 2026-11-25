/**
 * Rough earnings & sponsorship estimates for YouTube creators.
 * Pure functions, no I/O.
 *
 * IMPORTANT — what these numbers are (and aren't):
 * - They are NOT YouTube data. GrowTube never sees a channel's real revenue.
 *   The tables below are rough ranges compiled from publicly shared creator
 *   reports and industry write-ups (RPM screenshots, agency rate cards),
 *   rounded and deliberately wide.
 * - RPM = what the creator keeps per 1,000 views (after YouTube's share),
 *   averaged over all views, monetized or not. Real RPM swings a lot with
 *   audience country, season (Q4 is high, January low), video length
 *   (mid-rolls need 8+ minutes), ad blockers and "made for kids" status.
 * - Ad estimates assume the channel is in the YouTube Partner Program.
 * - Sponsorship ranges are CPM-style (price per 1,000 expected views of an
 *   integration) based on the channel's typical recent views. Real deals
 *   depend on audience fit, engagement, usage rights and negotiation.
 *
 * Always present results as a range ("$120 – $480"), labelled as an
 * estimate, never as one exact number.
 */

export type EarningsRange = { low: number; high: number };

export type NicheId =
	| "general"
	| "finance"
	| "business"
	| "tech"
	| "education"
	| "howto"
	| "health"
	| "beauty"
	| "food"
	| "travel"
	| "autos"
	| "gaming"
	| "entertainment"
	| "music"
	| "kids"
	| "news"
	| "sports"
	| "pets";

export type NicheProfile = {
	id: NicheId;
	label: string;
	/** Long-form ad RPM in USD per 1,000 views (creator share). */
	longRpm: EarningsRange;
	/** Shorts RPM in USD per 1,000 views (Shorts revenue pool, much lower). */
	shortsRpm: EarningsRange;
	/** Sponsored integration price in USD per 1,000 expected views (long-form). */
	sponsorCpm: EarningsRange;
};

/**
 * Rough public-industry ranges (USD). Not YouTube data: see the header.
 * Ordered for display (General first, then roughly by typical RPM).
 */
export const NICHES: readonly NicheProfile[] = [
	{
		id: "general",
		label: "General",
		longRpm: { low: 1, high: 5 },
		shortsRpm: { low: 0.02, high: 0.08 },
		sponsorCpm: { low: 10, high: 30 },
	},
	{
		id: "finance",
		label: "Finance & investing",
		longRpm: { low: 6, high: 22 },
		shortsRpm: { low: 0.04, high: 0.15 },
		sponsorCpm: { low: 20, high: 60 },
	},
	{
		id: "business",
		label: "Business & marketing",
		longRpm: { low: 5, high: 18 },
		shortsRpm: { low: 0.04, high: 0.14 },
		sponsorCpm: { low: 20, high: 55 },
	},
	{
		id: "tech",
		label: "Tech & software",
		longRpm: { low: 3, high: 12 },
		shortsRpm: { low: 0.03, high: 0.1 },
		sponsorCpm: { low: 15, high: 45 },
	},
	{
		id: "education",
		label: "Education & science",
		longRpm: { low: 2, high: 10 },
		shortsRpm: { low: 0.03, high: 0.1 },
		sponsorCpm: { low: 12, high: 35 },
	},
	{
		id: "autos",
		label: "Cars & vehicles",
		longRpm: { low: 2.5, high: 9 },
		shortsRpm: { low: 0.03, high: 0.09 },
		sponsorCpm: { low: 12, high: 35 },
	},
	{
		id: "health",
		label: "Health & fitness",
		longRpm: { low: 2.5, high: 9 },
		shortsRpm: { low: 0.03, high: 0.09 },
		sponsorCpm: { low: 12, high: 35 },
	},
	{
		id: "howto",
		label: "How-to & DIY",
		longRpm: { low: 2, high: 8 },
		shortsRpm: { low: 0.02, high: 0.08 },
		sponsorCpm: { low: 10, high: 30 },
	},
	{
		id: "travel",
		label: "Travel",
		longRpm: { low: 2, high: 7 },
		shortsRpm: { low: 0.02, high: 0.08 },
		sponsorCpm: { low: 10, high: 30 },
	},
	{
		id: "beauty",
		label: "Beauty & fashion",
		longRpm: { low: 1.5, high: 6 },
		shortsRpm: { low: 0.02, high: 0.07 },
		sponsorCpm: { low: 12, high: 35 },
	},
	{
		id: "food",
		label: "Food & cooking",
		longRpm: { low: 1.5, high: 6 },
		shortsRpm: { low: 0.02, high: 0.07 },
		sponsorCpm: { low: 10, high: 30 },
	},
	{
		id: "news",
		label: "News & politics",
		longRpm: { low: 1, high: 5 },
		shortsRpm: { low: 0.02, high: 0.06 },
		sponsorCpm: { low: 8, high: 25 },
	},
	{
		id: "sports",
		label: "Sports",
		longRpm: { low: 1, high: 5 },
		shortsRpm: { low: 0.02, high: 0.06 },
		sponsorCpm: { low: 8, high: 25 },
	},
	{
		id: "pets",
		label: "Pets & animals",
		longRpm: { low: 1, high: 4 },
		shortsRpm: { low: 0.02, high: 0.06 },
		sponsorCpm: { low: 8, high: 25 },
	},
	{
		id: "entertainment",
		label: "Entertainment & vlogs",
		longRpm: { low: 0.5, high: 3.5 },
		shortsRpm: { low: 0.01, high: 0.05 },
		sponsorCpm: { low: 8, high: 25 },
	},
	{
		id: "gaming",
		label: "Gaming",
		longRpm: { low: 0.5, high: 4 },
		shortsRpm: { low: 0.01, high: 0.05 },
		sponsorCpm: { low: 8, high: 25 },
	},
	{
		id: "music",
		label: "Music",
		longRpm: { low: 0.3, high: 2 },
		shortsRpm: { low: 0.01, high: 0.04 },
		sponsorCpm: { low: 5, high: 20 },
	},
	{
		// "Made for kids" videos get no personalized ads, so RPM is low.
		id: "kids",
		label: "Kids & family",
		longRpm: { low: 0.3, high: 2.5 },
		shortsRpm: { low: 0.01, high: 0.04 },
		sponsorCpm: { low: 5, high: 20 },
	},
];

const BY_ID = new Map<string, NicheProfile>(NICHES.map((n) => [n.id, n]));

export function isNicheId(value: unknown): value is NicheId {
	return typeof value === "string" && BY_ID.has(value);
}

export function getNiche(
	id: NicheId | string | null | undefined,
): NicheProfile {
	return (id ? BY_ID.get(id) : undefined) ?? (NICHES[0] as NicheProfile);
}

/** YouTube's public video category names -> niche. */
const CATEGORY_NICHE: Record<string, NicheId> = {
	"science & technology": "tech",
	education: "education",
	"howto & style": "howto",
	"autos & vehicles": "autos",
	"travel & events": "travel",
	gaming: "gaming",
	music: "music",
	sports: "sports",
	"news & politics": "news",
	"pets & animals": "pets",
	entertainment: "entertainment",
	comedy: "entertainment",
	"film & animation": "entertainment",
	"people & blogs": "general",
	"nonprofits & activism": "general",
	shows: "entertainment",
	trailers: "entertainment",
};

/**
 * Word hints that override a broad category ("People & Blogs" can be a
 * finance channel). Checked in order; the first niche with a hit wins.
 */
const KEYWORD_HINTS: [NicheId, RegExp][] = [
	[
		"finance",
		/\b(invest(ing|ment|or)?s?|stocks?|dividends?|etfs?|crypto|bitcoin|personal finance|budgeting|credit cards?|retire(ment)?|real estate|passive income|stock trading|day trading|taxes)\b/i,
	],
	[
		"business",
		/\b(business|entrepreneur(ship)?|marketing|startups?|side hustles?|e-?commerce|dropshipping|saas|sales funnel|freelanc(e|ing))\b/i,
	],
	[
		"tech",
		/\b(tech|smartphones?|iphone|android|laptops?|pc build|software|programming|coding|developer|gadgets?|ai tools?)\b/i,
	],
	[
		"health",
		/\b(fitness|workouts?|gym|nutrition|diet|weight loss|yoga|health|bodybuilding)\b/i,
	],
	[
		"beauty",
		/\b(makeup|skincare|beauty|fashion|outfits?|hairstyles?|nails)\b/i,
	],
	["food", /\b(recipes?|cooking|baking|food|kitchen|meal prep)\b/i],
	[
		"kids",
		/\b(nursery rhymes?|for kids|kids songs?|toddlers?|cartoons? for)\b/i,
	],
];

/**
 * Best guess of a video's niche from its YouTube category and words. Falls
 * back to "general". The user can always override it in the UI.
 */
export function guessNiche(input: {
	category?: string | null;
	title?: string | null;
	keywords?: readonly string[] | null;
}): NicheId {
	const text = [input.title ?? "", ...(input.keywords ?? []).slice(0, 30)].join(
		" · ",
	);
	if (text.trim()) {
		for (const [niche, re] of KEYWORD_HINTS) if (re.test(text)) return niche;
	}
	const cat = input.category?.trim().toLowerCase();
	return (cat && CATEGORY_NICHE[cat]) || "general";
}

/** Most common guess over several videos (e.g. a channel's uploads). */
export function guessChannelNiche(
	videos: readonly {
		category?: string | null;
		title?: string | null;
		keywords?: readonly string[] | null;
	}[],
): NicheId {
	const counts = new Map<NicheId, number>();
	for (const v of videos) {
		const n = guessNiche(v);
		counts.set(n, (counts.get(n) ?? 0) + 1);
	}
	let best: NicheId = "general";
	let bestCount = 0;
	for (const [n, c] of counts) {
		// "general" only wins when nothing more specific shows up.
		const score = n === "general" ? c - 0.5 : c;
		if (score > bestCount) {
			best = n;
			bestCount = score;
		}
	}
	return best;
}

export type VideoFormat = "long" | "short";

function scale(views: number, perThousand: EarningsRange): EarningsRange {
	return {
		low: (views / 1000) * perThousand.low,
		high: (views / 1000) * perThousand.high,
	};
}

/**
 * Estimated ad revenue (creator share) for `views` views of one format.
 * null for unknown / negative views.
 */
export function estimateAdEarnings(
	views: number | null | undefined,
	opts: { niche: NicheId | string | null | undefined; format: VideoFormat },
): EarningsRange | null {
	if (views == null || !Number.isFinite(views) || views < 0) return null;
	const n = getNiche(opts.niche);
	return scale(views, opts.format === "short" ? n.shortsRpm : n.longRpm);
}

export type MonthlyEarningsEstimate = {
	range: EarningsRange;
	/** Views counted (uploads published inside the window) */
	views: number;
	longViews: number;
	shortViews: number;
	/** Uploads published inside the window */
	uploads: number;
	windowDays: number;
};

/**
 * Estimated monthly ad revenue from the views of uploads published in the
 * last `windowDays` days (default 30). Back-catalog views of older videos are
 * NOT included (we don't know them), so this tends to undercount channels
 * with strong evergreen libraries. null when no upload falls in the window.
 */
export function estimateMonthlyEarnings(
	uploads: readonly {
		views: number | null | undefined;
		publishedAt: string | null | undefined;
		isShort?: boolean;
	}[],
	opts: {
		niche: NicheId | string | null | undefined;
		windowDays?: number;
		now?: number;
	},
): MonthlyEarningsEstimate | null {
	const windowDays = opts.windowDays ?? 30;
	const now = opts.now ?? Date.now();
	const since = now - windowDays * 86_400_000;
	let longViews = 0;
	let shortViews = 0;
	let count = 0;
	for (const u of uploads) {
		if (u.views == null || !Number.isFinite(u.views) || u.views < 0) continue;
		const t = u.publishedAt ? Date.parse(u.publishedAt) : Number.NaN;
		if (!Number.isFinite(t) || t < since || t > now) continue;
		count++;
		if (u.isShort) shortViews += u.views;
		else longViews += u.views;
	}
	if (!count) return null;
	const long = estimateAdEarnings(longViews, {
		niche: opts.niche,
		format: "long",
	}) as EarningsRange;
	const short = estimateAdEarnings(shortViews, {
		niche: opts.niche,
		format: "short",
	}) as EarningsRange;
	return {
		range: { low: long.low + short.low, high: long.high + short.high },
		views: longViews + shortViews,
		longViews,
		shortViews,
		uploads: count,
		windowDays,
	};
}

/**
 * Sponsors pay much less per view for a Shorts mention than for a long-form
 * integration (shorter exposure, lower recall). Rough public multiplier.
 */
export const SHORTS_SPONSOR_FACTOR: EarningsRange = { low: 0.15, high: 0.3 };

/**
 * Below this many typical views, brands rarely pay cash per video
 * (free product / affiliate deals are more common). The UI says so.
 */
export const MIN_SPONSOR_VIEWS = 1000;

/**
 * Estimated price range for one sponsored integration, from the channel's
 * typical (average or median) recent views per video. null when unknown.
 */
export function estimateSponsorshipRate(
	typicalViews: number | null | undefined,
	opts: {
		niche: NicheId | string | null | undefined;
		format?: VideoFormat;
	},
): EarningsRange | null {
	if (
		typicalViews == null ||
		!Number.isFinite(typicalViews) ||
		typicalViews < 0
	)
		return null;
	const n = getNiche(opts.niche);
	const base = scale(typicalViews, n.sponsorCpm);
	if (opts.format !== "short") return base;
	return {
		low: base.low * SHORTS_SPONSOR_FACTOR.low,
		high: base.high * SHORTS_SPONSOR_FACTOR.high,
	};
}

/** Rounds to 2 significant figures so ranges never look precise. */
function roundSoft(value: number): number {
	if (value < 10) return Math.round(value);
	const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
	return Math.round(value / magnitude) * magnitude;
}

const compactUsd = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});

/** 3 -> "$3", 482 -> "$480", 12_345 -> "$12K", 1_800_000 -> "$1.8M". */
export function formatUsd(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "$0";
	if (value < 1) return "<$1";
	const v = roundSoft(value);
	return v >= 1000 ? `$${compactUsd.format(v)}` : `$${v}`;
}

/** "$120 – $480"; "<$1" when even the high end is under a dollar. */
export function formatUsdRange(
	range: EarningsRange | null | undefined,
): string {
	if (!range) return "—";
	if (range.high < 1) return "<$1";
	const low = formatUsd(range.low);
	const high = formatUsd(range.high);
	return low === high ? `~${high}` : `${low} – ${high}`;
}

/** One-line disclaimer for every surface that shows these estimates. */
export const EARNINGS_DISCLAIMER =
	"Rough estimate from public industry RPM/CPM ranges, not YouTube data. Real earnings depend on audience country, season, video length, ad blockers and Partner Program status.";
