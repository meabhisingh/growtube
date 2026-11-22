/**
 * YouTube oEmbed lookup: confirms a video exists and returns its real title
 * and channel name. Needs no API key or quota, so the cron can verify
 * crowdsourced videos even without YOUTUBE_API_KEY.
 */
import { videoUrl } from "@open-vidiq/shared";
import { z } from "zod";

export const YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed";
const OEMBED_TIMEOUT_MS = 5_000;

const oembedResponse = z.object({
	title: z.string().max(1_000),
	author_name: z.string().max(500).optional(),
});

export type OEmbedResult =
	| { status: "found"; title: string; channelTitle: string | null }
	/** 400/404: the id doesn't exist (or was deleted). */
	| { status: "missing" }
	/** Private, embedding disabled, rate limited, network…: try again later. */
	| { status: "unknown"; reason: string };

export type OEmbedOptions = {
	fetch?: typeof fetch;
	baseUrl?: string;
};

export async function lookupOEmbed(
	videoId: string,
	opts: OEmbedOptions = {},
): Promise<OEmbedResult> {
	const url = new URL(opts.baseUrl ?? YOUTUBE_OEMBED_URL);
	url.searchParams.set("url", videoUrl(videoId));
	url.searchParams.set("format", "json");
	let res: Response;
	try {
		res = await (opts.fetch ?? fetch)(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS),
		});
	} catch (error) {
		return { status: "unknown", reason: String(error) };
	}
	if (res.status === 400 || res.status === 404) {
		await res.body?.cancel().catch(() => {});
		return { status: "missing" };
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		return { status: "unknown", reason: `HTTP ${res.status}` };
	}
	const parsed = oembedResponse.safeParse(await res.json().catch(() => null));
	if (!parsed.success) return { status: "unknown", reason: "bad response" };
	return {
		status: "found",
		title: parsed.data.title,
		channelTitle: parsed.data.author_name ?? null,
	};
}
