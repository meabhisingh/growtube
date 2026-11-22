import {
	and,
	asc,
	channels,
	eq,
	gte,
	inArray,
	lte,
	sql,
	videoSnapshots,
	videos,
} from "@growtube/db";
import {
	computeRecentVph,
	computeVph,
	type HistoryRange,
	type IngestResponse,
	type VideoHistoryPoint,
	type VideoHistoryResponse,
	type VideoSnapshotInput,
	type VideoStats,
	type VideoStatsResponse,
	type VphSource,
} from "@growtube/shared";

import { type Cached, cachedJson, cacheKeys, invalidate } from "../lib/cache";
import { tryRedis } from "../lib/redis";
import type { Deps } from "../types";
import {
	type Executor,
	excluded,
	keepKnown,
	qualified,
	toIso,
	valuesList,
} from "./sql";

const HOUR_MS = 3_600_000;
/** One snapshot per video per 10 minutes from clients. */
export const SNAPSHOT_THROTTLE_SECONDS = 600;
/** Momentum window for `recentVph`. */
export const RECENT_VPH_WINDOW_HOURS = 48;
export const MAX_HISTORY_POINTS = 200;
export const VIDEO_HISTORY_CACHE_SECONDS = 120;
/** First public YouTube upload was 2005-04-23; anything earlier is bogus. */
const YOUTUBE_EPOCH_MS = Date.UTC(2005, 3, 1);
const HISTORY_RANGES: HistoryRange[] = ["24h", "7d", "28d", "all"];

/** Every cached history entry of these videos (all ranges). */
export const videoHistoryCacheKeys = (ids: Iterable<string>) =>
	[...ids].flatMap((id) =>
		HISTORY_RANGES.map((r) => cacheKeys.videoHistory(id, r)),
	);
const RANGE_MS: Record<Exclude<HistoryRange, "all">, number> = {
	"24h": 24 * HOUR_MS,
	"7d": 7 * 24 * HOUR_MS,
	"28d": 28 * 24 * HOUR_MS,
};

export const snapshotThrottleKey = (videoId: string) => `snap:v:${videoId}`;

// Reports are anonymous, so a view count is only accepted when it is
// physically plausible. Record-setting videos gain ~4–5M views/hour on
// launch day; nothing on YouTube has more than ~20B views.
/** Fastest believable growth, in views per hour. */
export const MAX_PLAUSIBLE_VIEWS_PER_HOUR = 5_000_000;
/** Above the most-viewed video on YouTube. */
export const MAX_PLAUSIBLE_VIEWS = 20_000_000_000;
/** Any report may claim at least this much growth. */
const MIN_VIEWS_ALLOWANCE = 10_000;

/** What the server already knows about a reported video. */
export type KnownVideo = {
	latestViews: number;
	lastSnapshotAt: Date | null;
	firstSeenAt: Date;
};

/**
 * Highest view count one anonymous report may set: twice the stored count,
 * or the stored count plus record growth since it was recorded (for a new
 * video: record growth since its publish time). Views only go up, so an
 * inflated value would otherwise stick for good.
 */
export function maxPlausibleViews(
	known: KnownVideo | undefined,
	publishedAt: Date | undefined,
	now: number,
): number {
	if (known) {
		const since = (known.lastSnapshotAt ?? known.firstSeenAt).getTime();
		const hours = Math.max((now - since) / HOUR_MS, 0);
		return Math.min(
			MAX_PLAUSIBLE_VIEWS,
			Math.max(
				known.latestViews * 2 + MIN_VIEWS_ALLOWANCE,
				known.latestViews + MAX_PLAUSIBLE_VIEWS_PER_HOUR * hours,
			),
		);
	}
	if (!publishedAt) return MAX_PLAUSIBLE_VIEWS;
	const hours = Math.max((now - publishedAt.getTime()) / HOUR_MS, 0);
	return Math.min(
		MAX_PLAUSIBLE_VIEWS,
		Math.max(MIN_VIEWS_ALLOWANCE, MAX_PLAUSIBLE_VIEWS_PER_HOUR * hours),
	);
}

