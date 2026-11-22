/**
 * Feed badges controller: finds video cards (home, search, subscriptions,
 * channel tabs, watch-page related, Shorts shelves), adds one badge row per
 * card and fills it lazily for cards near the viewport.
 *
 * Performance rules:
 * - MutationObserver records are only collected; work happens in a throttled
 *   scan (<= 1 per 250 ms), never inside the observer callback.
 * - Network work starts only when a card is within 300px of the viewport,
 *   through batched/memoized loaders (see data.ts).
 * - DOM writes are batched per animation frame and skipped when unchanged.
 * - YouTube recycles card elements across SPA navigations, so each card is
 *   keyed by the video/playlist it currently shows and re-keyed on change.
 *
 * Privacy: on personal pages (watch history, library, playlists; see
 * `isPersonalPage`) badges use YouTube data only. No server lookups and no
 * crowdsourcing, because those cards can be unlisted or private videos and
 * the list itself is the user's history.
 */
import { computeOutlierScore, computeVph } from "@open-vidiq/shared/metrics";

import type { ContentScriptContext } from "#imports";

import { onYouTubeThemeChange } from "@/lib/dom";
import { isPersonalPage } from "@/lib/youtube/visibility";

import { CARD_SELECTOR, FEED_BADGES_TAG } from "../selectors";
import { FeedData } from "./data";
import {
	badgeAnchor,
	type CardInfo,
	cardKey,
	extractCard,
	isTopLevelCard,
} from "./extract";
import {
	type BadgeHost,
	createBadgeHost,
	outlierPill,
	type PillSpec,
	renderPills,
	sizePill,
	skeleton,
	subsPill,
	syncBadgeTheme,
	vphPill,
} from "./render";

type LoadState = "idle" | "loading" | "done";

type CardState = {
	card: Element;
	key: string;
	info: CardInfo;
	/** Bumped whenever the card is re-keyed or torn down; stale work checks it */
	token: number;
	visible: boolean;
	activated: boolean;
	badge: BadgeHost | null;
	waiters: (() => void)[];
	views: number | null;
	viewsExact: boolean;
	publishedAt: number | null;
	publishedApprox: boolean;
	recentVph: number | null;
	channelId: string | null;
	isShort: boolean;
	isLive: boolean;
	isUpcoming: boolean;
	factsState: LoadState;
	subscribers: number | null;
	subsState: LoadState;
	baseline: number | null;
	baselineState: LoadState;
};

export type FeedBadgesController = {
	start: () => void;
	stop: () => void;
	/** Call after SPA navigations: forces a full rescan */
	refresh: () => void;
};

const SCAN_THROTTLE_MS = 250;
const SWEEP_INTERVAL_MS = 3_000;
/** Server snapshots older than this lose to fresher (rounded) card counts */
const STALE_SNAPSHOT_MS = 6 * 3_600_000;

