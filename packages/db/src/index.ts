import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { DatabaseConfig } from "./config";
import { relations } from "./relations";

export * from "./log";
export * from "./orm";
export * from "./schema/youtube";

/**
 * Creates a Drizzle client over a node-postgres pool.
 *
 * Uses plain TCP (via `nodejs_compat` sockets on Workers), so the same code
 * talks to local Docker Postgres in dev and Neon in production.
 *
 * On Cloudflare Workers, I/O objects can't be shared across requests, so
 * create one per request and close it with `db.$client.end()` when done.
 * The pool connects lazily: no connection is opened until the first query.
 */
export function createDb(env: DatabaseConfig) {
	const pool = new Pool({
		connectionString: env.DATABASE_URL,
		max: 5,
	});
	return drizzle({ client: pool, relations });
}

export type Database = ReturnType<typeof createDb>;
