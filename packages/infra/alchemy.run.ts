import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
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
	// Fixed name, so the URL is always https://growtube-api.<subdomain>.workers.dev
	// (better-auth's base URL, and the server URL the web app and extension use).
	name: "growtube-api",
	main: "../../apps/server/src/index.ts",
	// Same date as apps/server/wrangler.jsonc. Node.js compatibility (node:net and
	// node:tls for pg and ioredis) is on by default from 2026-08-04, so no
	// nodejs_compat flag: Cloudflare may reject it as redundant after that date.
	compatibility: {
		date: "2026-10-01",
	},
	// Run next to Neon and Upstash (both AWS Singapore): every request makes
	// several database and Redis round trips, which stay inside one region.
	placement: { region: "aws:ap-southeast-1" },
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

/** Security headers on every website response (files and web-worker.ts). */
const WEB_SECURITY_HEADERS = {
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"X-Frame-Options": "DENY",
	"Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Website response headers in Cloudflare `_headers` syntax. Vite puts every
 * hashed bundle under /assets/, so those are cached for a year (a missing
 * one is a 404 from web-worker.ts, which these rules don't touch). The
 * unhashed icons are cached for a day.
 */
const WEB_HEADERS = [
	"/*",
	...Object.entries(WEB_SECURITY_HEADERS).map(
		([name, value]) => `  ${name}: ${value}`,
	),
	"",
	"/assets/*",
	"  Cache-Control: public, max-age=31536000, immutable",
	...[
		"/logo.png",
		"/favicon.ico",
		"/favicon-16.png",
		"/favicon-32.png",
		"/apple-touch-icon.png",
		"/icon-192.png",
		"/icon-512.png",
	].flatMap((path) => ["", path, "  Cache-Control: public, max-age=86400"]),
	"",
].join("\n");

export default Alchemy.Stack(
	"growtube",
	{
		providers: Cloudflare.providers(),
		state: Cloudflare.state(),
	},
	Effect.gen(function* () {
		const serverWorker = yield* server;

		// The website (apps/web) is a client-only Vite SPA: build it pointed at
		// the deployed server, then serve dist/ as an assets-only Worker.
		const webBuild = yield* Command.Build("web-build", {
			// `node <vite>` rather than `pnpm run build`: the command runs without
			// a shell, and pnpm is a .cmd shim on Windows.
			command: "node node_modules/vite/bin/vite.js build",
			cwd: "../../apps/web",
			outdir: "dist",
			env: {
				// Don't rely on the Alchemy CLI having set it: a development
				// NODE_ENV would ship React's dev build and the router devtools.
				NODE_ENV: "production",
				// The server URL the site talks to (sign-in, API). Process env
				// wins over apps/web/.env, which points at localhost.
				VITE_SERVER_URL: serverWorker.url,
				// `varlock/auto-load` above leaves this stack's resolved env in
				// __VARLOCK_ENV, and apps/web's varlock would reuse it and ignore
				// VITE_SERVER_URL (the site then talks to localhost). Blank it so
				// apps/web resolves its own .env.schema. Alchemy drops undefined
				// entries, so "" is the only way to clear a variable.
				__VARLOCK_ENV: "",
				// The same auto-load put the server's secrets in process.env; the
				// website build needs none of them.
				DATABASE_URL: "",
				REDIS_URL: "",
				BETTER_AUTH_SECRET: "",
				YOUTUBE_API_KEY: "",
				ALCHEMY_PASSWORD: "",
			},
			// Rebuild when the app, the workspace packages and tsconfigs it
			// compiles with or the lockfile change (by default only apps/web
			// itself is hashed).
			memo: {
				include: [
					"**/*",
					"../../packages/shared/src/**",
					"../../packages/shared/package.json",
					"../../packages/shared/tsconfig.json",
					"../../packages/ui/src/**",
					"../../packages/ui/package.json",
					"../../packages/ui/tsconfig.json",
					"../../packages/config/tsconfig.base.json",
				],
				lockfile: true,
			},
		});

		const web = yield* Cloudflare.Worker("web", {
			// https://growtube.<subdomain>.workers.dev: must match the server's
			// CORS_ORIGIN, or sign-in from the website is refused.
			name: "growtube",
			compatibility: {
				date: "2026-10-01",
			},
			// Runs only for requests that match no file and aren't a browser
			// navigation: 404 for missing files, index.html for page paths.
			main: "./web-worker.ts",
			env: {
				SECURITY_HEADERS: WEB_SECURITY_HEADERS,
			},
			// Cloudflare serves the files, and answers a browser opening an
			// unknown path (/privacy, /dashboard, ...) with index.html.
			assets: {
				directory: webBuild.outdir,
				// Always set while `memo` is on (it is undefined only with
				// memo: false); deploys skip the upload when it is unchanged.
				hash: webBuild.hash.output as Alchemy.Output<string, never>,
				notFoundHandling: "single-page-application",
				headers: WEB_HEADERS,
			},
		});

		return {
			server: serverWorker.url,
			web: web.url,
		};
	}),
);
