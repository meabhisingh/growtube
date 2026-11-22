/**
 * Keeps the MV3 service worker alive while a long operation is pending.
 * BACKGROUND ONLY.
 *
 * Chrome stops an idle worker after 30 s, and also when a fetch() response
 * takes more than 30 s to arrive (slow image models, reasoning models). Any
 * extension API call resets those timers, so a trivial call every 20 s keeps
 * the worker running until the promise settles (Chrome's documented
 * `waitUntil` pattern). Outside an extension (Node scripts) it is a no-op.
 */
import { browser } from "wxt/browser";

const KEEPALIVE_MS = 20_000;

function ping(): void {
	try {
		const runtime = (
			browser as unknown as
				| { runtime?: { getPlatformInfo?: () => Promise<unknown> } }
				| undefined
		)?.runtime;
		void runtime?.getPlatformInfo?.().catch(() => {});
	} catch {
		// Not in an extension context.
	}
}

/** Resolves/rejects like `promise`, pinging the runtime every 20 s meanwhile. */
export async function keepAliveWhile<T>(promise: Promise<T>): Promise<T> {
	const timer = setInterval(ping, KEEPALIVE_MS);
	try {
		return await promise;
	} finally {
		clearInterval(timer);
	}
}
