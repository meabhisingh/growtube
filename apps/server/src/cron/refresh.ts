/**
 * Scheduled maintenance (hourly Cron Trigger):
 *  1. refresh stats of recently-seen videos from the YouTube Data API,
 *  2. verify unverified trending candidates (Data API, or oEmbed without a
 *     key) so only videos YouTube confirmed appear in trending,
 *  3. once per UTC day, refresh recently-seen channels,
 *  4. prune old snapshots (thin to hourly after 7 days, drop after 180;
 *     the full thinning pass runs once per UTC day),
 *  5. once per UTC day, privacy cleanup: null avatar URLs that aren't on
 *     YouTube's image hosts, delete expired sessions, verification rows and
 *     API keys, and blank any IP / user agent left on a session row.
 *
 * Steps 1 and 3 need YOUTUBE_API_KEY; without it they are skipped.
 * The run report holds counts and one-line error summaries only (no titles
 * or other crowdsourced text, no SQL parameters): it is logged as-is.
 */
import {
	and,
	asc,
	channels,
	desc,
	describeError,
	gt,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	or,
	type SQL,
	sql,
	videoSnapshots,
	videos,
} from "@open-vidiq/db";
import { apikey, session, verification } from "@open-vidiq/db/schema/auth";
import { YOUTUBE_IMAGE_HOSTS } from "@open-vidiq/shared/images";

import { upsertChannelDailySnapshots } from "../data/channels";
import { chunk, utcDay, valuesList } from "../data/sql";
import {
	SNAPSHOT_THROTTLE_SECONDS,
	snapshotThrottleKey,
	updateVideoMomentum,
	upsertChannelStubs,
	videoHistoryCacheKeys,
} from "../data/videos";
import { invalidate } from "../lib/cache";
import { canonicalYouTubeImageUrl } from "../lib/images";
import { tryRedis } from "../lib/redis";
import {
	type ApiVideo,
	fetchChannels,
	fetchVideos,
	YOUTUBE_MAX_IDS_PER_CALL,
	YouTubeApiError,
	type YouTubeClientOptions,
} from "../lib/youtube-api";
import { lookupOEmbed, type OEmbedOptions } from "../lib/youtube-oembed";
import type { Deps } from "../types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const HOURLY_CRON = "0 * * * *";
/** Not scheduled; pass it to `/__scheduled?cron=0+0+*+*+*` to force the daily part. */
export const DAILY_CRON = "0 0 * * *";

export const REFRESH_LIMITS = {
	videosPerRun: 500,
	videoMaxAgeDays: 28,
	videoSeenWithinDays: 7,
	/** Skip videos that already got a snapshot this recently. */
	videoMinSnapshotAgeMinutes: 30,
	/** Unverified trending candidates checked per run. */
	verifyPerRun: 50,
	/** oEmbed lookups per run (no key): one subrequest each. */
	verifyOEmbedPerRun: 25,
	verifyConcurrency: 5,
	/** Don't re-check an inconclusive video more often than this. */
	verifyRetryHours: 6,
	verifyWindowDays: 7,
	channelsPerDay: 2_500,
	channelSeenWithinDays: 30,
	snapshotThinAfterDays: 7,
	snapshotRetentionDays: 180,
	/** Hourly runs only thin this many days past the 7-day mark; daily runs thin everything. */
	hourlyThinBandDays: 2,
	/** Channel rows whose avatar URL is re-checked per daily cleanup. */
	avatarCleanupPerDay: 10_000,
} as const;

export type RefreshOptions = {
	now?: Date;
	/** YouTube Data API key; API steps are skipped when absent. */
	apiKey?: string;
	/** Run the daily part regardless of the per-day marker. */
	forceDaily?: boolean;
	/** For tests: alternative fetch / API base URL. */
	youtube?: Pick<YouTubeClientOptions, "fetch" | "baseUrl">;
	/** For tests: alternative fetch / oEmbed URL. */
	oembed?: OEmbedOptions;
};

