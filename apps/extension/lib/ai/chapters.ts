/**
 * YouTube chapter rules and transcript budgeting for the chapter generator.
 * Pure (no network, no extension APIs, no zod): import from anywhere.
 *
 * YouTube only shows chapters when the description lists at least 3
 * timestamps, the first is 0:00, and every chapter is at least 10 seconds
 * long. Model output is never trusted: `validateChapters` fixes what it can
 * and rejects (empty list + issues) what it can't.
 */

export type Chapter = { time: string; title: string };

export const CHAPTER_MIN_COUNT = 3;
export const CHAPTER_MIN_GAP_SEC = 10;
const TITLE_MAX = 100;

/** 83 -> "1:23", 3723 -> "1:02:03" */
export function formatTimestamp(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Strict "m:ss" / "mm:ss" / "h:mm:ss" (also a plain number of seconds) ->
 * seconds, or null when it isn't a valid timestamp.
 */
export function parseTimestamp(value: unknown): number | null {
	if (typeof value === "number")
		return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
	if (typeof value !== "string") return null;
	const v = value.trim().replace(/^\[|\]$/g, "");
	if (/^\d+(\.\d+)?$/.test(v)) return Math.floor(Number(v));
	const m = v.match(/^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/);
	if (!m) return null;
	const h = m[1] ? Number(m[1]) : 0;
	const min = Number(m[2]);
	const sec = Number(m[3]);
	if (sec > 59) return null;
	if (m[1] && min > 59) return null;
	return h * 3600 + min * 60 + sec;
}

function cleanTitle(title: unknown): string {
	if (typeof title !== "string") return "";
	return (
		title
			// The model sometimes repeats the timestamp or adds list markers.
			.replace(
				/^\s*(?:[-–—•*]\s*)?(?:\d{1,2}:)?\d{1,3}:\d{2}\s*[-–—:|]?\s*/,
				"",
			)
			.replace(/^\s*[-–—•*]\s*/, "")
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, TITLE_MAX)
	);
}

export type ChapterValidation = {
	/** Valid chapters (empty when they can't be made valid) */
	chapters: Chapter[];
	/** What was fixed or why they were rejected (for the UI) */
	issues: string[];
	valid: boolean;
};

/**
 * Normalizes chapters to YouTube's rules: valid timestamps inside the video,
 * sorted, first at 0:00, each at least 10 s long (last one too, when the
 * duration is known), non-empty titles. Fewer than 3 left = rejected.
 */
export function validateChapters(
	raw: readonly { time?: unknown; title?: unknown }[],
	durationSec?: number | null,
): ChapterValidation {
	const issues: string[] = [];
	const duration =
		durationSec != null && Number.isFinite(durationSec) && durationSec > 0
			? Math.floor(durationSec)
			: null;

	let invalid = 0;
	let outside = 0;
	const parsed: { sec: number; title: string }[] = [];
	for (const c of raw) {
		const sec = parseTimestamp(c.time);
		const title = cleanTitle(c.title);
		if (sec == null || !title) {
			invalid++;
			continue;
		}
		if (duration != null && sec >= duration) {
			outside++;
			continue;
		}
		parsed.push({ sec, title });
	}
	if (invalid)
		issues.push(`Dropped ${invalid} line(s) with a bad timestamp or no title.`);
	if (outside)
		issues.push(`Dropped ${outside} chapter(s) past the end of the video.`);

	parsed.sort((a, b) => a.sec - b.sec);

	// First chapter must start at 0:00.
	const first = parsed[0];
	if (first && first.sec !== 0) {
		if (first.sec < CHAPTER_MIN_GAP_SEC) {
			first.sec = 0;
			issues.push("Moved the first chapter to 0:00.");
		} else {
			parsed.unshift({ sec: 0, title: "Intro" });
			issues.push('Added an "Intro" chapter at 0:00.');
		}
	}

	// Each chapter at least 10 s after the previous one.
	const kept: { sec: number; title: string }[] = [];
	let tooClose = 0;
	for (const c of parsed) {
		const prev = kept[kept.length - 1];
		if (prev && c.sec - prev.sec < CHAPTER_MIN_GAP_SEC) {
			tooClose++;
			continue;
		}
		kept.push(c);
	}
	// The last chapter must also run for at least 10 s.
	while (
		duration != null &&
		kept.length > 1 &&
		duration - (kept[kept.length - 1] as { sec: number }).sec <
			CHAPTER_MIN_GAP_SEC
	) {
		kept.pop();
		tooClose++;
	}
	if (tooClose)
		issues.push(
			`Dropped ${tooClose} chapter(s) shorter than ${CHAPTER_MIN_GAP_SEC} seconds.`,
		);

	if (kept.length < CHAPTER_MIN_COUNT) {
		issues.push(
			`YouTube needs at least ${CHAPTER_MIN_COUNT} chapters (first at 0:00, each ${CHAPTER_MIN_GAP_SEC}+ seconds); only ${kept.length} valid.`,
		);
		return { chapters: [], issues, valid: false };
	}
	return {
		chapters: kept.map((c) => ({
			time: formatTimestamp(c.sec),
			title: c.title,
		})),
		issues,
		valid: true,
	};
}

