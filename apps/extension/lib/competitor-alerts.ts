/**
 * Competitor outlier alerts. BACKGROUND ONLY.
 *
 * Every hour (alarm `ovq:competitor-alerts`, plus once a couple of minutes
 * after the browser starts) the background looks at each competitor's
 * long-form uploads of the last 7 days, compares their views with that
 * channel's baseline (median views of its recent settled uploads) and shows a
 * Chrome notification when one reaches the user's threshold (2× / 3× / 5×),
 * once it is at least `minAgeHours` old. A video alerts at most once (ids kept
 * for 30 days in `competitorAlertState.seen`); every alert also goes to the
 * in-app list (`competitorAlertLog`, Competitors tool).
 *
 * Polite by design: off by default, nothing while signed out, at most
 * MAX_CHANNELS_PER_RUN channels per run (round-robin), one channel at a time
 * with a pause in between, cached lookups (uploads 1 h, baselines 6 h) through
 * the shared InnerTube limiter. Everything stays in chrome.storage.local:
 * these lookups call lib/youtube directly, so nothing is crowdsourced.
 */
import { formatCompact } from "@growtube/shared/format";
import {
	computeOutlierScore,
	computeVph,
	hoursSince,
} from "@growtube/shared/metrics";
import { browser } from "wxt/browser";

import { hasSession } from "./auth-session";
import { keepAliveWhile } from "./keepalive";
import { sleep } from "./limiter";
import {
	type CompetitorAlert,
	type CompetitorAlertSettings,
	competitorAlertLog,
	competitorAlertSettings,
	competitorAlertState,
	competitors,
	MAX_ALERT_LOG,
	withAlertDefaults,
} from "./settings";
import {
	getChannelBaseline,
	getChannelVideos,
	getVideoDetails,
} from "./youtube";

export const COMPETITOR_ALERTS_ALARM = "ovq:competitor-alerts";
/** One-shot alarm a little after browser startup. */
export const COMPETITOR_ALERTS_STARTUP_ALARM = "ovq:competitor-alerts-startup";
export const COMPETITOR_ALERTS_MINUTES = 60;
export const COMPETITOR_ALERTS_STARTUP_DELAY_MINUTES = 2;

const NOTIFICATION_PREFIX = "ovq-alert:";
const RECENT_HOURS = 7 * 24;
const SEEN_TTL_MS = 30 * 24 * 3_600_000;
const MAX_CHANNELS_PER_RUN = 30;
const UPLOADS_PER_CHANNEL = 15;
const MAX_NOTIFICATIONS_PER_RUN = 3;
const STAGGER_MS = 1_500;
/** Scheduled runs closer together than this are skipped (startup + hourly). */
const MIN_SCHEDULED_GAP_MS = 20 * 60_000;

export type AlertRunResult = {
	/** Channels looked at */
	checked: number;
	/** New alerts recorded */
	alerts: number;
	skipped?: "signed-out" | "disabled" | "no-competitors" | "recent";
};

/** Local time `now` is within [start, end) (wrapping past midnight). */
export function inQuietHours(
	s: Pick<CompetitorAlertSettings, "quietHours" | "quietStart" | "quietEnd">,
	now = new Date(),
): boolean {
	if (!s.quietHours || s.quietStart === s.quietEnd) return false;
	const h = now.getHours();
	return s.quietStart < s.quietEnd
		? h >= s.quietStart && h < s.quietEnd
		: h >= s.quietStart || h < s.quietEnd;
}

function pruneSeen(seen: Record<string, number>, now: number) {
	const out: Record<string, number> = {};
	for (const [id, at] of Object.entries(seen))
		if (now - at < SEEN_TTL_MS) out[id] = at;
	return out;
}

function formatScore(score: number): string {
	return score >= 10 ? Math.round(score).toString() : score.toFixed(1);
}

async function showNotification(
	alert: CompetitorAlert,
	settings: CompetitorAlertSettings,
	more: number,
): Promise<boolean> {
	try {
		const runtime = browser.runtime as unknown as {
			getURL(path: string): string;
		};
		const who = alert.channelHandle ?? alert.channelTitle;
		await browser.notifications.create(
			`${NOTIFICATION_PREFIX}${alert.videoId}`,
			{
				type: "basic",
				iconUrl: runtime.getURL("/icon/128.png"),
				title: `${who}'s new video is at ${formatScore(alert.outlier)}× its usual views (${Math.round(alert.ageHours)} h old)`,
				message: `${alert.title} · ${formatCompact(alert.views)} views`,
				contextMessage:
					more > 0
						? `GrowTube · +${more} more in Competitors → Alerts`
						: "GrowTube competitor alert",
				silent: settings.silent,
				priority: 0,
			},
		);
		return true;
	} catch (error) {
		console.warn("[GrowTube] could not show an alert notification", error);
		return false;
	}
}

/** Clicking an alert opens the video on YouTube. Call once in the background. */
export function registerAlertNotifications(): void {
	browser.notifications?.onClicked.addListener((id) => {
		if (!id.startsWith(NOTIFICATION_PREFIX)) return;
		const videoId = id.slice(NOTIFICATION_PREFIX.length);
		if (/^[\w-]{11}$/.test(videoId))
			void browser.tabs
				.create({ url: `https://www.youtube.com/watch?v=${videoId}` })
				.catch(() => {});
		void browser.notifications.clear(id).catch(() => false);
	});
}

