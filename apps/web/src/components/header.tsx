import { Button } from "@growtube/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@growtube/ui/components/dropdown-menu";
import { Link, useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";

import { authClient } from "@/lib/auth-client";

import { Logo } from "./logo";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

/** Tool pages: shown only to signed-in users, since they all need an account. */
const toolLinks = [
	{ to: "/", label: "Home", exact: true },
	{ to: "/trending", label: "Trending", exact: false },
	{ to: "/lookup", label: "Lookup", exact: false },
	{ to: "/mcp", label: "MCP", exact: false },
	{ to: "/dashboard", label: "Dashboard", exact: false },
] as const;

export default function Header() {
	const navigate = useNavigate();
	const { data: session } = authClient.useSession();
	const links = session ? toolLinks : [];

	return (
		<header className="bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky top-0 z-40 border-b backdrop-blur">
			<div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
				<div className="flex min-w-0 items-center gap-6">
					<Link
						to="/"
						className="focus-visible:ring-ring/50 -m-1 shrink-0 rounded-lg p-1 outline-none focus-visible:ring-2"
						aria-label="GrowTube home"
					>
						<Logo />
					</Link>
					{links.length > 0 && (
						<nav
							aria-label="Main"
							className="hidden items-center gap-1 md:flex"
						>
							{links.map(({ to, label, exact }) => (
								<Link
									key={to}
									to={to}
									activeOptions={{ exact }}
									className="text-muted-foreground hover:text-foreground hover:bg-muted/70 focus-visible:ring-ring/50 data-[status=active]:bg-muted data-[status=active]:text-foreground rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 outline-none focus-visible:ring-2"
								>
									{label}
								</Link>
							))}
						</nav>
					)}
				</div>

				<div className="flex items-center gap-2">
					{links.length > 0 && (
						<div className="md:hidden">
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="outline"
											size="icon"
											aria-label="Open navigation"
										/>
									}
								>
									<Menu aria-hidden="true" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="min-w-40">
									{links.map(({ to, label }) => (
										<DropdownMenuItem key={to} onClick={() => navigate({ to })}>
											{label}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					)}
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
