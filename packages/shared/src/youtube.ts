/** YouTube id formats and URL helpers shared by every app. */

export const VIDEO_ID_RE = /^[\w-]{11}$/;
export const CHANNEL_ID_RE = /^UC[\w-]{22}$/;
/**
 * @handle: 3–30 letters (any script), digits, underscores, hyphens, periods
 * or middle dots. Matches what the server's channel resolve query accepts.
 */
export const HANDLE_RE = /^@[\p{L}\p{M}\p{N}_.·-]{3,30}$/u;

export function isVideoId(value: unknown): value is string {
	return typeof value === "string" && VIDEO_ID_RE.test(value);
}

export function isChannelId(value: unknown): value is string {
	return typeof value === "string" && CHANNEL_ID_RE.test(value);
}

/** "youtu.be/…", "www.youtube.com/…": a YouTube link typed without https://. */
const SCHEMELESS_YT_RE =
	/^(?:(?:www|m|music)\.)?(?:youtube\.com|youtube-nocookie\.com|youtu\.be)(?:[/?#]|$)/i;

/** Parses a YouTube URL (absolute, scheme-less, or a path), or null. */
function parseYouTubeUrl(input: string): URL | null {
	const raw = input.trim();
	try {
		return new URL(
			SCHEMELESS_YT_RE.test(raw) ? `https://${raw}` : raw,
			"https://www.youtube.com",
		);
	} catch {
		return null;
	}
}

/**
 * Extracts a video id from any common YouTube URL shape:
 * /watch?v=, /shorts/, youtu.be/, /embed/, /live/ (with or without https://).
 */
export function extractVideoId(input: string): string | null {
	if (isVideoId(input)) return input;
	const url = parseYouTubeUrl(input);
	if (!url) return null;
	const v = url.searchParams.get("v");
	if (isVideoId(v)) return v;
	const host = url.hostname.replace(/^www\.|^m\./, "");
	const parts = url.pathname.split("/").filter(Boolean);
	if (host === "youtu.be" && isVideoId(parts[0])) return parts[0];
	const idx = parts.findIndex((p) =>
		["shorts", "embed", "live", "v"].includes(p),
	);
	const candidate = idx >= 0 ? parts[idx + 1] : undefined;
	return isVideoId(candidate) ? candidate : null;
}

function safeDecode(segment: string): string | null {
	try {
		return decodeURIComponent(segment);
	} catch {
		// Malformed percent-encoding ("%E0%A4%A", "%zz").
		return null;
	}
}

/** Returns the channel id (UC…) or handle (@name) from a channel URL. */
export function extractChannelRef(
	input: string,
): { channelId: string } | { handle: string } | null {
	if (isChannelId(input)) return { channelId: input };
	if (HANDLE_RE.test(input)) return { handle: input };
	const url = parseYouTubeUrl(input);
	if (!url) return null;
	const parts = url.pathname.split("/").filter(Boolean);
	if (parts[0] === "channel" && isChannelId(parts[1])) {
		return { channelId: parts[1] };
	}
	const first = parts[0] ? safeDecode(parts[0]) : null;
	if (first && HANDLE_RE.test(first)) return { handle: first };
	return null;
}

export function isShortsUrl(input: string): boolean {
	try {
		return new URL(input, "https://www.youtube.com").pathname.startsWith(
			"/shorts/",
		);
	} catch {
		return false;
	}
}

export function videoUrl(videoId: string): string {
	return `https://www.youtube.com/watch?v=${videoId}`;
}

export function channelUrl(channelId: string): string {
	return `https://www.youtube.com/channel/${channelId}`;
}

/** Highest-resolution thumbnail that always exists is hqdefault. */
export function thumbnailUrl(
	videoId: string,
	quality:
		| "default"
		| "mqdefault"
		| "hqdefault"
		| "sddefault"
		| "maxresdefault" = "hqdefault",
): string {
	return `https://i.ytimg.com/vi/${videoId}/${quality}.jpg`;
}
