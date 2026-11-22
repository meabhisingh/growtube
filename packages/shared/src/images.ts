/**
 * Image URLs we accept from crowdsourced reports and render in the web app.
 * Only YouTube's own image hosts, over https: anything else could make a
 * visitor's browser contact a host chosen by whoever sent the report.
 */
export const YOUTUBE_IMAGE_HOSTS: readonly string[] = [
	"yt3.ggpht.com",
	"yt3.googleusercontent.com",
	"yt4.ggpht.com",
	"i.ytimg.com",
];

export function isYouTubeImageUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2000) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			url.username === "" &&
			url.password === "" &&
			url.port === "" &&
			YOUTUBE_IMAGE_HOSTS.includes(url.hostname.toLowerCase())
		);
	} catch {
		return false;
	}
}

/** The URL when it is a YouTube image URL, otherwise null. */
export function youTubeImageOrNull(value: unknown): string | null {
	return isYouTubeImageUrl(value) ? value : null;
}
