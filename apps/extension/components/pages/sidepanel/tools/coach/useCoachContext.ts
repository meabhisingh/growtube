/**
 * Resolves the AI Coach's context from the selected source:
 *   - "tab":    the video / channel open in the active YouTube tab
 *   - "mine":   the user's own channel (settings.myChannel)
 *   - "pinned": a fixed context (from the watch panel, a saved conversation,
 *               or a video/channel id passed in an intent)
 *   - "none":   no context
 * Built contexts are cached for a few minutes (the data itself is cached in
 * the background, this just avoids recomputing on every tab switch).
 */
import { useEffect, useMemo, useState } from "react";

import type { CoachContext } from "@/lib/ai/types";
import { useStorageItem } from "@/lib/hooks";
import { myChannel } from "@/lib/settings";
import type { ChannelRef } from "@/lib/youtube/types";

import {
	type BuiltContext,
	buildChannelContext,
	buildVideoContext,
} from "../../../data";
import { usePanel } from "../../nav";

export type ContextMode = "tab" | "mine" | "pinned" | "none";

export type PinnedSource =
	| { kind: "context"; context: CoachContext; label: string }
	| { kind: "video"; videoId: string }
	| { kind: "channel"; channelId: string };

type Target =
	| { kind: "video"; videoId: string }
	| { kind: "channel"; ref: ChannelRef; page: CoachContext["page"] }
	| { kind: "static"; context: CoachContext | null; label: string | null }
	| { kind: "empty"; reason: string };

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; promise: Promise<BuiltContext> }>();

function buildCached(key: string, build: () => Promise<BuiltContext>) {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = build();
	cache.set(key, { at: Date.now(), promise });
	promise.catch(() => cache.delete(key));
	return promise;
}

function targetKey(t: Target): string {
	switch (t.kind) {
		case "video":
			return `v:${t.videoId}`;
		case "channel":
			return `c:${"channelId" in t.ref ? t.ref.channelId : t.ref.handle}:${t.page}`;
		case "static":
			return `s:${t.label ?? ""}:${JSON.stringify(t.context).length}`;
		case "empty":
			return `e:${t.reason}`;
	}
}

export function labelOfContext(ctx: CoachContext | null | undefined): string {
	if (!ctx) return "No context";
	return (
		ctx.video?.title ??
		ctx.channel?.title ??
		ctx.myChannel?.title ??
		"Custom context"
	);
}

export type CoachContextState = {
	mode: ContextMode;
	setMode: (mode: ContextMode) => void;
	pin: (source: PinnedSource) => void;
	pinned: PinnedSource | null;
	/** Context to send (null = none) */
	context: CoachContext | null;
	/** What's in focus, for the context chip */
	label: string | null;
	kind: "video" | "channel" | "custom" | null;
	/** Video in focus (for transcript-based presets) */
	videoId: string | null;
	loading: boolean;
	error: unknown;
	/** Why there's no context in this mode ("Open a YouTube video…") */
	emptyReason: string | null;
};

export function useCoachContext(): CoachContextState {
	const { activeTab } = usePanel();
	const [mine] = useStorageItem(myChannel);
	const [mode, setMode] = useState<ContextMode>("tab");
	const [pinned, setPinned] = useState<PinnedSource | null>(null);

	const tabVideo = activeTab.videoId;
	const tabChannelKey = activeTab.channelRef
		? "channelId" in activeTab.channelRef
			? activeTab.channelRef.channelId
			: activeTab.channelRef.handle
		: null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on primitive ids
	const target = useMemo<Target>(() => {
		switch (mode) {
			case "tab":
				if (tabVideo) return { kind: "video", videoId: tabVideo };
				if (activeTab.channelRef)
					return {
						kind: "channel",
						ref: activeTab.channelRef,
						page: "channel",
					};
				return {
					kind: "empty",
					reason: activeTab.isYouTube
						? "Open a video or channel on YouTube to chat about it."
						: "Open YouTube in this tab to chat about a video or channel.",
				};
			case "mine":
				return mine
					? {
							kind: "channel",
							ref: { channelId: mine.channelId },
							page: "sidepanel",
						}
					: {
							kind: "empty",
							reason: "Set your channel in Competitors or Settings first.",
						};
			case "pinned":
				if (!pinned) return { kind: "static", context: null, label: null };
				if (pinned.kind === "context")
					return {
						kind: "static",
						context: pinned.context,
						label: pinned.label,
					};
				if (pinned.kind === "video")
					return { kind: "video", videoId: pinned.videoId };
				return {
					kind: "channel",
					ref: { channelId: pinned.channelId },
					page: "channel",
				};
			case "none":
				return { kind: "static", context: null, label: null };
		}
	}, [mode, tabVideo, tabChannelKey, mine?.channelId, pinned]);

	const key = targetKey(target);
	const [state, setState] = useState<{
		key: string;
		built: BuiltContext | null;
		loading: boolean;
		error: unknown;
	}>({ key: "", built: null, loading: false, error: null });

	// biome-ignore lint/correctness/useExhaustiveDependencies: `key` identifies `target`
	useEffect(() => {
		if (target.kind !== "video" && target.kind !== "channel") {
			setState({ key, built: null, loading: false, error: null });
			return;
		}
		let alive = true;
		setState((s) => ({
			key,
			built: s.key === key ? s.built : null,
			loading: true,
			error: null,
		}));
		const promise =
			target.kind === "video"
				? buildCached(key, () => buildVideoContext(target.videoId))
				: buildCached(key, () => buildChannelContext(target.ref, target.page));
		promise.then(
			(built) => alive && setState({ key, built, loading: false, error: null }),
			(error) => alive && setState({ key, built: null, loading: false, error }),
		);
		return () => {
			alive = false;
		};
	}, [key]);

	const mineCtx = mine ? { title: mine.title, handle: mine.handle } : undefined;

	let context: CoachContext | null = null;
	let label: string | null = null;
	let kind: CoachContextState["kind"] = null;
	let videoId: string | null = null;
	if (target.kind === "static") {
		context = target.context
			? { ...target.context, myChannel: target.context.myChannel ?? mineCtx }
			: null;
		label = target.label;
		kind = target.context ? (target.context.video ? "video" : "custom") : null;
		videoId = target.context?.video?.videoId ?? null;
	} else if (
		(target.kind === "video" || target.kind === "channel") &&
		state.key === key &&
		state.built
	) {
		// In "mine" mode this tells the coach the channel in focus is the user's.
		context = { ...state.built.context, myChannel: mineCtx };
		label = state.built.label;
		kind = target.kind;
		videoId = target.kind === "video" ? target.videoId : null;
	}

	return {
		mode,
		setMode,
		pin: (source) => {
			setPinned(source);
			setMode("pinned");
		},
		pinned,
		context,
		label,
		kind,
		videoId,
		loading:
			(target.kind === "video" || target.kind === "channel") &&
			(state.key !== key || state.loading),
		error: state.key === key ? state.error : null,
		emptyReason: target.kind === "empty" ? target.reason : null,
	};
}
