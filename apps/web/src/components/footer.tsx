import { cn } from "@growtube/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { getServerHealth } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useApi } from "@/lib/use-api";

import { Logo } from "./logo";

function ServerStatus() {
	const { data: healthy, isPending } = useApi("health", getServerHealth, {
		staleMs: 60_000,
	});
	const label = isPending
		? "Checking server…"
		: healthy
			? "Stats server online"
			: "Stats server unreachable";
	return (
		<span className="inline-flex items-center gap-1.5" role="status">
			<span
				aria-hidden="true"
				className={cn(
					"size-1.5 rounded-full",
					isPending
						? "bg-muted-foreground"
						: healthy
							? "bg-emerald-500"
							: "bg-destructive",
				)}
			/>
			{label}
		</span>
	);
}

export default function Footer() {
	const { data: session } = authClient.useSession();
	return (
		<footer className="border-t">
			<div className="text-muted-foreground mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 text-xs md:flex-row md:items-start md:justify-between">
				<div className="flex max-w-sm flex-col gap-3">
					<Logo className="text-foreground" />
					<p>
						Free YouTube growth tools, with the source code on GitHub. No plans,
						no credits, no limits. Not affiliated with YouTube, Google or vidIQ.
					</p>
					<ServerStatus />
				</div>
				<nav
					aria-label="Footer"
					className="grid grid-cols-2 gap-x-10 gap-y-2 sm:grid-cols-3"
				>
					{session ? (
						<>
							<Link
								to="/trending"
								className="hover:text-foreground rounded-md transition-colors"
							>
								Trending
							</Link>
							<Link
								to="/lookup"
								className="hover:text-foreground rounded-md transition-colors"
							>
								Lookup
							</Link>
							<Link
								to="/mcp"
								className="hover:text-foreground rounded-md transition-colors"
							>
								MCP for AI assistants
							</Link>
							<Link
								to="/dashboard"
								className="hover:text-foreground rounded-md transition-colors"
							>
								Account
							</Link>
						</>
					) : (
						<>
							<Link
								to="/login"
								search={{ mode: "sign-in" }}
								className="hover:text-foreground rounded-md transition-colors"
							>
								Sign in
							</Link>
							<Link
								to="/login"
								search={{ mode: "sign-up" }}
								className="hover:text-foreground rounded-md transition-colors"
							>
								Create account
							</Link>
						</>
					)}
					<Link
						to="/"
						hash="features"
						className="hover:text-foreground rounded-md transition-colors"
					>
						Features
					</Link>
					<Link
						to="/"
						hash="install"
						className="hover:text-foreground rounded-md transition-colors"
					>
						Install
					</Link>
					<Link
						to="/privacy"
						className="hover:text-foreground rounded-md transition-colors"
					>
						Privacy
					</Link>
				</nav>
			</div>
		</footer>
	);
}
