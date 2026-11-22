import { trendingQuery } from "@open-vidiq/shared";
import { Hono } from "hono";

import { getTrending, TRENDING_CACHE_SECONDS } from "../data/trending";
import { clientCache } from "../lib/http";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

export const trendingRoutes = new Hono<AppEnv>().get(
	"/",
	validate("query", trendingQuery),
	async (c) => {
		const { value, hit } = await getTrending(c.var, c.req.valid("query"));
		c.header("X-Cache", hit ? "HIT" : "MISS");
		c.header("Cache-Control", clientCache(TRENDING_CACHE_SECONDS));
		return c.json(value);
	},
);