async function loadKnownVideos(
	exec: Executor,
	ids: string[],
): Promise<Map<string, KnownVideo>> {
	if (ids.length === 0) return new Map();
	const rows = await exec
		.select({
			id: videos.id,
			latestViews: videos.latestViews,
			lastSnapshotAt: videos.lastSnapshotAt,
			firstSeenAt: videos.firstSeenAt,
		})
		.from(videos)
		.where(inArray(videos.id, ids));
	return new Map(rows.map(({ id, ...known }) => [id, known]));
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

type MergedVideo = Omit<VideoSnapshotInput, "publishedAt"> & {
	publishedAt?: Date;
};

/** Drops impossible publish dates (before YouTube existed, or in the future). */
function sanePublishedAt(
	iso: string | undefined,
	now: number,
): Date | undefined {
	if (!iso) return undefined;
	const t = Date.parse(iso);
	if (!Number.isFinite(t) || t < YOUTUBE_EPOCH_MS || t > now + HOUR_MS) {
		return undefined;
	}
	return new Date(t);
}

function definedEntries<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(value).filter(([, v]) => v !== undefined),
	) as Partial<T>;
}

/**
 * Collapses duplicate ids in one batch (a multi-row upsert can't touch the
 * same row twice): later defined fields win, views keep the max.
 */
function mergeVideoInputs(inputs: VideoSnapshotInput[], now: number) {
	const merged = new Map<string, MergedVideo>();
	for (const input of inputs) {
		const next: MergedVideo = {
			...input,
			publishedAt: sanePublishedAt(input.publishedAt, now),
		};
		const prev = merged.get(input.videoId);
		merged.set(
			input.videoId,
			prev
				? {
						...prev,
						...definedEntries(next),
						views: Math.max(prev.views, next.views),
						publishedAt:
							prev.publishedAt && next.publishedAt
								? new Date(
										Math.min(
											prev.publishedAt.getTime(),
											next.publishedAt.getTime(),
										),
									)
								: (prev.publishedAt ?? next.publishedAt),
					}
				: next,
		);
	}
	// Stable lock order across concurrent batches avoids upsert deadlocks.
	return [...merged.values()].sort((a, b) =>
		a.videoId.localeCompare(b.videoId),
	);
}

/**
 * Decides which videos get a new snapshot: at most one per video every
 * 10 minutes. Uses Redis `SET NX EX`; if Redis is unavailable falls back to
 * the `last_snapshot_at` column.
 */
async function claimSnapshotSlots(
	{ redis }: Deps,
	ids: string[],
	known: Map<string, KnownVideo>,
	now: Date,
): Promise<Set<string>> {
	if (ids.length === 0) return new Set();
	const claimed = await tryRedis(() => {
		const pipeline = redis.pipeline();
		for (const id of ids) {
			pipeline.set(
				snapshotThrottleKey(id),
				String(now.getTime()),
				"EX",
				SNAPSHOT_THROTTLE_SECONDS,
				"NX",
			);
		}
		return pipeline.exec();
	});
	if (claimed.ok && claimed.value?.every(([err]) => !err)) {
		const due = new Set<string>();
		claimed.value.forEach(([, reply], i) => {
			const id = ids[i];
			if (reply === "OK" && id) due.add(id);
		});
		return due;
	}

	console.warn(
		"ingest: redis unavailable, throttling snapshots via the database",
	);
	const cutoff = now.getTime() - SNAPSHOT_THROTTLE_SECONDS * 1000;
	return new Set(
		ids.filter((id) => {
			const t = known.get(id)?.lastSnapshotAt;
			return !t || t.getTime() <= cutoff;
		}),
	);
}

/**
 * Upserts stub channel rows so `videos.channel_id` can reference them, and
 * marks those channels as recently seen (keeps them in the daily refresh).
 */