export type RefreshReport = {
	ranAt: string;
	daily: boolean;
	videos:
		| {
				selected: number;
				refreshed: number;
				unavailable: number;
				nonPublic: number;
		  }
		| "skipped";
	verified: {
		via: "api" | "oembed";
		checked: number;
		verified: number;
		unavailable: number;
		nonPublic: number;
	};
	channels:
		| { selected: number; refreshed: number; unavailable: number }
		| "skipped"
		| "not-due";
	pruned: { thinned: number; expired: number };
	cleanup:
		| {
				avatarsCleared: number;
				expiredSessions: number;
				expiredVerifications: number;
				expiredApiKeys: number;
				sessionsScrubbed: number;
		  }
		| "not-due";
	/** One line per failure (`describeError`: no SQL parameters). */
	errors: string[];
};

type DailyStep = "channels" | "prune" | "cleanup";

/** Daily steps are tracked separately, so one failing step can't make another repeat hourly. */
const dailyMarkerKey = (step: DailyStep, day: string) =>
	`cron:daily:${step}:${day}`;
const verifyAttemptKey = (videoId: string) => `verify:v:${videoId}`;
/** A client snapshot this far above the Data API's current count can't be real. */
const INFLATED_SNAPSHOT_FACTOR = 1.1;
const INFLATED_SNAPSHOT_SLACK = 1_000;

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

async function applyVideoUpdates(deps: Deps, items: ApiVideo[], now: Date) {
	const withViews = items.filter((v) => v.views != null);
	if (withViews.length === 0) return 0;
	const nowIso = now.toISOString();

	await deps.db.transaction(async (tx) => {
		await upsertChannelStubs(
			tx,
			withViews.flatMap((v) =>
				v.channelId ? [{ id: v.channelId, title: v.channelTitle }] : [],
			),
		);

		const rows = withViews.map(
			(v) => sql`(
				${v.id}::text, ${v.channelId}::text, ${v.title}::text, ${v.channelTitle}::text,
				${v.publishedAt?.toISOString() ?? null}::timestamptz, ${v.durationSec}::integer,
				${v.views}::bigint, ${v.likes}::bigint, ${v.comments}::bigint
			)`,
		);
		// The API is authoritative: overwrite what clients reported (views
		// included, so corrected/spam-filtered counts come through).
		await tx.execute(sql`
			update ${videos} as v set
				channel_id = coalesce(d.channel_id, v.channel_id),
				title = coalesce(d.title, v.title),
				channel_title = coalesce(d.channel_title, v.channel_title),
				published_at = coalesce(d.published_at, v.published_at),
				duration_sec = coalesce(d.duration_sec, v.duration_sec),
				is_short = coalesce(v.is_short, case when d.duration_sec > 180 then false end),
				latest_views = d.views,
				latest_likes = coalesce(d.likes, v.latest_likes),
				latest_comments = coalesce(d.comments, v.latest_comments),
				unavailable_at = null,
				verified_at = coalesce(v.verified_at, ${nowIso}::timestamptz),
				updated_at = ${nowIso}::timestamptz
			from (values ${valuesList(rows)}) as d(
				id, channel_id, title, channel_title, published_at, duration_sec, views, likes, comments
			)
			where v.id = d.id
		`);

		// Views only grow, so client snapshots well above the current API count
		// were inflated reports: drop them so momentum is recomputed from real
		// numbers.
		await tx.execute(sql`
			delete from ${videoSnapshots} as s
			using (values ${valuesList(
				withViews.map((v) => sql`(${v.id}::text, ${v.views}::bigint)`),
			)}) as d(id, views)
			where s.video_id = d.id
				and s.source = 'client'
				and s.views > d.views * ${INFLATED_SNAPSHOT_FACTOR}::double precision + ${INFLATED_SNAPSHOT_SLACK}::bigint
		`);

		await tx
			.insert(videoSnapshots)
			.values(
				withViews.map((v) => ({
					videoId: v.id,
					capturedAt: now,
					views: v.views ?? 0,
					likes: v.likes,
					comments: v.comments,
					source: "cron" as const,
				})),
			)
			.onConflictDoNothing();

		const current = await tx
			.select({
				id: videos.id,
				latestViews: videos.latestViews,
				publishedAt: videos.publishedAt,
			})
			.from(videos)
			.where(
				inArray(
					videos.id,
					withViews.map((v) => v.id),
				),
			);
		await updateVideoMomentum(tx, current, now);
	});

	// Clients don't need to re-snapshot these for the next 10 minutes.
	await tryRedis(() => {
		const pipeline = deps.redis.pipeline();
		for (const v of withViews) {
			pipeline.set(
				snapshotThrottleKey(v.id),
				String(now.getTime()),
				"EX",
				SNAPSHOT_THROTTLE_SECONDS,
			);
		}
		return pipeline.exec();
	});
	return withViews.length;
}

