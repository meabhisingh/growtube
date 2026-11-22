import { authClient, type SessionData } from "./auth-client";

/**
 * Session lookup for route guards. `beforeLoad` runs on every navigation and
 * on hover preloads, so the answer is cached briefly instead of calling
 * /get-session each time. Sign-in, sign-out, revoke-sessions and delete-user
 * all flip better-auth's session signal, which drops the cache; callers that
 * navigate straight after one of those also call `clearSessionCache()`,
 * because better-auth flips the signal a few milliseconds after its own
 * onSuccess callbacks run.
 */

const SESSION_CACHE_MS = 30_000;

let cached: { value: SessionData | null; at: number } | null = null;
let inflight: Promise<SessionData | null> | null = null;
let generation = 0;

export function clearSessionCache() {
	cached = null;
	inflight = null;
	generation++;
}

authClient.$store.listen("$sessionSignal", () => clearSessionCache());
// better-auth's cross-tab broadcast and focus refetch update the session
// atom without the signal: a signed-out answer drops the cache too, so the
// next guard asks the server instead of trusting the last 30 s.
authClient.$store.atoms.session.listen((state) => {
	if (!state.isPending && !state.error && state.data == null)
		clearSessionCache();
});

/** The signed-in session, or null when signed out or the server is unreachable. */
export function loadSession(): Promise<SessionData | null> {
	if (cached && Date.now() - cached.at < SESSION_CACHE_MS) {
		return Promise.resolve(cached.value);
	}
	if (inflight) return inflight;
	const started = generation;
	const request = authClient
		.getSession()
		.then(({ data, error }) => {
			const value = data ?? null;
			// Don't cache network or server errors, and drop answers that a
			// sign-in or sign-out made stale while they were in flight.
			if (!error && started === generation) {
				cached = { value, at: Date.now() };
			}
			return value;
		})
		.catch(() => null)
		.finally(() => {
			if (inflight === request) inflight = null;
		});
	inflight = request;
	return request;
}

/**
 * Where to go after signing in. Only same-app paths are allowed, so a crafted
 * `?redirect=` link can't send someone to another site.
 */
export function safeRedirectTarget(
	value: unknown,
	fallback = "/dashboard",
): string {
	if (typeof value !== "string" || value.length > 2000) return fallback;
	if (!value.startsWith("/") || value.startsWith("//")) return fallback;
	if (value.startsWith("/\\")) return fallback;
	try {
		const base = "http://open-vidiq.invalid";
		const url = new URL(value, base);
		if (url.origin !== base) return fallback;
		if (url.pathname === "/login") return fallback;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return fallback;
	}
}
