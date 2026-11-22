import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { z } from "zod";

import SignInForm from "@/components/sign-in-form";
import SignUpForm from "@/components/sign-up-form";
import { loadSession, safeRedirectTarget } from "@/lib/session";

const loginSearchSchema = z.object({
	/** Page to return to after signing in (a same-app path). */
	redirect: z.string().max(2000).optional().catch(undefined),
	mode: z.enum(["sign-in", "sign-up"]).optional().catch(undefined),
});

export const Route = createFileRoute("/login")({
	validateSearch: loginSearchSchema,
	beforeLoad: async ({ search }) => {
		// Already signed in: skip the form.
		if (await loadSession()) {
			throw redirect({ href: safeRedirectTarget(search.redirect) });
		}
	},
	head: () => ({ meta: [{ title: "Sign in · GrowTube" }] }),
	component: LoginPage,
});

function LoginPage() {
	const { redirect: redirectParam, mode = "sign-in" } = Route.useSearch();
	const navigate = Route.useNavigate();
	const redirectTo = safeRedirectTarget(redirectParam);
	const setMode = (next: "sign-in" | "sign-up") =>
		navigate({
			search: (prev) => ({ ...prev, mode: next }),
			replace: true,
		});

	return (
		<div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10 md:py-16">
			{redirectParam && (
				<p
					role="status"
					className="bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-xs"
				>
					<Lock className="size-3.5 shrink-0" aria-hidden="true" />
					Sign in or create a free account to use the GrowTube tools.
				</p>
			)}

			<div className="bg-card text-card-foreground ring-foreground/8 rounded-xl p-6 shadow-sm ring-1 sm:p-8">
				{mode === "sign-up" ? (
					<SignUpForm
						redirectTo={redirectTo}
						onSwitchToSignIn={() => setMode("sign-in")}
					/>
				) : (
					<SignInForm
						redirectTo={redirectTo}
						onSwitchToSignUp={() => setMode("sign-up")}
					/>
				)}
			</div>

			<AccountNotice />
		</div>
	);
}

/** What an account means here, in plain terms. */
function AccountNotice() {
	return (
		<section
			aria-labelledby="account-notice-heading"
			className="text-muted-foreground flex flex-col gap-2 border-t pt-5 text-xs leading-relaxed"
		>
			<h2
				id="account-notice-heading"
				className="text-foreground text-xs font-medium"
			>
				Why an account?
			</h2>
			<p>
				GrowTube is free with no plans or limits, but the extension, the web
				tools and the API only work after you sign in.
			</p>
			<ul className="flex list-disc flex-col gap-1 pl-4">
				<li>
					We store your name, your email and a hash of your password (never the
					password itself).
				</li>
				<li>
					Logins are kept as sessions without your IP address or browser user
					agent.
				</li>
				<li>
					Stats the extension shares are never linked to your account, and
					unlisted or private videos are never uploaded.
				</li>
			</ul>
			<p>
				You can sign out everywhere or delete your account from the dashboard.{" "}
				<Link
					to="/privacy"
					className="hover:text-foreground underline underline-offset-4"
				>
					Privacy policy
				</Link>
			</p>
		</section>
	);
}