/**
 * videos.list returns unlisted videos too (only private and deleted ones are
 * left out), so each item's privacy status decides: only public videos are
 * updated, snapshotted and verified. Items without a status are left alone
 * (an incomplete answer is not a reason to delete anything).
 */
function byPrivacy(items: ApiVideo[]) {
	return {
		listed: items.filter((v) => v.privacyStatus === "public"),
		nonPublic: items
			.filter((v) => v.privacyStatus != null && v.privacyStatus !== "public")
			.map((v) => v.id),
	};
}

/**
 * Unlisted or private videos are never kept: deleting the row also deletes
 * their snapshots (FK cascade), so they leave trending, stats and history at
 * once. Their cached history goes too; a cached trending list expires within
 * TRENDING_CACHE_SECONDS. If a video turns public again, the next client
 * report starts it afresh.
 */
async function deleteNonPublicVideos(deps: Deps, ids: string[]) {
	if (ids.length === 0) return 0;
	await deps.db.delete(videos).where(inArray(videos.id, ids));
	await invalidate(deps.redis, videoHistoryCacheKeys(ids));
	return ids.length;
}

async function refreshVideos(
	deps: Deps,
	yt: YouTubeClientOptions,
	now: Date,
	errors: string[],
) {
	const L = REFRESH_LIMITS;
	const t = now.getTime();
	const candidates = await deps.db
		.select({ id: videos.id })
		.from(videos)
		.where(
			and(
				or(
					gt(videos.publishedAt, new Date(t - L.videoMaxAgeDays * DAY_MS)),
					// Unknown publish date: the API will fill it in.
					and(
						isNull(videos.publishedAt),
						gt(
							videos.firstSeenAt,
							new Date(t - L.videoSeenWithinDays * DAY_MS),
						),
					),
				),
				gt(videos.lastSeenAt, new Date(t - L.videoSeenWithinDays * DAY_MS)),
				isNull(videos.unavailableAt),
				or(
					isNull(videos.lastSnapshotAt),
					lt(
						videos.lastSnapshotAt,
						new Date(t - L.videoMinSnapshotAgeMinutes * 60_000),
					),
				),
			),
		)
		.orderBy(sql`${videos.lastSnapshotAt} asc nulls first`)
		.limit(L.videosPerRun);

	let refreshed = 0;
	let unavailable = 0;
	let nonPublic = 0;
	for (const ids of chunk(
		candidates.map((c) => c.id),
		YOUTUBE_MAX_IDS_PER_CALL,
	)) {
		let items: ApiVideo[];
		try {
			items = await fetchVideos(yt, ids);
		} catch (error) {
			errors.push(`videos.list: ${describeError(error)}`);
			if (error instanceof YouTubeApiError && error.isFatal) break;
			continue;
		}
		const visibility = byPrivacy(items);
		refreshed += await applyVideoUpdates(deps, visibility.listed, now);
		nonPublic += await deleteNonPublicVideos(deps, visibility.nonPublic);

		// Ids the API didn't return are private, deleted or blocked.
		const returned = new Set(items.map((v) => v.id));
		const missing = ids.filter((id) => !returned.has(id));
		if (missing.length) {
			await deps.db
				.update(videos)
				.set({ unavailableAt: now, updatedAt: now })
				.where(inArray(videos.id, missing));
			unavailable += missing.length;
		}
	}
	return { selected: candidates.length, refreshed, unavailable, nonPublic };
}

