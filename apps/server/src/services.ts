import { createAuth as createConfiguredAuth } from "@open-vidiq/auth";
import { createDb, type Database } from "@open-vidiq/db";
import type { Context } from "hono";

import { ENV } from "./env.server";
import { createRedis } from "./lib/redis";
import type { AppEnv } from "./types";

export function getDb(): Database {
	return createDb(ENV);
}

export function getRedis() {
	return createRedis(ENV);
}

export function createAuth(database: Database) {
	return createConfiguredAuth(
		{
			...ENV,
			// Optional binding: typed as string by InferEnv, but may be unset.
			EXTENSION_ORIGINS: (ENV as { EXTENSION_ORIGINS?: string })
				.EXTENSION_ORIGINS,
		},
		database,
	);
}

/** This request's better-auth instance (bound to its db client), created once. */
export function authFor(c: Context<AppEnv>) {
	let auth = c.get("auth");
	if (!auth) {
		auth = createAuth(c.var.db);
		c.set("auth", auth);
	}
	return auth;
}
