import { isYouTubeImageUrl } from "@growtube/shared/images";

/**
 * A YouTube image URL in its WHATWG-serialized form (`https://<host>/...`,
 * lowercase host, no default port), or null when `value` is not one
 * (`isYouTubeImageUrl`). Avatars are stored in this form, so the daily
 * cleanup's SQL pre-filter (`^https://<host>/`) matches every valid stored
 * URL exactly and only ever selects rows it will change.
 */
export function canonicalYouTubeImageUrl(value: unknown): string | null {
	if (!isYouTubeImageUrl(value)) return null;
	const href = new URL(value).href;
	return isYouTubeImageUrl(href) ? href : null;
}
