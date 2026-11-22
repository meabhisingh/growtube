/**
 * Which videos may reach the GrowTube server (uploads and lookups).
 * Pure: safe in the background, extension pages and content scripts.
 *
 * - Uploads: only videos YouTube's player data confirms as public and
 *   listed (`isPublicVideo`). Unlisted, private and unknown-listing videos
 *   are never uploaded.
 * - Lookups by id: never for a video known to be unlisted or private (the
 *   background remembers those ids). Feed badges look up cards on public
 *   listings (home, search, subscriptions, channels, watch-page related)
 *   before their listing is known, since those pages list public videos.
 * - Personal pages (`isPersonalPage`: watch history, library, playlists)
 *   can list anything you watched or saved, unlisted and private videos
 *   included: nothing there is looked up or uploaded.
 */
import type { VideoDetails } from "./types";
import type { PlayerInfo } from "./video";

type VisibilityFields = Partial<
	Pick<VideoDetails, "isPublic" | "isUnlisted" | "isPrivate">
>;

type PlayerVisibility = Pick<PlayerInfo, "isUnlisted" | "isPrivate">;

/** True only when YouTube's player data confirms a public, listed video. */
export function isPublicVideo(d: VisibilityFields | null | undefined): boolean {
	// `=== true`: details cached by an older version have no `isPublic`.
	return (
		!!d && d.isPublic === true && d.isUnlisted !== true && d.isPrivate !== true
	);
}

/**
 * The page's own player data marks the video unlisted or private. Page data
 * (e.g. the uploader viewing their private video) wins over a cached
 * anonymous lookup.
 */
export function playerMarksRestricted(
	player: PlayerVisibility | null | undefined,
): boolean {
	return !!player && (player.isUnlisted || player.isPrivate);
}

/** `details` with the page's restrictions applied (never loosens them). */
export function withPageRestrictions<T extends VideoDetails>(
	details: T,
	player: PlayerVisibility | null | undefined,
): T {
	if (!player || !playerMarksRestricted(player)) return details;
	return {
		...details,
		isPublic: false,
		isUnlisted: details.isUnlisted || player.isUnlisted,
		isPrivate: details.isPrivate || player.isPrivate,
	};
}

/**
 * YouTube pages built from the viewer's own activity: watch history, the
 * You / library page (history, Watch later, liked and saved playlist
 * shelves), downloads, clips and playlists. They can show unlisted and
 * private videos, and their contents are the user's history: feed badges
 * there never ask the GrowTube server and never crowdsource.
 */
export function isPersonalPage(href: string): boolean {
	let url: URL;
	try {
		url = new URL(href);
	} catch {
		return false;
	}
	const path = url.pathname.replace(/\/+$/, "") || "/";
	return (
		/^\/feed\/(history|you|library|downloads|clips|playlists)(\/|$)/.test(
			path,
		) || path === "/playlist"
	);
}
