import { videoUrl } from "@growtube/shared";
import { z } from "zod";

/**
 * The stats API only stores numbers, so the video page asks YouTube's public
 * oEmbed endpoint (CORS-enabled, no key) for the title and channel name.
 * Private or embed-disabled videos simply return null.
 */
const oembedResponse = z.object({
	title: z.string(),
	author_name: z.string().optional(),
	author_url: z.url().optional(),
});

export interface VideoMeta {
	title: string;
	channelName: string | null;
	channelUrl: string | null;
}

export async function getVideoMeta(
	videoId: string,
	signal?: AbortSignal,
): Promise<VideoMeta | null> {
	const url = new URL("https://www.youtube.com/oembed");
	url.searchParams.set("url", videoUrl(videoId));
	url.searchParams.set("format", "json");
	const res = await fetch(url, {
		signal,
		credentials: "omit",
		referrerPolicy: "no-referrer",
	});
	if (!res.ok) return null;
	const parsed = oembedResponse.safeParse(
		await res.json().catch(() => undefined),
	);
	if (!parsed.success) return null;
	return {
		title: parsed.data.title,
		channelName: parsed.data.author_name ?? null,
		channelUrl: parsed.data.author_url ?? null,
	};
}