export function createFeedBadges(
	ctx: ContentScriptContext,
): FeedBadgesController {
	let running = false;
	let states = new WeakMap<Element, CardState>();
	const tracked = new Set<Element>();
	let mutationObserver: MutationObserver | null = null;
	let intersectionObserver: IntersectionObserver | null = null;
	let data: FeedData | null = null;
	let tokenSeq = 0;

	// Pending scan input
	const pendingTargets = new Set<Node>();
	const pendingAdded = new Set<Element>();
	let pendingFull = false;
	let scanTimer: ReturnType<typeof setTimeout> | null = null;
	let sweepTimer: number | null = null;
	let offTheme: (() => void) | null = null;

	// Batched renders
	const renderQueue = new Set<CardState>();
	let rafId = 0;

	// -------------------------------------------------------------------------
	// Scanning
	// -------------------------------------------------------------------------

	function scheduleScan(full = false) {
		if (full) pendingFull = true;
		if (scanTimer != null || !running) return;
		scanTimer = setTimeout(runScan, SCAN_THROTTLE_MS);
	}

	function runScan() {
		scanTimer = null;
		if (!running) return;
		const cards = new Set<Element>();
		if (pendingFull) {
			for (const c of document.querySelectorAll(CARD_SELECTOR)) cards.add(c);
			for (const c of tracked) {
				if (!c.isConnected) untrack(c);
			}
		} else {
			for (const el of pendingAdded) {
				if (!el.isConnected) continue;
				if (el.matches(CARD_SELECTOR)) cards.add(el);
				if (el.firstElementChild) {
					for (const c of el.querySelectorAll(CARD_SELECTOR)) cards.add(c);
				}
			}
			for (const node of pendingTargets) {
				const el = node instanceof Element ? node : node.parentElement;
				const card = el?.isConnected ? el.closest(CARD_SELECTOR) : null;
				if (card) cards.add(card);
			}
		}
		pendingFull = false;
		pendingAdded.clear();
		pendingTargets.clear();
		for (const card of cards) processCard(card);
	}

	function onMutations(records: MutationRecord[]) {
		for (const r of records) {
			if (r.type === "childList") {
				// Our own insertions are ignored; removals always trigger a re-check
				// (YouTube re-rendering a card may drop our row).
				let onlyOurs = r.removedNodes.length === 0;
				for (const n of r.addedNodes) {
					if (n instanceof Element) {
						if (n.localName === FEED_BADGES_TAG) continue;
						onlyOurs = false;
						pendingAdded.add(n);
					} else {
						onlyOurs = false;
					}
				}
				if (!onlyOurs) pendingTargets.add(r.target);
			} else {
				pendingTargets.add(r.target);
			}
		}
		if (pendingAdded.size || pendingTargets.size) scheduleScan();
	}

	function onIntersections(entries: IntersectionObserverEntry[]) {
		for (const entry of entries) {
			const st = states.get(entry.target);
			if (!st) continue;
			st.visible = entry.isIntersecting;
			if (st.visible) {
				activate(st);
				const waiters = st.waiters;
				st.waiters = [];
				for (const w of waiters) w();
			}
		}
	}

	function untrack(card: Element) {
		tracked.delete(card);
		intersectionObserver?.unobserve(card);
		const st = states.get(card);
		if (st) teardown(st);
		states.delete(card);
	}

	function teardown(st: CardState) {
		st.token = ++tokenSeq;
		st.badge?.host.remove();
		st.badge = null;
		renderQueue.delete(st);
		const waiters = st.waiters;
		st.waiters = [];
		for (const w of waiters) w();
	}

	function newState(
		card: Element,
		info: CardInfo,
		visible: boolean,
	): CardState {
		return {
			card,
			key: info.key,
			info,
			token: ++tokenSeq,
			visible,
			activated: false,
			badge: null,
			waiters: [],
			views: info.views,
			viewsExact: false,
			publishedAt: info.publishedAt,
			publishedApprox: info.publishedAt != null,
			recentVph: null,
			channelId:
				info.channelRef && "channelId" in info.channelRef
					? info.channelRef.channelId
					: null,
			isShort: info.kind === "short",
			isLive: info.isLive,
			isUpcoming: info.isUpcoming,
			factsState: "idle",
			subscribers: null,
			subsState: "idle",
			baseline: null,
			baselineState: "idle",
		};
	}

	function processCard(card: Element) {
		if (!card.isConnected || !isTopLevelCard(card)) return;
		const key = cardKey(card);
		const prev = states.get(card);
		if (!key) {
			if (prev) {
				teardown(prev);
				states.delete(card);
			}
			return;
		}
		if (!prev || prev.key !== key) {
			const info = extractCard(card);
			if (!info) return;
			if (prev) teardown(prev);
			const st = newState(card, info, prev?.visible ?? false);
			states.set(card, st);
			if (!tracked.has(card)) {
				tracked.add(card);
				intersectionObserver?.observe(card);
			}
			if (st.visible) activate(st);
			return;
		}
		// Same video: text may have rendered after the link, so fill gaps.
		if (
			prev.factsState !== "done" &&
			(prev.views == null || prev.publishedAt == null)
		) {
			const info = extractCard(card);
			if (info && info.key === prev.key) {
				if (prev.views == null && info.views != null) prev.views = info.views;
				if (prev.publishedAt == null && info.publishedAt != null) {
					prev.publishedAt = info.publishedAt;
					prev.publishedApprox = true;
				}
				prev.isLive ||= info.isLive;
				prev.isUpcoming ||= info.isUpcoming;
				prev.info = {
					...info,
					channelRef: prev.info.channelRef ?? info.channelRef,
				};
				queueRender(prev);
			}
		}
		if (prev.badge) placeHost(prev);
		else if (prev.visible) activate(prev);
	}

	// -------------------------------------------------------------------------
	// Rendering
	// -------------------------------------------------------------------------

	function placeHost(st: CardState): boolean {
		if (!st.badge) return false;
		const anchor = badgeAnchor(st.card);
		if (!anchor) return false;
		const host = st.badge.host;
		const placed = anchor.after
			? anchor.after.nextElementSibling === host
			: host.parentElement === anchor.parent;
		if (!placed) {
			if (anchor.after) anchor.after.after(host);
			else anchor.parent.append(host);
		}
		// Never leave duplicates behind (recycled cards, older script instances).
		for (const other of st.card.querySelectorAll(FEED_BADGES_TAG)) {
			if (other !== host) other.remove();
		}
		return true;
	}

	function queueRender(st: CardState) {
		if (!st.badge) return;
		renderQueue.add(st);
		if (!rafId) rafId = requestAnimationFrame(flushRenders);
	}

	function flushRenders() {
		rafId = 0;
		for (const st of renderQueue) {
			if (!st.badge || !st.card.isConnected) continue;
			if (placeHost(st)) renderPills(st.badge, pillsFor(st));
		}
		renderQueue.clear();
	}

	function format(st: CardState): "long" | "short" {
		return st.isShort ? "short" : "long";
	}

	function pillsFor(st: CardState): PillSpec[] {
		const pills: PillSpec[] = [];
		if (st.info.kind === "playlist") {
			if (st.info.playlistSize) pills.push(sizePill(st.info.playlistSize));
		} else if (!st.isLive && !st.isUpcoming) {
			const vph =
				st.recentVph ??
				(st.views != null && st.publishedAt != null
					? computeVph(st.views, st.publishedAt)
					: null);
			if (vph != null) {
				pills.push(
					vphPill(
						vph,
						st.publishedApprox || !st.viewsExact,
						st.recentVph != null,
					),
				);
			} else if (st.factsState === "loading") {
				pills.push(skeleton("vph"));
			}
			if (st.baselineState === "loading") {
				pills.push(skeleton("outlier"));
			} else if (st.baseline != null && st.views != null) {
				const score = computeOutlierScore(st.views, st.baseline);
				if (score != null)
					pills.push(outlierPill(score, st.baseline, format(st)));
			}
		}
		if (st.subsState === "loading") pills.push(skeleton("subs"));
		else if (st.subscribers != null) pills.push(subsPill(st.subscribers));
		return pills;
	}

	function activate(st: CardState) {
		if (st.activated || !running) return;
		st.activated = true;
		st.badge = createBadgeHost();
		if (!placeHost(st)) {
			// No anchor yet (card still rendering): retry on the next scan.
			st.badge = null;
			st.activated = false;
			return;
		}
		queueRender(st);
		void hydrate(st, st.token);
	}

	// -------------------------------------------------------------------------
	// Data
	// -------------------------------------------------------------------------

	function waitVisible(st: CardState, token: number): Promise<boolean> {
		if (st.token !== token || !running) return Promise.resolve(false);
		if (st.visible) return Promise.resolve(true);
		return new Promise((resolve) => {
			st.waiters.push(() => resolve(st.token === token && running));
		});
	}

	async function hydrate(st: CardState, token: number) {
		const loader = data;
		if (!loader) return;
		const alive = () => st.token === token && running;
		const { info } = st;
		const personal = isPersonalPage(location.href);

		if (info.videoId) {
			// Live / upcoming cards only need their channel (no VPH or outlier).
			const timed = () => !st.isLive && !st.isUpcoming;
			const needsFacts =
				timed() && (st.views == null || st.publishedAt == null);
			if (needsFacts) st.factsState = "loading";
			if (needsFacts || !info.channelRef) queueRender(st);

			const stats = await loader.stats(info.videoId, personal);
			if (!alive()) return;
			if (stats) {
				const fresh =
					stats.lastSnapshotAt != null &&
					Date.now() - Date.parse(stats.lastSnapshotAt) < STALE_SNAPSHOT_MS;
				if (st.views == null || fresh || stats.views >= st.views) {
					st.views = stats.views;
					st.viewsExact = true;
				}
				if (stats.publishedAt) {
					st.publishedAt = Date.parse(stats.publishedAt);
					st.publishedApprox = false;
				}
				if (stats.vphSource === "recent" && stats.recentVph != null) {
					st.recentVph = stats.recentVph;
				}
				st.channelId ??= stats.channelId;
				if (stats.isShort != null) st.isShort = stats.isShort;
			}

			const missing =
				(timed() && (st.views == null || st.publishedAt == null)) ||
				(!st.info.channelRef && !st.channelId);
			if (missing) {
				st.factsState = "loading";
				queueRender(st);
				if (!(await waitVisible(st, token))) return;
				const d = await loader.details(info.videoId, personal);
				if (!alive()) return;
				if (d) {
					st.views = d.views;
					st.viewsExact = true;
					if (d.publishedAt) {
						st.publishedAt = Date.parse(d.publishedAt);
						st.publishedApprox = false;
					}
					st.channelId ??= d.channelId || null;
					st.isShort = d.isShort || st.isShort;
					st.isLive = d.isLive;
					st.isUpcoming = d.isUpcoming;
					if (d.channelSubscribers != null)
						st.subscribers = d.channelSubscribers;
				}
			}
			st.factsState = "done";
			queueRender(st);
		}

		const ref =
			st.info.channelRef ?? (st.channelId ? { channelId: st.channelId } : null);
		if (!ref) {
			queueRender(st);
			return;
		}
		if (!(await waitVisible(st, token))) return;
		st.subsState = "loading";
		const wantsBaseline =
			info.kind !== "playlist" && !st.isLive && !st.isUpcoming;
		if (wantsBaseline) st.baselineState = "loading";
		queueRender(st);

		const channel = await loader.channel(ref, personal);
		if (!alive()) return;
		st.subsState = "done";
		if (channel) {
			st.subscribers = channel.subscribers ?? st.subscribers;
			st.channelId = channel.channelId;
		}
		queueRender(st);

		if (!wantsBaseline || !st.channelId || st.views == null) {
			st.baselineState = "done";
			queueRender(st);
			return;
		}
		if (!(await waitVisible(st, token))) return;
		const baseline = await loader.baseline(st.channelId, format(st));
		if (!alive()) return;
		st.baseline = baseline;
		st.baselineState = "done";
		queueRender(st);
	}

	// -------------------------------------------------------------------------
	// Lifecycle
	// -------------------------------------------------------------------------

	function start() {
		if (running || ctx.isInvalid) return;
		running = true;
		data = new FeedData({ onInvalidated: stop });
		// Leftovers from an older (reloaded) instance of the extension.
		for (const el of document.querySelectorAll(FEED_BADGES_TAG)) el.remove();
		intersectionObserver = new IntersectionObserver(onIntersections, {
			rootMargin: "300px 0px 300px 0px",
		});
		mutationObserver = new MutationObserver(onMutations);
		mutationObserver.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ["href"],
		});
		offTheme = onYouTubeThemeChange(syncBadgeTheme);
		sweepTimer = ctx.setInterval(() => {
			if (document.visibilityState === "visible") scheduleScan(true);
		}, SWEEP_INTERVAL_MS);
		scheduleScan(true);
	}

	function stop() {
		if (!running) return;
		running = false;
		mutationObserver?.disconnect();
		mutationObserver = null;
		offTheme?.();
		offTheme = null;
		intersectionObserver?.disconnect();
		intersectionObserver = null;
		if (scanTimer != null) clearTimeout(scanTimer);
		scanTimer = null;
		if (sweepTimer != null) clearInterval(sweepTimer);
		sweepTimer = null;
		if (rafId) cancelAnimationFrame(rafId);
		rafId = 0;
		for (const card of tracked) {
			const st = states.get(card);
			if (st) teardown(st);
		}
		tracked.clear();
		states = new WeakMap();
		renderQueue.clear();
		pendingAdded.clear();
		pendingTargets.clear();
		data?.clear();
		data = null;
		for (const el of document.querySelectorAll(FEED_BADGES_TAG)) el.remove();
	}

	ctx.onInvalidated(stop);

	return {
		start,
		stop,
		refresh: () => scheduleScan(true),
	};
}
