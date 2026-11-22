/**
 * Content-script helpers that reuse what youtube.com already loaded, so the
 * current video is never fetched twice. youtube.com content scripts only.
 *
 *   const details = await getCurrentVideoDetails();          // watch / shorts page
 *   const off = onNavigate(async () => render(await getCurrentVideoDetails()));
 */
import { yt } from "../client";
import { sendToBackground } from "../messaging";
import { getCurrentPageData, getYtConfig } from "./bridge";
import { videoIdFromUrl } from "./page-type";
import type { VideoDetails, VideoDetailsLevel, YtPageData } from "./types";
import { parseNext, parsePlayer, type VideoSeed } from "./video";
import { withPageRestrictions } from "./visibility";

/** Re-send at most this often (the background also persists it per session). */
const CONFIG_RESYNC_MS = 60_000;
let lastSyncAt = 0;
let syncing: Promise<void> | null = null;

/**
 * Forwards the page's public client identity (client version, API key, gl)
 * to the background. Called on navigation and before video lookups; repeats
 * at most once a minute, so a background worker that restarted (and lost
 * its in-memory copy) gets it again quickly.
 */
export function syncConfigToBackground(): Promise<void> {
	if (syncing) return syncing;
	if (lastSyncAt && Date.now() - lastSyncAt < CONFIG_RESYNC_MS)
		return Promise.resolve();
	syncing = (async () => {
		try {
			const cfg = await getYtConfig();
			if (cfg.source !== "page") return;
			await sendToBackground("yt.setConfig", {
				clientName: cfg.clientName,
				clientVersion: cfg.clientVersion,
				apiKey: cfg.apiKey,
				gl: cfg.gl,
			});
			lastSyncAt = Date.now();
		} catch {
			// Retried on the next navigation / lookup.
		} finally {
			syncing = null;
		}
	})();
	return syncing;
}

/**
 * Parses the page's own player response / initial data into a seed for
 * `yt.getVideoDetails`. `next` is only used when the YouTube UI is English
 * (its text fields are localized); numeric player fields work in any language.
 */
export async function getVideoSeedFromPage(
	videoId: string,
	page?: YtPageData | null,
): Promise<VideoSeed | undefined> {
	const data = page ?? (await getCurrentPageData());
	if (!data || data.videoId !== videoId) return undefined;
	const player = parsePlayer(data.playerResponse);
	const cfg = await getYtConfig();
	const english = cfg.hl.toLowerCase().startsWith("en");
	const next = english ? parseNext(data.initialData) : null;
	const seed: VideoSeed = {};
	if (player?.videoId === videoId) seed.player = player;
	if (next?.videoId === videoId) seed.next = next;
	return seed.player || seed.next ? seed : undefined;
}

/**
 * Details for the video on the current watch/shorts page (null elsewhere),
 * seeded from page data and completed/cached by the background. When the
 * page's own player data marks the video unlisted or private, `isPublic` is
 * false even if a cached anonymous lookup said otherwise.
 */
export async function getCurrentVideoDetails(
	opts: {
		level?: VideoDetailsLevel;
		page?: YtPageData | null;
		force?: boolean;
	} = {},
): Promise<VideoDetails | null> {
	const videoId = opts.page?.videoId ?? videoIdFromUrl(location.href);
	if (!videoId) return null;
	void syncConfigToBackground();
	const seed = await getVideoSeedFromPage(videoId, opts.page).catch(
		() => undefined,
	);
	const details = await yt.getVideoDetails(videoId, {
		level: opts.level,
		seed,
		force: opts.force,
	});
	return withPageRestrictions(details, seed?.player);
}

export { getCurrentPageData, getYtConfig, onNavigate } from "./bridge";