export async function upsertChannelStubs(
	exec: Executor,
	stubs: { id: string; title?: string | null }[],
	opts: { seenAt?: Date } = {},
) {
	const byId = new Map<string, string | null>();
	for (const s of stubs) {
		if (!byId.has(s.id) || s.title)
			byId.set(s.id, s.title ?? byId.get(s.id) ?? null);
	}
	if (byId.size === 0) return;
	const rows = [...byId.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, title]) => ({
			id,
			title,
			...(opts.seenAt ? { lastSeenAt: opts.seenAt } : {}),
		}));
	await exec
		.insert(channels)
		.values(rows)
		.onConflictDoUpdate({
			target: channels.id,
			set: {
				// A channel page visit is a better source than a video's byline.
				title: sql`coalesce(${qualified(channels, channels.title)}, ${excluded(channels.title)})`,
				...(opts.seenAt ? { lastSeenAt: opts.seenAt } : {}),
			},
		});
}

/**
 * Upsert rule for a client-reported publish time. Clients often derive it
 * from "3 days ago", which is floored, i.e. at or after the real time, so an
 * earlier report is usually more precise and wins. To keep one bogus report
 * from sticking, an earlier value may move the date back by at most the
 * video's current age (min. 1 day); later values are ignored. The cron
 * overwrites it with the Data API's exact value.
 */
function mergePublishedAt() {
	const cur = qualified(videos, videos.publishedAt);
	const next = excluded(videos.publishedAt);
	return sql`case
		when ${cur} is null then ${next}
		when ${next} is null then ${cur}
		when ${next} < ${cur}
			and ${next} >= ${cur} - greatest(now() - ${cur}, interval '1 day') then ${next}
		else ${cur}
	end`;
}

export type MomentumTarget = {
	id: string;
	latestViews: number;
	publishedAt: Date | null;
};

/**
 * After new snapshots were written: recomputes `recent_vph` from the last
 * 48h of snapshots (lifetime VPH when there isn't enough history) and
 * stamps `last_snapshot_at`.
 */
export async function updateVideoMomentum(
	exec: Executor,
	targets: MomentumTarget[],
	snapshotAt: Date,
): Promise<void> {
	if (targets.length === 0) return;
	const ids = targets.map((t) => t.id);
	const since = new Date(
		snapshotAt.getTime() - RECENT_VPH_WINDOW_HOURS * HOUR_MS,
	);
	const snaps = await exec
		.select({
			videoId: videoSnapshots.videoId,
			t: videoSnapshots.capturedAt,
			views: videoSnapshots.views,
		})
		.from(videoSnapshots)
		.where(
			and(
				inArray(videoSnapshots.videoId, ids),
				gte(videoSnapshots.capturedAt, since),
			),
		)
		.orderBy(asc(videoSnapshots.capturedAt));

	const pointsById = new Map<string, { t: Date; views: number }[]>();
	for (const s of snaps) {
		const list = pointsById.get(s.videoId) ?? [];
		list.push({ t: s.t, views: s.views });
		pointsById.set(s.videoId, list);
	}

	const rows = targets.map((target) => {
		const { vph, source } = momentumFor(
			pointsById.get(target.id) ?? [],
			target,
			snapshotAt.getTime(),
		);
		return sql`(${target.id}::text, ${vph}::double precision, ${source}::text)`;
	});

	await exec.execute(sql`
		update ${videos} as v
		set recent_vph = d.vph,
			vph_source = d.src,
			last_snapshot_at = ${snapshotAt.toISOString()}::timestamptz,
			updated_at = now()
		from (values ${valuesList(rows)}) as d(id, vph, src)
		where v.id = d.id
	`);
}

function momentumFor(
	points: { t: Date; views: number }[],
	target: MomentumTarget,
	now: number,
): { vph: number | null; source: VphSource | null } {
	const recent = computeRecentVph(points, RECENT_VPH_WINDOW_HOURS);
	if (recent != null && Number.isFinite(recent)) {
		return { vph: recent, source: "recent" };
	}
	if (target.publishedAt) {
		const lifetime = computeVph(target.latestViews, target.publishedAt, now);
		if (lifetime != null && Number.isFinite(lifetime)) {
			return { vph: lifetime, source: "lifetime" };
		}
	}
	return { vph: null, source: null };
}

