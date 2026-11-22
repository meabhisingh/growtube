/**
 * Crowdsourced YouTube stats.
 *
 * Clients (the extension) report what they see on youtube.com; an hourly cron
 * tops this up from the YouTube Data API when a key is configured. Videos may
 * reference channels we have never seen a channel page for: ingestion always
 * upserts a stub `channels` row first, so `videos.channel_id` is a real FK.
 */
import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	date,
	doublePrecision,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) =>
	timestamp(name, { withTimezone: true, mode: "date" });

/** Counts can exceed 2^31 (views) but stay well below 2^53. */
const count = (name: string) => bigint(name, { mode: "number" });

export const SNAPSHOT_SOURCES = ["client", "cron"] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

export const VPH_SOURCES = ["recent", "lifetime"] as const;
export type VphSource = (typeof VPH_SOURCES)[number];

export const channels = pgTable(
	"channels",
	{
		/** UC… channel id */
		id: text("id").primaryKey(),
		handle: text("handle"),
		title: text("title"),
		avatarUrl: text("avatar_url"),
		subscribers: count("subscribers"),
		totalViews: count("total_views"),
		videoCount: integer("video_count"),
		/** YYYY-MM-DD */
		joinedAt: date("joined_at", { mode: "string" }),
		country: text("country"),
		keywords: text("keywords").array(),
		firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),
		/** Last time a client reported this channel or one of its videos. */
		lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),
		/** Last successful YouTube Data API refresh (cron). */
		lastRefreshedAt: timestamptz("last_refreshed_at"),
		/**
		 * Set when channels.list stops returning the channel (terminated, or an
		 * id that never existed); cleared when it comes back. Such channels are
		 * refreshed last so they can't use up the daily budget.
		 */
		unavailableAt: timestamptz("unavailable_at"),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index("channels_last_seen_at_idx").on(t.lastSeenAt),
		// Handle lookups are case-insensitive.
		index("channels_handle_lower_idx").on(sql`lower(${t.handle})`),
	],
);

export const videos = pgTable(
	"videos",
	{
		id: text("id").primaryKey(),
		channelId: text("channel_id").references(() => channels.id, {
			onDelete: "set null",
		}),
		title: text("title"),
		channelTitle: text("channel_title"),
		publishedAt: timestamptz("published_at"),
		durationSec: integer("duration_sec"),
		isShort: boolean("is_short"),
		latestViews: count("latest_views").default(0).notNull(),
		latestLikes: count("latest_likes"),
		latestComments: count("latest_comments"),
		/**
		 * Views/hour: momentum over the last 48h of snapshots when there are
		 * enough of them, else the lifetime average (see `vphSource`).
		 * Denormalized so trending is a single indexed scan.
		 */
		recentVph: doublePrecision("recent_vph"),
		vphSource: text("vph_source", { enum: VPH_SOURCES }),
		firstSeenAt: timestamptz("first_seen_at").defaultNow().notNull(),
		/** Last time a client (not the cron) reported this video. */
		lastSeenAt: timestamptz("last_seen_at").defaultNow().notNull(),
		lastSnapshotAt: timestamptz("last_snapshot_at"),
		/** Set when the Data API stops returning the video (private/deleted). */
		unavailableAt: timestamptz("unavailable_at"),
		/**
		 * When YouTube itself confirmed the video exists (Data API refresh or
		 * oEmbed check by the cron). Crowdsourced reports are anonymous, so
		 * only verified videos are listed in trending.
		 */
		verifiedAt: timestamptz("verified_at"),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [
		index("videos_channel_id_idx").on(t.channelId),
		// Trending: published within the window, ordered by VPH.
		index("videos_published_at_idx").on(t.publishedAt),
		index("videos_recent_vph_idx")
			.on(t.recentVph.desc())
			.where(sql`${t.recentVph} is not null`),
		// Cron selection: stalest recently-seen videos first.
		index("videos_last_snapshot_at_idx").on(
			t.lastSnapshotAt.asc().nullsFirst(),
		),
		index("videos_last_seen_at_idx").on(t.lastSeenAt),
	],
);

export const videoSnapshots = pgTable(
	"video_snapshots",
	{
		videoId: text("video_id")
			.notNull()
			.references(() => videos.id, { onDelete: "cascade" }),
		capturedAt: timestamptz("captured_at").defaultNow().notNull(),
		views: count("views").notNull(),
		likes: count("likes"),
		comments: count("comments"),
		source: text("source", { enum: SNAPSHOT_SOURCES }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.videoId, t.capturedAt] }),
		// Pruning scans by age across all videos.
		index("video_snapshots_captured_at_idx").on(t.capturedAt),
	],
);

export const channelSnapshots = pgTable(
	"channel_snapshots",
	{
		channelId: text("channel_id")
			.notNull()
			.references(() => channels.id, { onDelete: "cascade" }),
		/** UTC day, YYYY-MM-DD */
		day: date("day", { mode: "string" }).notNull(),
		subscribers: count("subscribers"),
		totalViews: count("total_views"),
		videoCount: integer("video_count"),
		updatedAt: timestamptz("updated_at")
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(t) => [primaryKey({ columns: [t.channelId, t.day] })],
);

export type Channel = typeof channels.$inferSelect;
export type NewChannel = typeof channels.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type VideoSnapshot = typeof videoSnapshots.$inferSelect;
export type ChannelSnapshot = typeof channelSnapshots.$inferSelect;
