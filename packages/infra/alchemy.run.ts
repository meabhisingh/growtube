import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import "varlock/auto-load";

/**
 * An optional secret: resolves to `undefined` when unset, and Alchemy binds
 * nothing for undefined env entries. Typed as a required Redacted config only
 * because `InferEnv` can't express an optional binding (a `| undefined` value
 * collapses the whole env type), so the Worker must still treat it as
 * possibly missing.
 */
const optionalSecret = (name: string) =>
	Config.Redacted(name).pipe(
		Config.withDefault(undefined),
	) as unknown as Config.Config<Redacted.Redacted<string>>;

/** An optional plain-text variable; same `InferEnv` caveat as `optionalSecret`. */
const optionalString = (name: string) =>
	Config.String(name).pipe(
		Config.withDefault(undefined),
	) as unknown as Config.Config<string>;

export const server = Cloudflare.Worker("server", {
	main: "../../apps/server/src/index.ts",
	compatibility: {
		flags: ["nodejs_compat"],
	},
	env: {
		DATABASE_URL: Config.Redacted("DATABASE_URL"),
		REDIS_URL: Config.Redacted("REDIS_URL"),
		CORS_ORIGIN: Config.String("CORS_ORIGIN"),
		BETTER_AUTH_SECRET: Config.Redacted("BETTER_AUTH_SECRET"),
		BETTER_AUTH_URL: Cloudflare.Worker.URL,
		// Optional: enables the hourly YouTube Data API refresh (cron).
		YOUTUBE_API_KEY: optionalSecret("YOUTUBE_API_KEY"),
		// Optional: pins extension sign-in to these chrome-extension://<id>
		// origins (comma-separated). See packages/auth.
		EXTENSION_ORIGINS: optionalString("EXTENSION_ORIGINS"),
	},
	// Hourly refresh/prune; the handler is the `scheduled` export of apps/server/src/index.ts.
	crons: ["0 * * * *"],
	dev: {
		port: 3000,
	},
});

export type ServerEnv = Cloudflare.InferEnv<typeof server>;

export default Alchemy.Stack(
	"open-vidiq",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const serverWorker = yield* server;

		return {
			server: serverWorker.url,
		};
	}),
);
