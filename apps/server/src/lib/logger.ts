import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";

/**
 * The route pattern a request matched, e.g. "/v1/videos/:id/history" (the
 * last matching route, i.e. the handler), never the raw path.
 */
export function matchedRoute(c: Parameters<typeof routePath>[0]): string {
	return routePath(c, -1) || "(unmatched)";
}

/**
 * Access log: method, matched route pattern, status and duration. No raw
 * paths or path params, no query strings, no headers, no IPs.
 */
export const requestLogger: MiddlewareHandler = async (c, next) => {
	const started = Date.now();
	await next();
	console.log(
		`${c.req.method} ${matchedRoute(c)} ${c.res.status} ${Date.now() - started}ms`,
	);
};
