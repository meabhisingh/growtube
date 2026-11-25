/**
 * Top-level comments of a video, from InnerTube `next` continuations.
 *
 * 1. `next { videoId }` carries the comments continuation token
 *    (`NextInfo.commentsToken`, see video.ts).
 * 2. `next { continuation }` answers with the comments header (exact count,
 *    sort menu) and the first page of threads; each page ends with a
 *    `continuationItemRenderer` holding the next page's token.
 *
 * Threads come in two shapes:
 * - legacy: `commentThreadRenderer.comment.commentRenderer` (all data inline);
 * - current: `commentThreadRenderer.commentViewModel.commentViewModel` holding
 *   only keys; the data lives in `frameworkUpdates.entityBatchUpdate.mutations`
 *   as `commentEntityPayload` (+ `engagementToolbarStateEntityPayload` for
 *   the creator heart).
 *
 * The parsers are pure and defensive: unknown shapes yield fewer comments,
 * never a throw. Comment text stays in the background's memory cache (not
 * persisted) and is never sent to the GrowTube server.
 */
import { isVideoId } from "@growtube/shared/youtube";

import { cached } from "../cache";
import { innertube, YouTubeError } from "./innertube";
import { parseCount } from "./parse";
import type { CommentSort, VideoComment, VideoComments } from "./types";
import { parseNext } from "./video";
import { type AnyObj, findAll, findFirst, get, isObj, textOf } from "./walk";

/** Hard cap per request (a few continuation pages of ~20 threads each). */
export const MAX_COMMENTS = 200;
const DEFAULT_COMMENTS = 120;
const COMMENTS_TTL = 15 * 60_000;
/** Safety net against continuation loops / empty pages. */
const MAX_PAGES = 14;

export type CommentsPage = {
	comments: VideoComment[];
	/** Exact (or rounded) total from the header, first page only */
	total: { value: number; exact: boolean } | null;
	/** Token of the next page, null at the end */
	nextToken: string | null;
	/** Reload tokens of the sort menu (header page only) */
	sortTokens: Partial<Record<CommentSort, string>>;
};

const str = (v: unknown): string | null =>
	typeof v === "string" && v.trim() ? v : null;

function countOf(...candidates: unknown[]): number {
	for (const c of candidates) {
		if (typeof c === "number" && Number.isFinite(c))
			return Math.max(0, Math.round(c));
		const t = typeof c === "string" ? c : textOf(c);
		if (t == null) continue;
		if (!t.trim()) return 0;
		const parsed = parseCount(t);
		if (parsed) return parsed.value;
	}
	return 0;
}

/** Entity payloads by key, from `frameworkUpdates.entityBatchUpdate.mutations`. */
function entityMap(resp: unknown): Map<string, AnyObj> {
	const map = new Map<string, AnyObj>();
	for (const list of findAll<unknown>(resp, "mutations")) {
		if (!Array.isArray(list)) continue;
		for (const m of list) {
			const payload = isObj(m?.payload) ? (m.payload as AnyObj) : null;
			if (!payload) continue;
			for (const value of Object.values(payload)) {
				if (!isObj(value)) continue;
				const key = str(value.key) ?? str(m.entityKey);
				if (key && !map.has(key)) map.set(key, value);
			}
			const ek = str(m.entityKey);
			const first = Object.values(payload).find(isObj);
			if (ek && first && !map.has(ek)) map.set(ek, first);
		}
	}
	return map;
}

/** Legacy `commentRenderer`. */
export function parseCommentRenderer(r: unknown): VideoComment | null {
	if (!isObj(r)) return null;
	const id = str(r.commentId);
	const text = textOf(r.contentText)?.trim() ?? "";
	if (!id || !text) return null;
	const hearted =
		get<boolean>(
			r,
			"actionButtons",
			"commentActionButtonsRenderer",
			"creatorHeart",
			"creatorHeartRenderer",
			"isHearted",
		) === true;
	return {
		id,
		author: textOf(r.authorText)?.trim() || "Unknown",
		authorChannelId:
			str(get(r, "authorEndpoint", "browseEndpoint", "browseId")) ?? null,
		isCreator: r.authorIsChannelOwner === true,
		text,
		likes: countOf(
			get(r, "voteCount", "accessibility", "accessibilityData", "label"),
			r.voteCount,
			r.likeCount,
		),
		replies: countOf(r.replyCount),
		publishedText: textOf(r.publishedTimeText)?.trim() || null,
		isPinned: isObj(r.pinnedCommentBadge),
		isHearted: hearted,
	};
}