// ---------------------------------------------------------------------------
// Channels (daily)
// ---------------------------------------------------------------------------

async function refreshChannels(
	deps: Deps,
	yt: YouTubeClientOptions,
	now: Date,
	errors: string[],
) {
	const L = REFRESH_LIMITS;
	const candidates = await deps.db
		.select({ id: channels.id })
		.from(channels)
		.where(
			gt(
				channels.lastSeenAt,
				new Date(now.getTime() - L.channelSeenWithinDays * DAY_MS),
			),
		)
		// Channels the API stopped returning (terminated or made-up ids) go
		// last, so they can never crowd out real ones.
		.orderBy(
			sql`(${channels.unavailableAt} is not null) asc`,
			sql`${channels.lastRefreshedAt} asc nulls first`,
			asc(channels.id),
		)
		.limit(L.channelsPerDay);

	let refreshed = 0;
	let unavailable = 0;
	for (const ids of chunk(
		candidates.map((c) => c.id),
		YOUTUBE_MAX_IDS_PER_CALL,
	)) {
		let items: Awaited<ReturnType<typeof fetchChannels>>;
		try {
			items = await fetchChannels(yt, ids);
		} catch (error) {
			errors.push(`channels.list: ${describeError(error)}`);
			if (error instanceof YouTubeApiError && error.isFatal) break;
			continue;
		}
		const returned = new Set(items.map((c) => c.id));
		const missing = ids.filter((id) => !returned.has(id));
		if (missing.length) {
			await deps.db
				.update(channels)
				.set({
					unavailableAt: sql`coalesce(${channels.unavailableAt}, ${now.toISOString()}::timestamptz)`,
					lastRefreshedAt: now,
					updatedAt: now,
				})
				.where(inArray(channels.id, missing));
			unavailable += missing.length;
		}
		if (items.length === 0) continue;
		const nowIso = now.toISOString();
		const rows = items.map(
			(c) => sql`(
				${c.id}::text, ${c.title}::text, ${c.handle}::text, ${canonicalYouTubeImageUrl(c.avatarUrl)}::text,
				${c.joinedAt}::date, ${c.country}::text, ${c.subscribers}::bigint,
				${c.totalViews}::bigint, ${c.videoCount}::integer, ${sql.param(c.keywords)}::text[]
			)`,
		);
		await deps.db.transaction(async (tx) => {
			await tx.execute(sql`
				update ${channels} as c set
					title = coalesce(d.title, c.title),
					handle = coalesce(d.handle, c.handle),
					avatar_url = coalesce(d.avatar_url, c.avatar_url),
					joined_at = coalesce(d.joined_at, c.joined_at),
					country = coalesce(d.country, c.country),
					subscribers = coalesce(d.subscribers, c.subscribers),
					total_views = coalesce(d.total_views, c.total_views),
					video_count = coalesce(d.video_count, c.video_count),
					keywords = coalesce(d.keywords, c.keywords),
					unavailable_at = null,
					last_refreshed_at = ${nowIso}::timestamptz,
					updated_at = ${nowIso}::timestamptz
				from (values ${valuesList(rows)}) as d(
					id, title, handle, avatar_url, joined_at, country, subscribers, total_views, video_count, keywords
				)
				where c.id = d.id
			`);
			await upsertChannelDailySnapshots(
				tx,
				items.map((c) => ({
					channelId: c.id,
					subscribers: c.subscribers,
					totalViews: c.totalViews,
					videoCount: c.videoCount,
				})),
				now,
			);
		});
		refreshed += items.length;
	}
	return { selected: candidates.length, refreshed, unavailable };
}

// ---------------------------------------------------------------------------
// Verification of crowdsourced videos
// ---------------------------------------------------------------------------

async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T) => Promise<R>,
): Promise<R[]> {
	const out: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return out;
}

/**
 * Trending lists only verified videos. Checks the unverified ones that would
 * rank highest: with an API key via videos.list (which also corrects their
 * stats, and deletes unlisted or private ones), otherwise via oEmbed
 * (existence plus real title and channel name). Ids YouTube doesn't know are
 * marked unavailable. oEmbed answers for unlisted videos too, so without an
 * API key the server relies on the extension's visibility check alone (the
 * privacy copy says so).
 */
