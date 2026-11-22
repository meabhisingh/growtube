import {
	videoHistoryQuery,
	videoIdSchema,
	videoStatsQuery,
} from "@growtube/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
	getVideoHistory,
	getVideoStats,
	VIDEO_HISTORY_CACHE_SECONDS,
} from "../data/videos";
import { clientCache } from "../lib/http";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

export const videoRoutes = new Hono<AppEnv>()
	// Batch stats for feed cards: GET /v1/videos/stats?ids=a,b,c (max 50).
	.get("/stats", validate("query", videoStatsQuery), async (c) => {
		const { ids } = c.req.valid("query");
		const stats = await getVideoStats(c.var.db, ids);
		c.header("Cache-Control", clientCache(60));
		return c.json(stats);
	})
	.get(
		"/:id/history",
		validate("param", z.object({ id: videoIdSchema })),
		validate("query", videoHistoryQuery),
		async (c) => {
			const { id } = c.req.valid("param");
			const { range } = c.req.valid("query");
			const { value, hit } = await getVideoHistory(c.var, id, range);
			c.header("X-Cache", hit ? "HIT" : "MISS");
			c.header("Cache-Control", clientCache(VIDEO_HISTORY_CACHE_SECONDS));
			return c.json(value);
		},
	);
