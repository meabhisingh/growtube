import { ingestChannelsBody, ingestVideosBody } from "@open-vidiq/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { ingestChannels } from "../data/channels";
import { ingestVideos } from "../data/videos";
import { rateLimitPerUser } from "../lib/rate-limit";
import { validate } from "../lib/validate";
import type { AppEnv } from "../types";

/** Requests per user per minute across all ingest endpoints. */
export const INGEST_RATE_LIMIT = 300;
/** A full batch (50 items) is well under this. */
const MAX_INGEST_BODY_BYTES = 1024 * 1024;

/**
 * Crowdsourced uploads stay anonymous: `c.var.userId` (set by `requireUser`)
 * only feeds the rate limiter and is never stored with the data.
 */
export const ingestRoutes = new Hono<AppEnv>()
	.use("*", rateLimitPerUser({ limit: INGEST_RATE_LIMIT, name: "ingest" }))
	.use(
		"*",
		bodyLimit({
			maxSize: MAX_INGEST_BODY_BYTES,
			onError: (c) =>
				c.json(
					{
						error: "Payload too large",
						details: { maxBytes: MAX_INGEST_BODY_BYTES },
					},
					413,
				),
		}),
	)
	.post("/videos", validate("json", ingestVideosBody), async (c) => {
		const { videos } = c.req.valid("json");
		return c.json(await ingestVideos(c.var, videos));
	})
	.post("/channels", validate("json", ingestChannelsBody), async (c) => {
		const { channels } = c.req.valid("json");
		return c.json(await ingestChannels(c.var, channels));
	});