/** Current `commentViewModel` + its entity payloads. */
export function parseCommentViewModel(
	vm: unknown,
	entities: Map<string, AnyObj>,
): VideoComment | null {
	if (!isObj(vm)) return null;
	const commentKey = str(vm.commentKey);
	const entity = commentKey ? entities.get(commentKey) : undefined;
	if (!entity) return null;
	return parseCommentEntity(entity, vm, entities);
}

/** `commentEntityPayload` (optionally with its view model for pin/heart). */
export function parseCommentEntity(
	entity: AnyObj,
	vm: AnyObj | null,
	entities: Map<string, AnyObj>,
): VideoComment | null {
	const props = isObj(entity.properties) ? entity.properties : {};
	const author = isObj(entity.author) ? entity.author : {};
	const toolbar = isObj(entity.toolbar) ? entity.toolbar : {};
	const id = str(props.commentId) ?? str(vm?.commentId);
	const text = (textOf(props.content) ?? "").trim();
	if (!id || !text) return null;

	const toolbarKey = str(vm?.toolbarStateKey) ?? str(props.toolbarStateKey);
	const toolbarState = toolbarKey ? entities.get(toolbarKey) : undefined;
	const heartState = str(toolbarState?.heartState) ?? "";
	const pinnedText = textOf(vm?.pinnedText) ?? textOf(props.pinnedText);
	return {
		id,
		author: str(author.displayName)?.trim() ?? "Unknown",
		authorChannelId: str(author.channelId),
		isCreator: author.isCreator === true,
		text,
		likes: countOf(
			toolbar.likeCountA11y,
			toolbar.likeCountNotliked,
			toolbar.likeCount,
		),
		replies: countOf(toolbar.replyCount, props.replyCount),
		publishedText: str(props.publishedTime)?.trim() ?? null,
		isPinned: !!pinnedText?.trim(),
		isHearted: heartState === "TOOLBAR_HEART_STATE_HEARTED",
	};
}

function threadComment(
	thread: AnyObj,
	entities: Map<string, AnyObj>,
): VideoComment | null {
	const legacy = get<AnyObj>(thread, "comment", "commentRenderer");
	if (legacy) return parseCommentRenderer(legacy);
	const vm =
		get<AnyObj>(thread, "commentViewModel", "commentViewModel") ??
		get<AnyObj>(thread, "commentViewModel");
	return parseCommentViewModel(vm, entities);
}

function continuationToken(item: AnyObj): string | null {
	return (
		str(get(item, "continuationEndpoint", "continuationCommand", "token")) ??
		str(findFirst<AnyObj>(item, "continuationCommand")?.token)
	);
}

/** Top-level items of a continuation response, in order. */
function continuationItems(resp: unknown): AnyObj[] {
	const out: AnyObj[] = [];
	const endpoints = [
		...(get<AnyObj[]>(resp, "onResponseReceivedEndpoints") ?? []),
		...(get<AnyObj[]>(resp, "onResponseReceivedActions") ?? []),
	];
	for (const e of Array.isArray(endpoints) ? endpoints : []) {
		const cmd =
			e?.reloadContinuationItemsCommand ?? e?.appendContinuationItemsAction;
		if (Array.isArray(cmd?.continuationItems))
			out.push(...cmd.continuationItems.filter(isObj));
	}
	return out;
}

/** One page of a comments continuation response. Never throws. */
export function parseCommentsPage(resp: unknown): CommentsPage {
	const page: CommentsPage = {
		comments: [],
		total: null,
		nextToken: null,
		sortTokens: {},
	};
	if (!isObj(resp)) return page;
	const entities = entityMap(resp);
	const seen = new Set<string>();
	const push = (c: VideoComment | null) => {
		if (c && !seen.has(c.id)) {
			seen.add(c.id);
			page.comments.push(c);
		}
	};

	let items = continuationItems(resp);
	// Unknown envelope: fall back to a tree walk (threads don't nest threads).
	if (!items.length) {
		items = [
			...findAll<AnyObj>(resp, "commentsHeaderRenderer").map((h) => ({
				commentsHeaderRenderer: h,
			})),
			...findAll<AnyObj>(resp, "commentThreadRenderer").map((t) => ({
				commentThreadRenderer: t,
			})),
		];
	}

	for (const item of items) {
		if (isObj(item.commentsHeaderRenderer)) {
			const h = item.commentsHeaderRenderer;
			page.total =
				parseCount(textOf(h.countText)) ?? parseCount(textOf(h.commentsCount));
			const menu = findAll<AnyObj>(h, "subMenuItems")[0];
			if (Array.isArray(menu)) {
				menu.forEach((m: AnyObj, i: number) => {
					const token = str(findFirst<AnyObj>(m, "continuationCommand")?.token);
					if (!token) return;
					const title = (textOf(m?.title) ?? "").toLowerCase();
					const sort: CommentSort = /new/.test(title)
						? "newest"
						: /top/.test(title)
							? "top"
							: i === 0
								? "top"
								: "newest";
					page.sortTokens[sort] ??= token;
				});
			}
		} else if (isObj(item.commentThreadRenderer)) {
			push(threadComment(item.commentThreadRenderer, entities));
		} else if (isObj(item.commentRenderer)) {
			push(parseCommentRenderer(item.commentRenderer));
		} else if (isObj(item.commentViewModel)) {
			push(parseCommentViewModel(item.commentViewModel, entities));
		} else if (isObj(item.continuationItemRenderer)) {
			page.nextToken = continuationToken(item.continuationItemRenderer);
		}
	}

	// Threads without a usable view model: top-level entity payloads in order.
	if (!page.comments.length && entities.size) {
		for (const e of entities.values()) {
			if (!isObj(e.properties) || !str(e.properties.commentId)) continue;
			if (Number(e.properties.replyLevel ?? 0) > 0) continue;
			push(parseCommentEntity(e, null, entities));
		}
	}
	return page;
}

