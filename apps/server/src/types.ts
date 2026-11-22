import type { Auth } from "@growtube/auth";
import type { Database } from "@growtube/db";
import type { Redis } from "ioredis";

/** Per-request I/O clients (see the middleware in index.ts). */
export type Deps = {
	db: Database;
	redis: Redis;
};

export type AppEnv = {
	Variables: Deps & {
		/** better-auth for this request's db client (created on first use, see `authFor`). */
		auth?: Auth;
		/**
		 * The signed-in user (`requireUser` on /v1/*, the API key's owner on
		 * /mcp). Only for auth and rate limiting: never store it with
		 * crowdsourced data.
		 */
		userId?: string;
		/**
		 * The request headers `resolveSessionUser` authenticated (delete-user,
		 * api-key create): the only ones better-auth's handler gets there.
		 */
		authHeaders?: Headers;
	};
};
