import { channelIdSchema, channelResolveQuery } from "@growtube/shared";
import { Hono } from "hono";
import { z } from "zod";

import {
	CHANNEL_HISTORY_CACHE_SECONDS,
	findChannelByHandle,
	getChannelHistory,
} from "../data/channels";
import { clientCache } from "../lib/http";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

/** Short: a handle we haven't seen yet may be reported by a client any time. */
const RESOLVE_CACHE_SECONDS = 300;

export const channelRoutes = new Hono<AppEnv>()
	// @handle -> channel id, from channels clients have reported.
	// GET /v1/channels/resolve?handle=@name
	.get("/resolve", validate("query", channelResolveQuery), async (c) => {
		const { handle } = c.req.valid("query");
		const channel = await findChannelByHandle(c.var.db, handle);
		if (!channel) {
			c.header("Cache-Control", clientCache(60));
			return c.json(
				{
					error: "Channel not found",
					details: {
						handle,
						hint: "GrowTube only knows channels its users have visited; use the channel's UC… id or URL instead.",
					},
				},
				404,
			);
		}
		c.header("Cache-Control", clientCache(RESOLVE_CACHE_SECONDS));
		return c.json(channel);
	})
	.get(
		"/:id/history",
		validate("param", z.object({ id: channelIdSchema })),
		async (c) => {
			const { id } = c.req.valid("param");
			const { value, hit } = await getChannelHistory(c.var, id);
			c.header("X-Cache", hit ? "HIT" : "MISS");
			c.header("Cache-Control", clientCache(CHANNEL_HISTORY_CACHE_SECONDS));
			return c.json(value);
		},
	);