let running: Promise<AlertRunResult> | null = null;

/**
 * One alert run. Scheduled runs (`manual: false`) are skipped when the last
 * run was under 20 minutes ago. Concurrent calls share the run in progress.
 */
export function runCompetitorAlerts(
	opts: { manual?: boolean } = {},
): Promise<AlertRunResult> {
	if (!running)
		running = keepAliveWhile(run(!!opts.manual)).finally(() => {
			running = null;
		});
	return running;
}

async function run(manual: boolean): Promise<AlertRunResult> {
	if (!(await hasSession()))
		return { checked: 0, alerts: 0, skipped: "signed-out" };
	const settings = withAlertDefaults(await competitorAlertSettings.getValue());
	if (!settings.enabled) return { checked: 0, alerts: 0, skipped: "disabled" };
	const list = await competitors.getValue();
	const state = await competitorAlertState.getValue();
	const started = Date.now();
	if (
		!manual &&
		state.lastRunAt &&
		started - state.lastRunAt < MIN_SCHEDULED_GAP_MS
	)
		return { checked: 0, alerts: 0, skipped: "recent" };
	if (list.length === 0) {
		await competitorAlertState.setValue({
			...state,
			lastRunAt: started,
			lastError: null,
		});
		return { checked: 0, alerts: 0, skipped: "no-competitors" };
	}

	const seen = pruneSeen(state.seen ?? {}, started);
	const count = Math.min(list.length, MAX_CHANNELS_PER_RUN);
	const start = (state.cursor ?? 0) % list.length;
	const batch = Array.from(
		{ length: count },
		(_, i) => list[(start + i) % list.length],
	).filter((c): c is NonNullable<typeof c> => c != null);

	const found: CompetitorAlert[] = [];
	let lastError: string | null = null;
	let checked = 0;
	for (const [i, c] of batch.entries()) {
		if (i > 0) await sleep(STAGGER_MS);
		// Signed out mid-run: stop at once.
		if (!(await hasSession())) break;
		checked++;
		try {
			const uploads = await getChannelVideos(c.channelId, {
				tab: "videos",
				limit: UPLOADS_PER_CHANNEL,
			});
			const recent = uploads.filter(
				(v) =>
					!v.isLive &&
					!v.isUpcoming &&
					v.views != null &&
					!seen[v.videoId] &&
					v.publishedAt != null &&
					hoursSince(v.publishedAt) <= RECENT_HOURS,
			);
			if (recent.length === 0) continue;
			const { baseline } = await getChannelBaseline(c.channelId, "long");
			if (!baseline) continue;
			for (const v of recent) {
				// Tab view counts are rounded ("6.3K") and dates approximate: only
				// near-threshold candidates get an exact (cached) player lookup.
				if ((v.views ?? 0) / baseline < settings.threshold * 0.8) continue;
				const d = await getVideoDetails(v.videoId, { level: "basic" }).catch(
					() => null,
				);
				if (d && (d.isPrivate || d.isUnlisted || d.isLive || d.isUpcoming))
					continue;
				const views = d?.views ?? v.views ?? 0;
				const publishedAt = d?.publishedAt ?? v.publishedAt;
				if (!publishedAt) continue;
				const ageHours = hoursSince(publishedAt);
				// Too young: look again next run (not marked as seen).
				if (!Number.isFinite(ageHours) || ageHours < settings.minAgeHours)
					continue;
				if (ageHours > RECENT_HOURS) continue;
				const outlier = computeOutlierScore(views, baseline);
				if (outlier == null || outlier < settings.threshold) continue;
				seen[v.videoId] = Date.now();
				found.push({
					videoId: v.videoId,
					title: d?.title ?? v.title,
					channelId: c.channelId,
					channelTitle: c.title,
					channelHandle: c.handle,
					thumbnail: d?.thumbnailUrl ?? v.thumbnail ?? null,
					views,
					outlier,
					vph: computeVph(views, publishedAt),
					ageHours,
					publishedAt,
					at: Date.now(),
					notified: false,
				});
			}
		} catch (error) {
			lastError = `${c.title}: ${error instanceof Error ? error.message : String(error)}`;
			console.debug("[GrowTube] competitor alert check failed", error);
		}
	}

	// Biggest outliers first; only a few pop up per run.
	found.sort((a, b) => b.outlier - a.outlier);
	const quiet = inQuietHours(settings);
	if (!quiet) {
		const shown = found.slice(0, MAX_NOTIFICATIONS_PER_RUN);
		const more = found.length - shown.length;
		for (const [i, alert] of shown.entries())
			alert.notified = await showNotification(
				alert,
				settings,
				i === shown.length - 1 ? more : 0,
			);
	}

	if (found.length) {
		const log = await competitorAlertLog.getValue();
		const ids = new Set(found.map((a) => a.videoId));
		await competitorAlertLog.setValue(
			[...found, ...log.filter((a) => !ids.has(a.videoId))].slice(
				0,
				MAX_ALERT_LOG,
			),
		);
	}
	// Re-read so a list edited meanwhile keeps a sensible cursor.
	const latestLength = (await competitors.getValue()).length || 1;
	await competitorAlertState.setValue({
		seen,
		lastRunAt: Date.now(),
		lastError,
		cursor: (start + checked) % latestLength,
	});
	return { checked, alerts: found.length };
}