/**
 * `POST /v1/ingest/videos`. Upserts video metadata and records a snapshot
 * (with the reported view count) for each video not snapshotted in the last
 * 10 minutes.
 *
 * Reports with an implausible view count (see `maxPlausibleViews`) are
 * ignored entirely. The stored view count only changes together with a
 * snapshot, so the plausibility check always compares against the value
 * and time of the last snapshot (repeated reports can't ratchet it up).
 *
 * `accepted` = videos that got a new snapshot; `skipped` = throttled,
 * duplicate or implausible entries (throttled ones still merge metadata).
 */
export async function ingestVideos(
	deps: Deps,
	inputs: VideoSnapshotInput[],
): Promise<IngestResponse> {
	const now = new Date();
	const merged = mergeVideoInputs(inputs, now.getTime());
	const known = await loadKnownVideos(
		deps.db,
		merged.map((r) => r.videoId),
	);
	const rows = merged.filter(
		(r) =>
			r.views <=
			maxPlausibleViews(known.get(r.videoId), r.publishedAt, now.getTime()),
	);
	if (rows.length < merged.length) {
		console.warn(
			`ingest: ignored ${merged.length - rows.length} implausible video report(s)`,
		);
	}
	if (rows.length === 0) return { accepted: 0, skipped: inputs.length };
	const ids = rows.map((r) => r.videoId);
	const due = await claimSnapshotSlots(deps, ids, known, now);
	const dueIds = [...due];

	const accepted = await deps.db.transaction(async (tx) => {
		await upsertChannelStubs(
			tx,
			rows.flatMap((r) =>
				r.channelId ? [{ id: r.channelId, title: r.channelTitle }] : [],
			),
			{ seenAt: now },
		);

		const upserted = await tx
			.insert(videos)
			.values(
				rows.map((r) => ({
					id: r.videoId,
					channelId: r.channelId,
					title: r.title,
					channelTitle: r.channelTitle,
					publishedAt: r.publishedAt,
					durationSec: r.durationSec,
					isShort: r.isShort,
					latestViews: r.views,
					latestLikes: r.likes,
					latestComments: r.comments,
					firstSeenAt: now,
					lastSeenAt: now,
					updatedAt: now,
				})),
			)
			.onConflictDoUpdate({
				target: videos.id,
				set: {
					channelId: keepKnown(videos, videos.channelId),
					title: keepKnown(videos, videos.title),
					channelTitle: keepKnown(videos, videos.channelTitle),
					publishedAt: mergePublishedAt(),
					durationSec: keepKnown(videos, videos.durationSec),
					isShort: keepKnown(videos, videos.isShort),
					// Views change only with a snapshot (see above), and only go up: a
					// lower report is a stale value.
					latestViews: sql`case
						when ${excluded(videos.id)} = any(${sql.param(dueIds)}::text[])
						then greatest(${qualified(videos, videos.latestViews)}, ${excluded(videos.latestViews)})
						else ${qualified(videos, videos.latestViews)}
					end`,
					latestLikes: keepKnown(videos, videos.latestLikes),
					latestComments: keepKnown(videos, videos.latestComments),
					lastSeenAt: now,
					unavailableAt: null,
					updatedAt: now,
				},
			})
			.returning({
				id: videos.id,
				latestViews: videos.latestViews,
				publishedAt: videos.publishedAt,
			});

		const snapshotRows = upserted.filter((v) => due.has(v.id));
		if (snapshotRows.length === 0) return 0;

		const byId = new Map(rows.map((r) => [r.videoId, r]));
		await tx
			.insert(videoSnapshots)
			.values(
				snapshotRows.map((v) => ({
					videoId: v.id,
					capturedAt: now,
					// Best known lower bound right now (see GREATEST above).
					views: v.latestViews,
					likes: byId.get(v.id)?.likes ?? null,
					comments: byId.get(v.id)?.comments ?? null,
					source: "client" as const,
				})),
			)
			.onConflictDoNothing();
		await updateVideoMomentum(tx, snapshotRows, now);
		return snapshotRows.length;
	});

	if (accepted > 0) {
		await invalidate(deps.redis, videoHistoryCacheKeys(due));
	}
	return { accepted, skipped: inputs.length - accepted };
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

/**
 * Floors a timestamp to the UTC hour. firstSeenAt, lastSnapshotAt and client
 * snapshot times are when some user's browser reported a video (a client
 * snapshot is stored at the moment the report arrives), so the API only
 * ever says which hour that was: /v1/videos/stats, /v1/videos/:id/history
 * and the MCP tools.
 */
function floorToHour(date: Date): Date {
	return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

/**
 * One point per UTC hour, timed at the start of the hour: the latest
 * snapshot of that hour (views only go up, so it is the hour's best count).
 * `points` must be sorted by time.
 */
export function latestPerHour<T extends { t: Date }>(points: T[]): T[] {
	const out: T[] = [];
	for (const p of points) {
		const point = { ...p, t: floorToHour(p.t) };
		const last = out.at(-1);
		if (last && last.t.getTime() === point.t.getTime())
			out[out.length - 1] = point;
		else out.push(point);
	}
	return out;
}

/** `firstSeenAt` and point times at hour level (idempotent). */
export function coarsenHistory(
	history: VideoHistoryResponse,
): VideoHistoryResponse {
	const firstSeen = history.firstSeenAt ? new Date(history.firstSeenAt) : null;
	const points = latestPerHour(
		history.points
			.map((p) => ({ ...p, t: new Date(p.t) }))
			.filter((p) => Number.isFinite(p.t.getTime())),
	).map((p) => ({ ...p, t: p.t.toISOString() }));
	return {
		...history,
		firstSeenAt:
			firstSeen && Number.isFinite(firstSeen.getTime())
				? floorToHour(firstSeen).toISOString()
				: null,
		points,
	};
}

/**
 * Keeps at most `max` points: splits the time span into equal buckets and
 * keeps the latest point of each (plus the very first point), so dense
 * bursts of snapshots don't crowd out the rest of the timeline.
 */
export function downsampleByTime<T extends { t: Date }>(
	points: T[],
	max: number,
): T[] {
	if (points.length <= max) return points;
	const first = points[0];
	const last = points.at(-1);
	if (!first || !last || max < 2) return points.slice(-max);
	const start = first.t.getTime();
	const span = last.t.getTime() - start;
	if (span <= 0) return [first, last];
	const buckets = max - 1;
	const out: T[] = [first];
	let bucket = -1;
	let pending: T | undefined;
	for (const p of points.slice(1)) {
		const b = Math.min(
			buckets - 1,
			Math.floor(((p.t.getTime() - start) / span) * buckets),
		);
		if (b !== bucket && pending) out.push(pending);
		bucket = b;
		pending = p;
	}
	if (pending) out.push(pending);
	return out;
}

/** Views/hour over the ~48h before the latest snapshot (null if < 2 points). */
async function recentVphFromSnapshots(exec: Executor, videoId: string) {
	const latest = sql`(select max(${videoSnapshots.capturedAt}) from ${videoSnapshots} where ${videoSnapshots.videoId} = ${videoId})`;
	const points = await exec
		.select({ t: videoSnapshots.capturedAt, views: videoSnapshots.views })
		.from(videoSnapshots)
		.where(
			and(
				eq(videoSnapshots.videoId, videoId),
				gte(
					videoSnapshots.capturedAt,
					sql`${latest} - ${sql.raw(`interval '${RECENT_VPH_WINDOW_HOURS} hours'`)}`,
				),
			),
		)
		.orderBy(asc(videoSnapshots.capturedAt));
	return computeRecentVph(points, RECENT_VPH_WINDOW_HOURS);
}

export async function loadVideoHistory(
	exec: Executor,
	videoId: string,
	range: HistoryRange,
	now: Date = new Date(),
): Promise<VideoHistoryResponse> {
	const [video] = await exec
		.select({
			publishedAt: videos.publishedAt,
			firstSeenAt: videos.firstSeenAt,
			title: videos.title,
			channelId: videos.channelId,
			channelTitle: videos.channelTitle,
		})
		.from(videos)
		.where(eq(videos.id, videoId))
		.limit(1);

	if (!video) {
		return {
			videoId,
			range,
			publishedAt: null,
			firstSeenAt: null,
			points: [],
			recentVph: null,
		};
	}

	const filters = [eq(videoSnapshots.videoId, videoId)];
	if (range !== "all") {
		const length = RANGE_MS[range];
		const from = video.publishedAt ?? new Date(now.getTime() - length);
		const to = new Date(from.getTime() + length);
		filters.push(
			gte(videoSnapshots.capturedAt, from),
			lte(videoSnapshots.capturedAt, to),
		);
	}

	const [rows, recentVph] = await Promise.all([
		exec
			.select({
				t: videoSnapshots.capturedAt,
				views: videoSnapshots.views,
				likes: videoSnapshots.likes,
				comments: videoSnapshots.comments,
			})
			.from(videoSnapshots)
			.where(and(...filters))
			.orderBy(asc(videoSnapshots.capturedAt)),
		recentVphFromSnapshots(exec, videoId),
	]);

	const points: VideoHistoryPoint[] = downsampleByTime(
		latestPerHour(rows),
		MAX_HISTORY_POINTS,
	).map((p) => ({
		t: p.t.toISOString(),
		views: p.views,
		likes: p.likes,
		comments: p.comments,
	}));

	return {
		videoId,
		range,
		publishedAt: toIso(video.publishedAt),
		firstSeenAt: floorToHour(video.firstSeenAt).toISOString(),
		points,
		recentVph,
		title: video.title,
		channelId: video.channelId,
		channelTitle: video.channelTitle,
	};
}

/**
 * Cached (120s) video history, shared by the HTTP route and MCP. Times are
 * coarsened again on the way out, so an entry cached before history was
 * coarsened can't serve exact report times either.
 */
export async function getVideoHistory(
	{ db, redis }: Deps,
	videoId: string,
	range: HistoryRange,
): Promise<Cached<VideoHistoryResponse>> {
	const cached = await cachedJson(
		redis,
		cacheKeys.videoHistory(videoId, range),
		VIDEO_HISTORY_CACHE_SECONDS,
		() => loadVideoHistory(db, videoId, range),
	);
	return { ...cached, value: coarsenHistory(cached.value) };
}

// ---------------------------------------------------------------------------
// Batch stats
// ---------------------------------------------------------------------------

export async function getVideoStats(
	exec: Executor,
	ids: string[],
): Promise<VideoStatsResponse> {
	const rows = await exec.select().from(videos).where(inArray(videos.id, ids));
	const byId = new Map(rows.map((r) => [r.id, r]));
	const found: VideoStats[] = [];
	const missing: string[] = [];
	for (const id of ids) {
		const v = byId.get(id);
		if (!v) {
			missing.push(id);
			continue;
		}
		found.push({
			videoId: v.id,
			channelId: v.channelId,
			title: v.title,
			channelTitle: v.channelTitle,
			publishedAt: toIso(v.publishedAt),
			durationSec: v.durationSec,
			isShort: v.isShort,
			views: v.latestViews,
			likes: v.latestLikes,
			comments: v.latestComments,
			recentVph: v.recentVph == null ? null : Math.max(v.recentVph, 0),
			vphSource: v.vphSource,
			firstSeenAt: floorToHour(v.firstSeenAt).toISOString(),
			lastSnapshotAt: v.lastSnapshotAt
				? floorToHour(v.lastSnapshotAt).toISOString()
				: null,
		});
	}
	return { generatedAt: new Date().toISOString(), videos: found, missing };
}
