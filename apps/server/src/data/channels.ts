import { channelSnapshots, channels, desc, eq, sql } from "@growtube/db";
import type {
	ChannelHistoryResponse,
	ChannelResolveResponse,
	ChannelSnapshotInput,
	IngestResponse,
} from "@growtube/shared";
import { youTubeImageOrNull } from "@growtube/shared/images";

import { type Cached, cachedJson, cacheKeys, invalidate } from "../lib/cache";
import { canonicalYouTubeImageUrl } from "../lib/images";
import type { Deps } from "../types";
import { type Executor, keepKnown, utcDay } from "./sql";

export const CHANNEL_HISTORY_CACHE_SECONDS = 600;
/** ~3 years of daily points. */
const MAX_CHANNEL_HISTORY_DAYS = 1100;

/** `@handle` form; tolerates clients sending the bare name. */
export function normalizeHandle(
	handle: string | undefined | null,
): string | undefined {
	const trimmed = handle?.trim();
	if (!trimmed) return undefined;
	return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

function mergeChannelInputs(inputs: ChannelSnapshotInput[]) {
	const merged = new Map<string, ChannelSnapshotInput>();
	for (const input of inputs) {
		const prev = merged.get(input.channelId);
		const defined = Object.fromEntries(
			Object.entries(input).filter(([, v]) => v !== undefined),
		) as ChannelSnapshotInput;
		merged.set(input.channelId, prev ? { ...prev, ...defined } : defined);
	}
	return [...merged.values()].sort((a, b) =>
		a.channelId.localeCompare(b.channelId),
	);
}

export type DailyChannelStats = {
	channelId: string;
	subscribers?: number | null;
	totalViews?: number | null;
	videoCount?: number | null;
};

/**
 * Upserts the (channel, UTC day) snapshot row. Last write wins per field,
 * but a missing field never erases a value already recorded that day.
 */
export async function upsertChannelDailySnapshots(
	exec: Executor,
	rows: DailyChannelStats[],
	at: Date,
): Promise<void> {
	const day = utcDay(at);
	const values = rows
		.filter(
			(r) =>
				r.subscribers != null || r.totalViews != null || r.videoCount != null,
		)
		.map((r) => ({
			channelId: r.channelId,
			day,
			subscribers: r.subscribers ?? null,
			totalViews: r.totalViews ?? null,
			videoCount: r.videoCount ?? null,
			updatedAt: at,
		}));
	if (values.length === 0) return;
	await exec
		.insert(channelSnapshots)
		.values(values)
		.onConflictDoUpdate({
			target: [channelSnapshots.channelId, channelSnapshots.day],
			set: {
				subscribers: keepKnown(channelSnapshots, channelSnapshots.subscribers),
				totalViews: keepKnown(channelSnapshots, channelSnapshots.totalViews),
				videoCount: keepKnown(channelSnapshots, channelSnapshots.videoCount),
				updatedAt: at,
			},
		});
}

/**
 * `POST /v1/ingest/channels`. Upserts channel metadata and today's (UTC)
 * snapshot. `accepted` = channels stored, `skipped` = duplicates in the batch.
 */
export async function ingestChannels(
	deps: Deps,
	inputs: ChannelSnapshotInput[],
): Promise<IngestResponse> {
	const now = new Date();
	const rows = mergeChannelInputs(inputs);

	await deps.db.transaction(async (tx) => {
		await tx
			.insert(channels)
			.values(
				rows.map((r) => ({
					id: r.channelId,
					handle: normalizeHandle(r.handle),
					title: r.title,
					// Canonical form (see lib/images.ts and the daily avatar cleanup).
					avatarUrl: canonicalYouTubeImageUrl(r.avatarUrl),
					subscribers: r.subscribers,
					totalViews: r.totalViews,
					videoCount: r.videoCount,
					joinedAt: r.joinedAt,
					country: r.country,
					keywords: r.keywords,
					firstSeenAt: now,
					lastSeenAt: now,
					updatedAt: now,
				})),
			)
			.onConflictDoUpdate({
				target: channels.id,
				set: {
					handle: keepKnown(channels, channels.handle),
					title: keepKnown(channels, channels.title),
					avatarUrl: keepKnown(channels, channels.avatarUrl),
					subscribers: keepKnown(channels, channels.subscribers),
					totalViews: keepKnown(channels, channels.totalViews),
					videoCount: keepKnown(channels, channels.videoCount),
					joinedAt: keepKnown(channels, channels.joinedAt),
					country: keepKnown(channels, channels.country),
					keywords: keepKnown(channels, channels.keywords),
					lastSeenAt: now,
					updatedAt: now,
				},
			});
		await upsertChannelDailySnapshots(tx, rows, now);
	});

	await invalidate(
		deps.redis,
		rows.map((r) => cacheKeys.channelHistory(r.channelId)),
	);
	return { accepted: rows.length, skipped: inputs.length - rows.length };
}

export async function loadChannelHistory(
	exec: Executor,
	channelId: string,
): Promise<ChannelHistoryResponse> {
	const [rows, [channel]] = await Promise.all([
		exec
			.select({
				day: channelSnapshots.day,
				subscribers: channelSnapshots.subscribers,
				totalViews: channelSnapshots.totalViews,
				videoCount: channelSnapshots.videoCount,
			})
			.from(channelSnapshots)
			.where(eq(channelSnapshots.channelId, channelId))
			.orderBy(desc(channelSnapshots.day))
			.limit(MAX_CHANNEL_HISTORY_DAYS),
		exec
			.select({
				title: channels.title,
				handle: channels.handle,
				avatarUrl: channels.avatarUrl,
			})
			.from(channels)
			.where(eq(channels.id, channelId))
			.limit(1),
	]);
	return {
		channelId,
		points: rows.reverse(),
		title: channel?.title ?? null,
		handle: channel?.handle ?? null,
		avatarUrl: youTubeImageOrNull(channel?.avatarUrl),
	};
}

/**
 * Cached (10 min) channel history, shared by the HTTP route and MCP. The
 * avatar is re-checked on the way out, so an entry cached before the host
 * check existed can't serve another host either.
 */
export async function getChannelHistory(
	{ db, redis }: Deps,
	channelId: string,
): Promise<Cached<ChannelHistoryResponse>> {
	const cached = await cachedJson(
		redis,
		cacheKeys.channelHistory(channelId),
		CHANNEL_HISTORY_CACHE_SECONDS,
		() => loadChannelHistory(db, channelId),
	);
	return {
		...cached,
		value: {
			...cached.value,
			avatarUrl: youTubeImageOrNull(cached.value.avatarUrl),
		},
	};
}

/** Resolves an `@handle` to a channel id from channels we've seen. */
export async function findChannelIdByHandle(
	exec: Executor,
	handle: string,
): Promise<string | null> {
	return (await findChannelByHandle(exec, handle))?.channelId ?? null;
}

/** Like `findChannelIdByHandle`, with the display fields (GET /v1/channels/resolve). */
export async function findChannelByHandle(
	exec: Executor,
	handle: string,
): Promise<ChannelResolveResponse | null> {
	const normalized = normalizeHandle(handle);
	if (!normalized) return null;
	const [row] = await exec
		.select({
			channelId: channels.id,
			handle: channels.handle,
			title: channels.title,
		})
		.from(channels)
		.where(sql`lower(${channels.handle}) = lower(${normalized})`)
		// Handles move between channels over time: prefer the freshest owner.
		.orderBy(desc(channels.lastSeenAt))
		.limit(1);
	return row ?? null;
}