export type GetVideoCommentsOptions = {
	/** "top" (default) or "newest" */
	sort?: CommentSort;
	/** Max top-level comments, default 120, capped at 200 */
	limit?: number;
	force?: boolean;
	signal?: AbortSignal;
};

async function loadComments(
	videoId: string,
	sort: CommentSort,
	limit: number,
	signal?: AbortSignal,
): Promise<VideoComments> {
	const next = parseNext(await innertube("next", { videoId }, { signal }));
	const base: VideoComments = {
		videoId,
		sort,
		total: null,
		totalExact: false,
		disabled: false,
		isLive: next?.isLive ?? false,
		comments: [],
		hasMore: false,
		fetchedAt: new Date().toISOString(),
	};
	if (!next) throw new YouTubeError("NOT_FOUND", `Video ${videoId} not found`);
	if (!next.commentsToken) {
		return {
			...base,
			// No token and no "turned off" message: live chat replaces comments,
			// or the video has none to show. Either way nothing can be loaded.
			disabled: next.commentsDisabled || !next.isLive,
			total: next.commentsDisabled ? null : (next.commentsApprox ?? null),
		};
	}

	const comments: VideoComment[] = [];
	const seen = new Set<string>();
	let first = parseCommentsPage(
		await innertube("next", { continuation: next.commentsToken }, { signal }),
	);
	const total = first.total;
	if (sort === "newest" && first.sortTokens.newest) {
		first = parseCommentsPage(
			await innertube(
				"next",
				{ continuation: first.sortTokens.newest },
				{ signal },
			),
		);
	}
	let page: CommentsPage | null = first;
	let pages = 1;
	while (page) {
		for (const c of page.comments) {
			if (seen.has(c.id)) continue;
			seen.add(c.id);
			comments.push(c);
		}
		if (comments.length >= limit || !page.nextToken || pages >= MAX_PAGES)
			break;
		const token: string = page.nextToken;
		pages++;
		try {
			page = parseCommentsPage(
				await innertube("next", { continuation: token }, { signal }),
			);
		} catch (error) {
			// Later pages are a bonus: keep what we have unless nothing loaded.
			if (!comments.length) throw error;
			break;
		}
		if (!page.comments.length && !page.nextToken) break;
	}
	return {
		...base,
		total: total?.value ?? next.commentsApprox ?? null,
		totalExact: total?.exact ?? false,
		comments: comments.slice(0, limit),
		hasMore: comments.length > limit || !!page?.nextToken,
	};
}

/**
 * Top-level comments (author, text, likes, replies, pinned/hearted) of a
 * video. Memory-cached 15 minutes; requests go through the shared InnerTube
 * limiter.
 */
export async function getVideoComments(
	videoId: string,
	opts: GetVideoCommentsOptions = {},
): Promise<VideoComments> {
	if (!isVideoId(videoId))
		throw new YouTubeError("NOT_FOUND", `Invalid video id: ${videoId}`);
	const sort: CommentSort = opts.sort === "newest" ? "newest" : "top";
	const limit = Math.max(
		1,
		Math.min(MAX_COMMENTS, Math.round(opts.limit ?? DEFAULT_COMMENTS)),
	);
	return cached(
		`comments:v1:${videoId}:${sort}:${limit}`,
		COMMENTS_TTL,
		() => loadComments(videoId, sort, limit, opts.signal),
		{ force: opts.force, persist: false },
	);
}