async function verifyVideos(
	deps: Deps,
	yt: YouTubeClientOptions | undefined,
	oembed: OEmbedOptions | undefined,
	now: Date,
	errors: string[],
): Promise<RefreshReport["verified"]> {
	const L = REFRESH_LIMITS;
	const t = now.getTime();
	const report: RefreshReport["verified"] = {
		via: yt ? "api" : "oembed",
		checked: 0,
		verified: 0,
		unavailable: 0,
		nonPublic: 0,
	};
	const candidates = await deps.db
		.select({ id: videos.id })
		.from(videos)
		.where(
			and(
				isNull(videos.verifiedAt),
				isNull(videos.unavailableAt),
				isNotNull(videos.recentVph),
				gte(videos.publishedAt, new Date(t - L.verifyWindowDays * DAY_MS)),
			),
		)
		.orderBy(desc(videos.recentVph))
		.limit(L.verifyPerRun * 2);
	if (candidates.length === 0) return report;

	// Skip ids that got an inconclusive answer recently.
	const attempts = await tryRedis(() => {
		const pipeline = deps.redis.pipeline();
		for (const c of candidates) {
			pipeline.set(
				verifyAttemptKey(c.id),
				String(t),
				"EX",
				L.verifyRetryHours * 3600,
				"NX",
			);
		}
		return pipeline.exec();
	});
	const ids = candidates
		.filter((_, i) => {
			if (!attempts.ok) return true;
			const reply = attempts.value?.[i];
			return !reply || reply[0] != null || reply[1] === "OK";
		})
		.map((c) => c.id);

	const markUnavailable = async (missing: string[]) => {
		if (missing.length === 0) return;
		await deps.db
			.update(videos)
			.set({ unavailableAt: now, updatedAt: now })
			.where(inArray(videos.id, missing));
		report.unavailable += missing.length;
	};

	if (yt) {
		for (const chunkIds of chunk(
			ids.slice(0, L.verifyPerRun),
			YOUTUBE_MAX_IDS_PER_CALL,
		)) {
			let items: ApiVideo[];
			try {
				items = await fetchVideos(yt, chunkIds);
			} catch (error) {
				errors.push(`verify videos.list: ${describeError(error)}`);
				break;
			}
			report.checked += chunkIds.length;
			const visibility = byPrivacy(items);
			report.verified += await applyVideoUpdates(deps, visibility.listed, now);
			report.nonPublic += await deleteNonPublicVideos(
				deps,
				visibility.nonPublic,
			);
			const returned = new Set(items.map((v) => v.id));
			await markUnavailable(chunkIds.filter((id) => !returned.has(id)));
		}
		return report;
	}

	const batch = ids.slice(0, L.verifyOEmbedPerRun);
	const results = await mapLimit(batch, L.verifyConcurrency, (id) =>
		lookupOEmbed(id, oembed),
	);
	report.checked = batch.length;
	const found = batch.flatMap((id, i) => {
		const r = results[i];
		return r?.status === "found"
			? [{ id, title: r.title, channelTitle: r.channelTitle }]
			: [];
	});
	if (found.length) {
		const nowIso = now.toISOString();
		// YouTube's own title and channel name replace the crowdsourced ones.
		await deps.db.execute(sql`
			update ${videos} as v set
				verified_at = ${nowIso}::timestamptz,
				title = d.title,
				channel_title = coalesce(d.channel_title, v.channel_title),
				updated_at = ${nowIso}::timestamptz
			from (values ${valuesList(
				found.map(
					(f) =>
						sql`(${f.id}::text, ${f.title}::text, ${f.channelTitle}::text)`,
				),
			)}) as d(id, title, channel_title)
			where v.id = d.id
		`);
		report.verified = found.length;
	}
	await markUnavailable(
		batch.filter((_, i) => results[i]?.status === "missing"),
	);
	return report;
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

function rowCount(
	result: { rowCount?: number | null } | { rowCount?: number | null }[],
): number {
	const list = Array.isArray(result) ? result : [result];
	return list.reduce((sum, r) => sum + (r.rowCount ?? 0), 0);
}

async function pruneSnapshots(deps: Deps, now: Date, full: boolean) {
	const L = REFRESH_LIMITS;
	const thinBefore = new Date(now.getTime() - L.snapshotThinAfterDays * DAY_MS);
	const thinFrom = new Date(
		now.getTime() -
			(full
				? L.snapshotRetentionDays
				: L.snapshotThinAfterDays + L.hourlyThinBandDays) *
				DAY_MS,
	);

	// Keep the last snapshot of every (video, UTC hour) older than 7 days.
	const thinned = await deps.db.execute(sql`
		delete from ${videoSnapshots} as s
		using (
			select video_id, captured_at,
				row_number() over (
					partition by video_id, date_trunc('hour', captured_at at time zone 'UTC')
					order by captured_at desc
				) as rn
			from ${videoSnapshots}
			where captured_at < ${thinBefore.toISOString()}::timestamptz
				and captured_at >= ${thinFrom.toISOString()}::timestamptz
		) as d
		where s.video_id = d.video_id and s.captured_at = d.captured_at and d.rn > 1
	`);

	const expired = await deps.db
		.delete(videoSnapshots)
		.where(
			lt(
				videoSnapshots.capturedAt,
				new Date(now.getTime() - L.snapshotRetentionDays * DAY_MS),
			),
		);

	return { thinned: rowCount(thinned), expired: rowCount(expired) };
}

// ---------------------------------------------------------------------------
// Privacy cleanup (daily)
// ---------------------------------------------------------------------------

/**
 * Stored avatars are canonical (`canonicalYouTubeImageUrl`: lowercase
 * `https://<host>/...`), so a valid one always matches this. Case-sensitive
 * on purpose: an uppercase host is valid but not canonical.
 */
const CANONICAL_AVATAR_PATTERN = `^https://(${YOUTUBE_IMAGE_HOSTS.map((host) =>
	host.replaceAll(".", "\\."),
).join("|")})/`;

/**
 * Avatars are rendered by the web app, so a stored URL on any other host
 * would make visitors' browsers contact it. Ingest drops those and stores
 * the rest in canonical form; this fixes rows stored before that: foreign
 * or invalid URLs are cleared, valid but non-canonical ones are rewritten.
 * Every selected row is changed, so the per-day limit can't be used up by
 * the same rows day after day.
 */
export async function clearForeignAvatars(deps: Deps): Promise<number> {
	const candidates = await deps.db
		.select({ id: channels.id, avatarUrl: channels.avatarUrl })
		.from(channels)
		.where(
			and(
				isNotNull(channels.avatarUrl),
				sql`(${channels.avatarUrl} !~ ${CANONICAL_AVATAR_PATTERN} or length(${channels.avatarUrl}) > 2000)`,
			),
		)
		.orderBy(channels.id)
		.limit(REFRESH_LIMITS.avatarCleanupPerDay);
	const bad: string[] = [];
	const rewrites: SQL[] = [];
	for (const c of candidates) {
		const canonical = canonicalYouTubeImageUrl(c.avatarUrl);
		if (canonical == null) bad.push(c.id);
		else if (canonical !== c.avatarUrl)
			rewrites.push(sql`(${c.id}::text, ${canonical}::text)`);
	}
	for (const ids of chunk(bad, 1_000)) {
		await deps.db
			.update(channels)
			.set({ avatarUrl: null })
			.where(inArray(channels.id, ids));
	}
	for (const rows of chunk(rewrites, 500)) {
		await deps.db.execute(sql`
			update ${channels} as c set avatar_url = d.url
			from (values ${valuesList(rows)}) as d(id, url)
			where c.id = d.id
		`);
	}
	return bad.length;
}

async function privacyCleanup(
	deps: Deps,
	now: Date,
): Promise<Exclude<RefreshReport["cleanup"], "not-due">> {
	const avatarsCleared = await clearForeignAvatars(deps);
	const expiredSessions = await deps.db
		.delete(session)
		.where(lt(session.expiresAt, now));
	const expiredVerifications = await deps.db
		.delete(verification)
		.where(lt(verification.expiresAt, now));
	// The api-key plugin also deletes expired keys, but only while its own
	// endpoints are being called. Keys without an expiry never match.
	const expiredApiKeys = await deps.db
		.delete(apikey)
		.where(lt(apikey.expiresAt, now));
	// packages/auth stores neither; this blanks rows written before it did.
	const sessionsScrubbed = await deps.db
		.update(session)
		.set({ ipAddress: null, userAgent: null })
		.where(or(isNotNull(session.ipAddress), isNotNull(session.userAgent)));
	return {
		avatarsCleared,
		expiredSessions: rowCount(expiredSessions),
		expiredVerifications: rowCount(expiredVerifications),
		expiredApiKeys: rowCount(expiredApiKeys),
		sessionsScrubbed: rowCount(sessionsScrubbed),
	};
}

// ---------------------------------------------------------------------------

export async function runScheduledRefresh(
	deps: Deps,
	options: RefreshOptions = {},
): Promise<RefreshReport> {
	const now = options.now ?? new Date();
	const day = utcDay(now);
	const errors: string[] = [];
	const apiKey = options.apiKey?.trim() || undefined;
	const yt: YouTubeClientOptions | undefined = apiKey
		? { apiKey, ...options.youtube }
		: undefined;

	// Each daily step runs on the first run of the UTC day that completes it
	// (a missed or failed run is caught up the next hour); without Redis, on
	// the 00:xx run.
	const dailyDue = async (step: DailyStep) => {
		if (options.forceDaily === true) return true;
		const marker = await tryRedis(() =>
			deps.redis.get(dailyMarkerKey(step, day)),
		);
		return marker.ok ? marker.value == null : now.getUTCHours() === 0;
	};
	const markDailyDone = (step: DailyStep) =>
		tryRedis(() =>
			deps.redis.set(
				dailyMarkerKey(step, day),
				now.toISOString(),
				"EX",
				2 * 24 * 60 * 60,
			),
		);
	const channelsDue = yt ? await dailyDue("channels") : false;
	const fullPrune = await dailyDue("prune");
	const cleanupDue = await dailyDue("cleanup");

	const report: RefreshReport = {
		ranAt: now.toISOString(),
		daily: channelsDue || fullPrune || cleanupDue,
		videos: "skipped",
		verified: {
			via: yt ? "api" : "oembed",
			checked: 0,
			verified: 0,
			unavailable: 0,
			nonPublic: 0,
		},
		channels: yt ? (channelsDue ? "skipped" : "not-due") : "skipped",
		pruned: { thinned: 0, expired: 0 },
		cleanup: "not-due",
		errors,
	};

	if (!yt) {
		console.log(
			"cron: YOUTUBE_API_KEY not set, skipping YouTube Data API refresh",
		);
	} else {
		try {
			report.videos = await refreshVideos(deps, yt, now, errors);
		} catch (error) {
			errors.push(`videos: ${describeError(error)}`);
		}
	}

	try {
		report.verified = await verifyVideos(deps, yt, options.oembed, now, errors);
	} catch (error) {
		errors.push(`verify: ${describeError(error)}`);
	}

	if (yt && channelsDue) {
		const before = errors.length;
		try {
			report.channels = await refreshChannels(deps, yt, now, errors);
		} catch (error) {
			errors.push(`channels: ${describeError(error)}`);
		}
		if (errors.length === before) await markDailyDone("channels");
	}

	try {
		report.pruned = await pruneSnapshots(deps, now, fullPrune);
		if (fullPrune) await markDailyDone("prune");
	} catch (error) {
		errors.push(`prune: ${describeError(error)}`);
	}

	if (cleanupDue) {
		try {
			report.cleanup = await privacyCleanup(deps, now);
			await markDailyDone("cleanup");
		} catch (error) {
			errors.push(`cleanup: ${describeError(error)}`);
		}
	}

	return report;
}
