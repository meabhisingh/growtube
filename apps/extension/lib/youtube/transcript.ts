/**
 * Video transcripts.
 *
 * 1. Caption tracks from the ANDROID `player` client — their timedtext URLs
 *    work without a PoToken (WEB-client URLs now return an empty body).
 * 2. `fmt=json3` timedtext, parsed into {start, dur, text} segments.
 * 3. Fallback: the `get_transcript` endpoint (params from the watch-next
 *    transcript panel). YouTube currently gates it behind attestation for
 *    anonymous clients, so it rarely helps, but it's cheap to try.
 */
import { isVideoId } from "@open-vidiq/shared/youtube";

import { cached, TTL } from "../cache";
import { innertube, YouTubeError, ytFetch } from "./innertube";
import type { CaptionTrack, Transcript, TranscriptSegment } from "./types";
import { fetchNext, parseCaptionTracks } from "./video";
import { type AnyObj, findAll, textOf } from "./walk";

export function parseJson3(json: unknown): TranscriptSegment[] {
	const events = (json as { events?: AnyObj[] } | null)?.events;
	if (!Array.isArray(events)) return [];
	const out: TranscriptSegment[] = [];
	for (const e of events) {
		if (!Array.isArray(e?.segs)) continue;
		const text = e.segs
			.map((s: AnyObj) => (typeof s?.utf8 === "string" ? s.utf8 : ""))
			.join("")
			.replace(/\s+/g, " ")
			.trim();
		if (!text) continue;
		out.push({
			start: (Number(e.tStartMs) || 0) / 1000,
			dur: (Number(e.dDurationMs) || 0) / 1000,
			text,
		});
	}
	return out;
}

export function parseGetTranscript(resp: unknown): TranscriptSegment[] {
	return findAll<AnyObj>(resp, "transcriptSegmentRenderer")
		.map((s) => {
			const startMs = Number(s?.startMs);
			const endMs = Number(s?.endMs);
			return {
				start: (Number.isFinite(startMs) ? startMs : 0) / 1000,
				dur:
					Number.isFinite(endMs) && Number.isFinite(startMs)
						? (endMs - startMs) / 1000
						: 0,
				text: (textOf(s?.snippet) ?? "").replace(/\s+/g, " ").trim(),
			};
		})
		.filter((s) => s.text);
}

const langMatches = (track: CaptionTrack, lang: string) =>
	track.languageCode.toLowerCase() === lang.toLowerCase() ||
	track.languageCode.toLowerCase().split("-")[0] ===
		lang.toLowerCase().split("-")[0];

/**
 * Picks the best track: manual in the requested language (or, without one,
 * the spoken language = the ASR track's language), then auto-generated in
 * that language, then any manual, then any ASR. Returns `tlang` when only a
 * translation can satisfy an explicit request.
 */
export function chooseCaptionTrack(
	tracks: CaptionTrack[],
	lang?: string,
): { track: CaptionTrack; tlang: string | null } | null {
	if (!tracks.length) return null;
	const spoken = tracks.find((t) => t.kind === "asr")?.languageCode;
	const wanted = lang ?? spoken ?? "en";
	const manual = tracks.filter((t) => t.kind === "manual");
	const asr = tracks.filter((t) => t.kind === "asr");
	const pick =
		manual.find((t) => t.languageCode.toLowerCase() === wanted.toLowerCase()) ??
		manual.find((t) => langMatches(t, wanted)) ??
		asr.find((t) => langMatches(t, wanted));
	if (pick) return { track: pick, tlang: null };
	if (lang) {
		const translatable =
			manual.find((t) => t.isTranslatable) ?? asr.find((t) => t.isTranslatable);
		if (translatable) return { track: translatable, tlang: lang };
	}
	const fallback = manual[0] ?? asr[0];
	return fallback ? { track: fallback, tlang: null } : null;
}

/** Caption tracks that are fetchable without a PoToken. */
export async function getCaptionTracks(
	videoId: string,
	signal?: AbortSignal,
): Promise<CaptionTrack[]> {
	const resp = await innertube(
		"player",
		{ videoId, contentCheckOk: true, racyCheckOk: true },
		{ client: "ANDROID", signal },
	);
	return parseCaptionTracks(resp);
}

async function fetchTimedText(
	track: CaptionTrack,
	tlang: string | null,
	signal?: AbortSignal,
): Promise<TranscriptSegment[]> {
	const url = new URL(track.baseUrl);
	url.searchParams.set("fmt", "json3");
	if (tlang) url.searchParams.set("tlang", tlang);
	const res = await ytFetch(url.toString(), { signal, retries: 1 });
	const body = await res.text();
	if (!body.trim()) return [];
	try {
		return parseJson3(JSON.parse(body));
	} catch {
		return [];
	}
}

