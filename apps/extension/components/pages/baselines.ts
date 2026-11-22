/**
 * Outlier scores for arbitrary lists of videos (search results, trending):
 * looks up each channel's baseline lazily, two channels at a time, cached for
 * the session.
 */
import { useEffect, useState } from "react";

import { yt } from "@/lib/client";

import { createQueue, outlierOf } from "./utils";

const cache = new Map<string, Promise<number | null>>();
const queue = createQueue(2);

/**
 * Median views of the channel's recent uploads of that format (null =
 * unknown). Only answers are cached: a failed lookup (e.g. AUTH_REQUIRED
 * while signing out, or a transient YouTube error) is forgotten, so the next
 * call asks again.
 */
export function channelBaseline(
	channelId: string,
	format: "long" | "short",
): Promise<number | null> {
	const key = `${channelId}:${format}`;
	let p = cache.get(key);
	if (!p) {
		const raw = queue(() =>
			yt.getChannelBaseline(channelId, format).then((b) => b.baseline),
		);
		raw.catch(() => {
			if (cache.get(key) === raw) cache.delete(key);
		});
		cache.set(key, raw);
		p = raw;
	}
	return p.catch(() => null);
}

export type OutlierInput = {
	videoId: string;
	channelId: string | null;
	views: number | null;
	isShort?: boolean;
};

/**
 * videoId -> outlier score; `undefined` while loading, `null` when unknown.
 * Pass `enabled: false` to skip (e.g. while the list is hidden).
 */
export function useOutliers(
	items: readonly OutlierInput[],
	enabled = true,
): Record<string, number | null | undefined> {
	const [scores, setScores] = useState<Record<string, number | null>>({});
	const signature = items
		.map((i) => `${i.videoId}:${i.channelId ?? ""}:${i.views ?? ""}`)
		.join("|");

	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on `signature`
	useEffect(() => {
		if (!enabled) return;
		let alive = true;
		for (const item of items) {
			if (!item.channelId || item.views == null) {
				setScores((s) =>
					item.videoId in s ? s : { ...s, [item.videoId]: null },
				);
				continue;
			}
			const views = item.views;
			void channelBaseline(
				item.channelId,
				item.isShort ? "short" : "long",
			).then((baseline) => {
				if (alive)
					setScores((s) => ({
						...s,
						[item.videoId]: outlierOf(views, baseline),
					}));
			});
		}
		return () => {
			alive = false;
		};
	}, [signature, enabled]);

	return scores;
}
