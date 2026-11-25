/**
 * Search rank tracking. BACKGROUND ONLY.
 *
 * `rankTracks` (chrome.storage.local) holds up to MAX_RANK_TRACKS
 * (video, search term) pairs. Each check looks up the video's position in the
 * anonymous YouTube search results for the term (top RANK_DEPTH, Shorts
 * included, see findVideoRank) and appends `{ t, rank }` to its history
 * (RANK_HISTORY_DAYS kept; a check within an hour of the previous one
 * replaces it).
 *
 * The alarm `ovq:rank-tracker` fires hourly and re-checks the pairs whose
 * last attempt is older than ~a day, one at a time with a pause between, so
 * each pair is checked about once a day even if the browser was closed at
 * the scheduled time. Nothing while signed out; nothing is crowdsourced (the
 * lookups call lib/youtube directly).
 */
import { hasSession } from "./auth-session";
import { keepAliveWhile } from "./keepalive";
import { sleep } from "./limiter";
import {
	RANK_DEPTH,
	RANK_HISTORY_DAYS,
	type RankPoint,
	type RankTrack,
	rankTracks,
} from "./settings";
import { findVideoRank } from "./youtube";

export const RANK_TRACKER_ALARM = "ovq:rank-tracker";
export const RANK_TRACKER_MINUTES = 60;

const DUE_AFTER_MS = 22 * 3_600_000;
const RETRY_AFTER_ERROR_MS = 3 * 3_600_000;
const MERGE_WITHIN_MS = 3_600_000;
const STAGGER_MS = 2_500;
const MAX_POINTS = 600;

export type RankCheckResult = {
	checked: number;
	failed: number;
	skipped?: "signed-out";
};

/** Adds a point (replacing one from the last hour) and drops old ones. */
export function appendRankPoint(
	history: readonly RankPoint[],
	point: RankPoint,
	now = Date.now(),
): RankPoint[] {
	const cutoff = now - RANK_HISTORY_DAYS * 86_400_000;
	const t = Date.parse(point.t);
	const kept = history.filter((p) => {
		const pt = Date.parse(p.t);
		return Number.isFinite(pt) && pt >= cutoff && t - pt >= MERGE_WITHIN_MS;
	});
	return [...kept, point].slice(-MAX_POINTS);
}

function isDue(track: RankTrack, now: number): boolean {
	const attempt = track.lastAttemptAt ?? track.lastCheckedAt;
	if (attempt == null) return true;
	const wait = track.lastError ? RETRY_AFTER_ERROR_MS : DUE_AFTER_MS;
	return now - attempt >= wait;
}

async function patchTrack(
	id: string,
	patch: (t: RankTrack) => RankTrack,
): Promise<void> {
	const list = await rankTracks.getValue();
	if (!list.some((t) => t.id === id)) return; // removed meanwhile
	await rankTracks.setValue(list.map((t) => (t.id === id ? patch(t) : t)));
}

let chain: Promise<unknown> = Promise.resolve();
let scheduledRunning = false;

/**
 * Checks tracked pairs: `ids` (manual "Check now" for some), `"all"` (manual
 * "Check all") or `"due"` (the daily alarm). Runs are serialized.
 */
export function checkRankTracks(
	target: string[] | "all" | "due",
): Promise<RankCheckResult> {
	if (target === "due") {
		if (scheduledRunning) return Promise.resolve({ checked: 0, failed: 0 });
		scheduledRunning = true;
	}
	const next = chain
		.catch(() => {})
		.then(() => keepAliveWhile(run(target)))
		.finally(() => {
			if (target === "due") scheduledRunning = false;
		});
	chain = next;
	return next;
}

async function run(target: string[] | "all" | "due"): Promise<RankCheckResult> {
	if (!(await hasSession()))
		return { checked: 0, failed: 0, skipped: "signed-out" };
	const now = Date.now();
	const list = await rankTracks.getValue();
	const todo =
		target === "all"
			? list
			: target === "due"
				? list.filter((t) => isDue(t, now))
				: list.filter((t) => target.includes(t.id));
	let checked = 0;
	let failed = 0;
	for (const [i, track] of todo.entries()) {
		if (i > 0) await sleep(STAGGER_MS);
		if (!(await hasSession())) break;
		try {
			const rank = await findVideoRank(track.query, track.videoId, RANK_DEPTH);
			const at = Date.now();
			await patchTrack(track.id, (t) => ({
				...t,
				history: appendRankPoint(
					t.history,
					{ t: new Date(at).toISOString(), rank },
					at,
				),
				lastCheckedAt: at,
				lastAttemptAt: at,
				lastError: null,
			}));
			checked++;
		} catch (error) {
			failed++;
			const message = error instanceof Error ? error.message : String(error);
			await patchTrack(track.id, (t) => ({
				...t,
				lastAttemptAt: Date.now(),
				lastError: message,
			}));
		}
	}
	return { checked, failed };
}