export type GetTranscriptOptions = {
	/** BCP-47-ish language code ("en", "pt-BR"); default: the spoken language */
	lang?: string;
	/** Tracks already known (e.g. from the page's player response), tried after the Android ones */
	extraTracks?: CaptionTrack[];
	force?: boolean;
	signal?: AbortSignal;
};

const isAbort = (error: unknown) =>
	(error as { name?: unknown } | null)?.name === "AbortError";

/**
 * Failures that say nothing about whether the video has captions (offline,
 * rate limited, YouTube 5xx, a worker restart…). A transcript lookup that hit
 * one of these must not be remembered as "no captions".
 */
export function isTransientTranscriptError(error: unknown): boolean {
	if (isAbort(error)) return true;
	if (error instanceof YouTubeError) {
		if (error.code === "NETWORK" || error.code === "RATE_LIMITED") return true;
		if (error.code === "HTTP") {
			const s = error.status ?? 0;
			return s === 0 || s === 408 || s === 429 || s >= 500;
		}
		return false;
	}
	// Unknown failure (e.g. TypeError from fetch): don't trust it either.
	return true;
}

async function loadTranscript(
	videoId: string,
	opts: GetTranscriptOptions,
): Promise<Transcript | null> {
	let transient: unknown = null;
	const note = (error: unknown) => {
		if (isAbort(error)) throw error;
		if (transient == null && isTransientTranscriptError(error))
			transient = error;
	};

	let tracks: CaptionTrack[] = [];
	try {
		tracks = await getCaptionTracks(videoId, opts.signal);
	} catch (error) {
		note(error);
	}
	for (const source of [tracks, opts.extraTracks ?? []]) {
		const choice = chooseCaptionTrack(source, opts.lang);
		if (!choice) continue;
		let segments: TranscriptSegment[] = [];
		try {
			segments = await fetchTimedText(choice.track, choice.tlang, opts.signal);
		} catch (error) {
			note(error);
		}
		if (segments.length) {
			return {
				videoId,
				languageCode: choice.tlang ?? choice.track.languageCode,
				kind: choice.track.kind,
				segments,
			};
		}
	}
	// Last resort: get_transcript. YouTube usually refuses it for anonymous
	// clients, so its own errors are expected and not treated as transient.
	const next = await fetchNext(videoId, opts.signal).catch((error: unknown) => {
		note(error);
		return null;
	});
	if (next?.transcriptParams) {
		const resp = await innertube(
			"get_transcript",
			{ params: next.transcriptParams },
			{ retries: 0, signal: opts.signal },
		).catch((error: unknown) => {
			if (isAbort(error)) throw error;
			return null;
		});
		const segments = parseGetTranscript(resp);
		if (segments.length) {
			return {
				videoId,
				languageCode: opts.lang ?? "und",
				kind: "manual" as const,
				segments,
			};
		}
	}
	// Couldn't tell: fail (uncached) so the next call tries again.
	if (transient != null) throw transient;
	return null;
}

/**
 * Full transcript, or null when the video has no captions. Cached 1 day.
 * Throws (and caches nothing) when YouTube couldn't be asked properly
 * (network, rate limit, 5xx), so a blip is never remembered as "no captions".
 */
export async function getTranscript(
	videoId: string,
	opts: GetTranscriptOptions = {},
): Promise<Transcript | null> {
	if (!isVideoId(videoId))
		throw new YouTubeError("NOT_FOUND", `Invalid video id: ${videoId}`);
	return cached(
		// v2: v1 entries may hold nulls cached after transient failures.
		`transcript:v2:${videoId}:${opts.lang ?? "default"}`,
		TTL.transcript,
		() => loadTranscript(videoId, opts),
		{ force: opts.force },
	);
}

/** "0:00 text\n0:05 text…" — compact form for AI prompts. */
export function transcriptToText(
	segments: TranscriptSegment[],
	opts: {
		timestamps?: boolean;
		maxChars?: number;
		fromSec?: number;
		toSec?: number;
	} = {},
): string {
	const fmt = (s: number) => {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		const h = Math.floor(m / 60);
		return h
			? `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
			: `${m}:${String(sec).padStart(2, "0")}`;
	};
	const lines: string[] = [];
	let total = 0;
	for (const seg of segments) {
		if (opts.fromSec != null && seg.start + seg.dur < opts.fromSec) continue;
		if (opts.toSec != null && seg.start > opts.toSec) break;
		const line =
			opts.timestamps === false ? seg.text : `${fmt(seg.start)} ${seg.text}`;
		total += line.length + 1;
		if (opts.maxChars && total > opts.maxChars) break;
		lines.push(line);
	}
	return lines.join(opts.timestamps === false ? " " : "\n");
}
