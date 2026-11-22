import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { setAuthRequiredHandler } from "./lib/api";
import { authClient } from "./lib/auth-client";
import { clearSessionCache } from "./lib/session";
import { routeTree } from "./routeTree.gen";

// After a redeploy, a tab that was already open still asks for the old
// build's page chunks, which no longer exist. Reload once to pick up the new
// build; if loading still fails after that, let the error show instead of
// reloading in a loop.
const RELOADED_FOR_NEW_BUILD = "growtube:reloaded-for-new-build";
window.addEventListener("vite:preloadError", (event) => {
	try {
		if (sessionStorage.getItem(RELOADED_FOR_NEW_BUILD)) return;
		sessionStorage.setItem(RELOADED_FOR_NEW_BUILD, "1");
	} catch {
		return; // No sessionStorage: can't guard against a loop, don't reload.
	}
	event.preventDefault();
	window.location.reload();
});
window.addEventListener("load", () => {
	// This page load worked, so a later stale-chunk error may reload again.
	window.setTimeout(() => {
		try {
			sessionStorage.removeItem(RELOADED_FOR_NEW_BUILD);
		} catch {}
	}, 10_000);
});

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
	defaultPendingComponent: () => <Loader />,
	context: {},
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
	/**
	 * Optional context passed between pages (e.g. from a trending card) so the
	 * video/channel pages can show names the stats API doesn't return.
	 */
	interface HistoryState {
		videoTitle?: string;
		channelId?: string;
		channelTitle?: string;
	}
}

/** Route id of the layout that requires a signed-in user. */
const AUTH_LAYOUT_ID = "/_auth";
let lastAuthRedirect = 0;

// The server answered 401 AUTH_REQUIRED: the session expired or was revoked
// elsewhere. Refresh the session state (header, guards) and, on a page that
// needs an account, send the user to sign in and come back here afterwards.
setAuthRequiredHandler(() => {
	clearSessionCache();
	authClient.$store.notify("$sessionSignal");
	const { location, matches } = router.state;
	if (location.pathname === "/login") return;
	if (!matches.some((match) => match.routeId === AUTH_LAYOUT_ID)) return;
	// Several requests on one page can fail together; redirect once.
	if (Date.now() - lastAuthRedirect < 2_000) return;
	lastAuthRedirect = Date.now();
	void router.navigate({
		to: "/login",
		search: { redirect: location.href },
		replace: true,
	});
});

const rootElement = document.getElementById("app");

if (!rootElement) {
	throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(<RouterProvider router={router} />);
}
