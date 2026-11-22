/**
 * The website Worker's script (see `web` in alchemy.run.ts). Cloudflare runs
 * it only for requests that match no file in apps/web/dist:
 *
 * - Every existing file is served by the asset layer without running this.
 * - With SPA not-found handling, a browser navigating to a page path
 *   (/privacy, /dashboard, ...) gets index.html from the asset layer too.
 *
 * What is left lands here:
 * - Missing files, e.g. a JS chunk from an older deploy that an open tab
 *   still asks for: a real 404 that is never cached, instead of index.html
 *   under the chunk URL. The app then reloads itself (apps/web/src/main.tsx).
 * - Page paths fetched without browser navigation headers (link previews,
 *   crawlers, curl): index.html, so they still get the app.
 */

type Env = {
	ASSETS: Fetcher;
	/** Header name -> value, added to every response this script makes. */
	SECURITY_HEADERS: Record<string, string>;
};

/** Paths that name a file rather than a page. */
const FILE_PATH =
	/^\/assets\/|\.(?:js|mjs|css|map|json|webmanifest|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|woff2?)$/i;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		if (FILE_PATH.test(url.pathname)) {
			return new Response("Not found", {
				status: 404,
				headers: {
					...env.SECURITY_HEADERS,
					"Cache-Control": "no-store",
					"Content-Type": "text/plain; charset=utf-8",
				},
			});
		}
		const page = await env.ASSETS.fetch(
			new Request(new URL("/", url), request),
		);
		const response = new Response(page.body, page);
		for (const [name, value] of Object.entries(env.SECURITY_HEADERS)) {
			response.headers.set(name, value);
		}
		return response;
	},
};