/** Chapters as description lines ("0:00 Intro"). */
export function chaptersToText(chapters: readonly Chapter[]): string {
	return chapters.map((c) => `${c.time} ${c.title}`).join("\n");
}

/** Parses "0:00 Intro" lines back into chapters (for edited text). */
export function parseChaptersText(text: string): Chapter[] {
	const out: Chapter[] = [];
	for (const line of text.split(/\r?\n/)) {
		const m = line
			.trim()
			.match(
				/^(?:[-–—•*]\s*)?\[?((?:\d{1,2}:)?\d{1,3}:\d{2})\]?\s*[-–—:|]?\s*(.*)$/,
			);
		if (m) out.push({ time: m[1] as string, title: m[2] ?? "" });
	}
	return out;
}

// ---------------------------------------------------------------------------
// Transcript budget
// ---------------------------------------------------------------------------

type Segment = { start: number; dur: number; text: string };

function mergeWindows(segments: readonly Segment[], windowSec: number) {
	const lines: { start: number; text: string }[] = [];
	for (const seg of segments) {
		const text = seg.text.replace(/\s+/g, " ").trim();
		if (!text) continue;
		const last = lines[lines.length - 1];
		if (last && windowSec > 0 && seg.start - last.start < windowSec)
			last.text += ` ${text}`;
		else lines.push({ start: seg.start, text });
	}
	return lines;
}

function render(lines: { start: number; text: string }[], perLine?: number) {
	return lines
		.map((l) => {
			const text =
				perLine != null && l.text.length > perLine
					? `${l.text.slice(0, Math.max(0, perLine - 1)).trimEnd()}…`
					: l.text;
			return `${formatTimestamp(l.start)} ${text}`;
		})
		.join("\n");
}

/**
 * "m:ss text" lines covering the WHOLE video within `maxChars`: short caption
 * lines are merged into wider time windows first (no text lost, coarser
 * timestamps), and only when that isn't enough is each window's text cut
 * (its first words kept), so the end of a long video is never dropped.
 */
export function compactTranscript(
	segments: readonly Segment[],
	maxChars = 28_000,
): { text: string; truncated: boolean; windowSec: number } {
	let lines = mergeWindows(segments, 0);
	for (const windowSec of [0, 10, 20, 30]) {
		lines = mergeWindows(segments, windowSec);
		const text = render(lines);
		if (text.length <= maxChars) return { text, truncated: false, windowSec };
	}
	for (const windowSec of [30, 60, 120, 240, 480]) {
		lines = mergeWindows(segments, windowSec);
		// Each line: "h:mm:ss " (+8) + text + "\n"
		const perLine = Math.floor(maxChars / Math.max(1, lines.length)) - 10;
		if (perLine >= 80 || windowSec === 480) {
			const text = render(lines, Math.max(20, perLine)).slice(0, maxChars);
			return { text, truncated: true, windowSec };
		}
	}
	return {
		text: render(lines).slice(0, maxChars),
		truncated: true,
		windowSec: 480,
	};
}
