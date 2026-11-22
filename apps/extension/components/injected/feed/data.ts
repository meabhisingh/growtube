/**
 * Data loading for feed badges: batched, memoized and concurrency-capped so
 * a page of 50 cards costs a handful of background messages.
 *
 * - Server stats (recent VPH, exact views, channel id): one request per 50 ids.
 * - Video details (basic, 1 InnerTube call each) only for cards that need them
 *   (no channel link, no age, non-English UI) and the server doesn't know.
 * - Channels (subscribers) and baselines (outlier) deduped per channel.
 * Everything is cached again in the background, so revisits are instant.
 *
 * Personal pages (`isPersonalPage`: history, library, playlists) pass
 * `personal`: no server stats at all, and nothing fetched for them is
 * crowdsourced. Their cards can be unlisted or private videos, and the list
 * itself is the user's watch history.
 */
import type { VideoStats } from "@open-vidiq/shared/api-extra";

import { server, yt } from "@/lib/client";
import { createLimiter } from "@/lib/limiter";
import type {
	ChannelInfo,
	ChannelRef,
	VideoDetails,
} from "@/lib/youtube/types";

import { isContextInvalidated } from "../common/async";

type BatchRunner<V> = (keys: string[]) => Promise<Map<string, V | null>>;

/** Collects keys for `delayMs`, then loads them in chunks of `max`. */
class Batcher<V> {
	private readonly memo = new Map<string, Promise<V | null>>();
	private queue: { key: string; resolve: (v: V | null) => void }[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly run: BatchRunner<V>,
		private readonly max: number,
		private readonly delayMs: number,
	) {}

	get(key: string): Promise<V | null> {
		const hit = this.memo.get(key);
		if (hit) return hit;
		const p = new Promise<V | null>((resolve) => {
			this.queue.push({ key, resolve });
		});
		this.memo.set(key, p);
		if (this.queue.length >= this.max) this.flush();
		else this.timer ??= setTimeout(() => this.flush(), this.delayMs);
		return p;
	}

	/** Forget a key (e.g. after a transient failure) so it can be retried. */
	forget(key: string): void {
		this.memo.delete(key);
	}

	private flush(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		while (this.queue.length) {
			const chunk = this.queue.splice(0, this.max);
			const keys = chunk.map((c) => c.key);
			this.run(keys)
				.catch(() => new Map<string, V | null>())
				.then((result) => {
					for (const { key, resolve } of chunk)
						resolve(result.get(key) ?? null);
				});
		}
	}

	clear(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		for (const { resolve } of this.queue) resolve(null);
		this.queue = [];
		this.memo.clear();
	}
}

export type FeedDataOptions = {
	/** Called once when the extension context dies (reload/update) */
	onInvalidated: () => void;
};

const SERVER_RETRY_MS = 5 * 60_000;

export class FeedData {
	private serverDownUntil = 0;
	private readonly limit = createLimiter(3);
	private readonly channels = new Map<string, Promise<ChannelInfo | null>>();
	private readonly baselines = new Map<string, Promise<number | null>>();
	private invalidated = false;

	private readonly statsBatch: Batcher<VideoStats>;
	private readonly detailsBatch: Batcher<VideoDetails>;
	/** Same, for personal pages: never crowdsourced. */
	private readonly personalDetailsBatch: Batcher<VideoDetails>;

	constructor(private readonly opts: FeedDataOptions) {
		this.statsBatch = new Batcher<VideoStats>(
			(ids) => this.loadStats(ids),
			50,
			120,
		);
		this.detailsBatch = new Batcher<VideoDetails>(
			(ids) => this.loadDetails(ids, true),
			20,
			150,
		);
		this.personalDetailsBatch = new Batcher<VideoDetails>(
			(ids) => this.loadDetails(ids, false),
			20,
			150,
		);
	}

	private fail(error: unknown): void {
		if (!this.invalidated && isContextInvalidated(error)) {
			this.invalidated = true;
			this.opts.onInvalidated();
		}
	}

	private async loadStats(
		ids: string[],
	): Promise<Map<string, VideoStats | null>> {
		const out = new Map<string, VideoStats | null>();
		if (Date.now() < this.serverDownUntil) return out;
		try {
			const res = await server.getVideosStats(ids);
			for (const v of res.videos) out.set(v.videoId, v);
		} catch (error) {
			this.fail(error);
			// Server not running / not permitted: badges fall back to YouTube data.
			this.serverDownUntil = Date.now() + SERVER_RETRY_MS;
			for (const id of ids) this.statsBatch.forget(id);
		}
		return out;
	}

	private async loadDetails(
		ids: string[],
		crowdsource: boolean,
	): Promise<Map<string, VideoDetails | null>> {
		const out = new Map<string, VideoDetails | null>();
		try {
			const res = await yt.getVideoDetailsBatch(ids, "basic", { crowdsource });
			for (const [id, d] of Object.entries(res)) out.set(id, d);
		} catch (error) {
			this.fail(error);
		}
		return out;
	}

	/**
	 * Server-side stats (null when unknown or the server is unavailable).
	 * Never asked on personal pages.
	 */
	stats(videoId: string, personal: boolean): Promise<VideoStats | null> {
		if (personal || Date.now() < this.serverDownUntil)
			return Promise.resolve(null);
		return this.statsBatch.get(videoId);
	}

	/** Exact views / publish date / channel id from YouTube (1 request per video). */
	details(videoId: string, personal: boolean): Promise<VideoDetails | null> {
		return (personal ? this.personalDetailsBatch : this.detailsBatch).get(
			videoId,
		);
	}

	/**
	 * Channel info (subscribers), deduped by id and handle. Crowdsourced
	 * unless the first request for it came from a personal page.
	 */
	channel(ref: ChannelRef, personal: boolean): Promise<ChannelInfo | null> {
		const key =
			"channelId" in ref
				? `id:${ref.channelId}`
				: `h:${ref.handle.toLowerCase()}`;
		const hit = this.channels.get(key);
		if (hit) return hit;
		const p = this.limit(() => yt.getChannel(ref, { crowdsource: !personal }))
			.then((info) => {
				this.channels.set(`id:${info.channelId}`, p);
				return info;
			})
			.catch((error: unknown) => {
				this.fail(error);
				return null;
			});
		this.channels.set(key, p);
		return p;
	}

	/** Median views of the channel's recent uploads of that format. */
	baseline(
		channelId: string,
		format: "long" | "short",
	): Promise<number | null> {
		const key = `${channelId}:${format}`;
		const hit = this.baselines.get(key);
		if (hit) return hit;
		const p = this.limit(() => yt.getChannelBaseline(channelId, format))
			.then((b) => b.baseline)
			.catch((error: unknown) => {
				this.fail(error);
				return null;
			});
		this.baselines.set(key, p);
		return p;
	}

	clear(): void {
		this.statsBatch.clear();
		this.detailsBatch.clear();
		this.personalDetailsBatch.clear();
		this.channels.clear();
		this.baselines.clear();
	}
}
