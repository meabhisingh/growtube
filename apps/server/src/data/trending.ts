import {
	and,
	desc,
	eq,
	gte,
	ilike,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
	videos,
} from "@growtube/db";
import type { TrendingQuery, TrendingResponse } from "@growtube/shared";

import { type Cached, cachedJson, cacheKeys } from "../lib/cache";
import { opaqueId } from "../lib/hash";
import type { Deps } from "../types";
import { type Executor, toIso } from "./sql";
import { MAX_PLAUSIBLE_VIEWS_PER_HOUR } from "./videos";

export const TRENDING_CACHE_SECONDS = 300;
const HOUR_MS = 3_600_000;
const WINDOW_HOURS = { "24h": 24, "7d": 7 * 24 } as const;
/** VPH is a 48h momentum figure, so it must have been refreshed within that. */
const MAX_SNAPSHOT_AGE_HOURS = 48;
/** Shorts are at most 3 minutes; anything longer is long-form. */
const MAX_SHORT_SECONDS = 180;

export function normalizeTrendingQuery(query: TrendingQuery): TrendingQuery {
	const q = query.q?.trim().replace(/\s+/g, " ").toLowerCase();
	return { ...query, q: q || undefined };
}

/**
 * The search text is only HMAC input (like rate-limit subjects): the Redis
 * instance may be shared, and its key list must not show what people search
 * for. The "trending:" prefix keeps these hashes apart from rate-limit ones.
 */
export async function trendingCacheKey(query: TrendingQuery): Promise<string> {
	const { window, type, limit, q } = normalizeTrendingQuery(query);
	return cacheKeys.trending(
		`${window}:${type}:${limit}:${q ? await opaqueId(`trending:${q}`) : ""}`,
	);
}

/** Escapes LIKE wildcards so user input matches literally. */
function likePattern(q: string): string {
	return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function loadTrending(
	exec: Executor,
	query: TrendingQuery,
	now: Date = new Date(),
): Promise<TrendingResponse> {
	const { window, type, limit, q } = normalizeTrendingQuery(query);
	const windowHours = WINDOW_HOURS[window];
	const publishedSince = new Date(now.getTime() - windowHours * HOUR_MS);
	const snapshotSince = new Date(
		now.getTime() - Math.min(windowHours, MAX_SNAPSHOT_AGE_HOURS) * HOUR_MS,
	);

	const filters: (SQL | undefined)[] = [
		gte(videos.publishedAt, publishedSince),
		gte(videos.lastSnapshotAt, snapshotSince),
		isNotNull(videos.recentVph),
		isNull(videos.unavailableAt),
		// Crowdsourced reports are anonymous: list only videos YouTube itself
		// confirmed (cron: Data API or oEmbed), with believable numbers.
		isNotNull(videos.verifiedAt),
		sql`${videos.recentVph} <= ${MAX_PLAUSIBLE_VIEWS_PER_HOUR}`,
		sql`${videos.latestViews} <= ${MAX_PLAUSIBLE_VIEWS_PER_HOUR} * greatest(extract(epoch from (${now.toISOString()}::timestamptz - ${videos.publishedAt})) / 3600.0, 1)`,
	];
	if (type === "short") filters.push(eq(videos.isShort, true));
	if (type === "long") {
		filters.push(
			or(
				eq(videos.isShort, false),
				and(
					isNull(videos.isShort),
					sql`${videos.durationSec} > ${MAX_SHORT_SECONDS}`,
				),
			),
		);
	}
	if (q) filters.push(ilike(videos.title, likePattern(q)));

	const rows = await exec
		.select({
			videoId: videos.id,
			channelId: videos.channelId,
			title: videos.title,
			channelTitle: videos.channelTitle,
			publishedAt: videos.publishedAt,
			views: videos.latestViews,
			vph: videos.recentVph,
			isShort: videos.isShort,
		})
		.from(videos)
		.where(and(...filters))
		.orderBy(desc(videos.recentVph), desc(videos.latestViews))
		.limit(limit);

	return {
		window,
		generatedAt: now.toISOString(),
		videos: rows.map((r) => ({
			...r,
			publishedAt: toIso(r.publishedAt),
			vph: Math.max(r.vph ?? 0, 0),
		})),
	};
}

/** Cached (5 min) trending list keyed by the normalized query (hashed). */
export async function getTrending(
	{ db, redis }: Deps,
	query: TrendingQuery,
): Promise<Cached<TrendingResponse>> {
	return cachedJson(
		redis,
		await trendingCacheKey(query),
		TRENDING_CACHE_SECONDS,
		() => loadTrending(db, query),
	);
}
