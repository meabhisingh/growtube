import {
	createFileRoute,
	Outlet,
	redirect,
	useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { clearSessionCache, loadSession } from "@/lib/session";

/**
 * Pathless layout for every page that needs an account: the tools (trending,
 * lookup, video, channel, MCP) and the dashboard. Signed-out visitors go to
 * /login and come back to the page they asked for.
 */
export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async ({ location }) => {
		const session = await loadSession();
		if (!session) {
			throw redirect({
				to: "/login",
				search: { redirect: location.href },
			});
		}
		return { session };
	},
});

/**
 * The guard above only runs on navigation. The session can also end while a
 * page is open: sign-out or account deletion in another tab, or a revoke
 * noticed by better-auth's focus refetch. Then the page is hidden at once
 * and the guard runs again, which sends the visitor to /login (and back
 * here after signing in). Only session updates after this layout mounted
 * count: right after a sign-in the session atom can still hold the
 * signed-out answer it fetched before. A failed lookup (network, 5xx) is not
 * a sign-out.
 */
function AuthLayout() {
	const router = useRouter();
	const [signedOut, setSignedOut] = useState(false);
	useEffect(
		() =>
			authClient.$store.atoms.session.listen((state) => {
				const ended =
					!state.isPending &&
					!state.isRefetching &&
					!state.error &&
					state.data == null;
				setSignedOut(ended);
				if (!ended) return;
				clearSessionCache();
				// Re-runs the guard for whatever page is current (a sign-out
				// button may already be navigating elsewhere).
				void router.invalidate();
			}),
		[router],
	);
	if (signedOut) return null;
	return <Outlet />;
}
