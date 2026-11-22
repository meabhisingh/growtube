import {
	CHANNEL_ID_RE,
	extractChannelRef,
	extractVideoId,
	HANDLE_RE,
	VIDEO_ID_RE,
} from "@growtube/shared";

export type LookupTarget =
	| { kind: "video"; videoId: string }
	| { kind: "channel"; channelId: string }
	| { kind: "handle"; handle: string }
	| { kind: "search"; query: string }
	| { kind: "invalid"; reason: string };

const YOUTUBE_HOST_RE =
	/(^|\.)youtube\.com$|^youtu\.be$|(^|\.)youtube-nocookie\.com$/;
const URLISH_RE =
	/^(https?:\/\/|www\.|m\.|music\.|youtu\.be\/|youtube\.com\/)/i;

/**
 * A bare 11-character word like "programming" is a valid video id shape but
 * almost certainly a search. Real ids nearly always contain an uppercase
 * letter, a digit, "-" or "_".
 */
function looksLikeVideoId(input: string): boolean {
	return VIDEO_ID_RE.test(input) && /[A-Z0-9_-]/.test(input);
}

/** Classifies whatever the user pasted into the lookup box. */
export function resolveLookup(raw: string): LookupTarget {
	const input = raw.trim();
	if (!input) {
		return {
			kind: "invalid",
			reason: "Paste a YouTube link, video ID or channel ID.",
		};
	}

	if (URLISH_RE.test(input)) {
		const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
		let host: string;
		try {
			host = new URL(normalized).hostname.toLowerCase();
		} catch {
			return { kind: "invalid", reason: "That link doesn't look valid." };
		}
		if (!YOUTUBE_HOST_RE.test(host)) {
			return { kind: "invalid", reason: "Only YouTube links are supported." };
		}
		const videoId = extractVideoId(normalized);
		if (videoId) return { kind: "video", videoId };
		const channel = extractChannelRef(normalized);
		if (channel) {
			return "channelId" in channel
				? { kind: "channel", channelId: channel.channelId }
				: { kind: "handle", handle: channel.handle };
		}
		return {
			kind: "invalid",
			reason:
				"Couldn't find a video or channel in that link. Legacy /c/ and /user/ links aren't supported; use the channel's /channel/UC… link.",
		};
	}

	// Plain regex tests: the shared `is*` guards would narrow `input` to never.
	if (CHANNEL_ID_RE.test(input)) return { kind: "channel", channelId: input };
	if (HANDLE_RE.test(input)) return { kind: "handle", handle: input };
	if (looksLikeVideoId(input)) return { kind: "video", videoId: input };
	return { kind: "search", query: input.slice(0, 100) };
}
