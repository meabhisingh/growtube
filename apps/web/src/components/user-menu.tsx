import { Button, buttonVariants } from "@growtube/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@growtube/ui/components/dropdown-menu";
import { Skeleton } from "@growtube/ui/components/skeleton";
import { cn } from "@growtube/ui/lib/utils";
import { Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, LayoutDashboard, LogOut } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { clearSessionCache } from "@/lib/session";

export default function UserMenu() {
	const navigate = useNavigate();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-8 w-20 rounded-xl" />;
	}

	if (!session) {
		return (
			<div className="flex items-center gap-2">
				<Link
					to="/login"
					search={{ mode: "sign-in" }}
					className={buttonVariants({ variant: "outline" })}
				>
					Sign in
				</Link>
				<Link
					to="/login"
					search={{ mode: "sign-up" }}
					className={cn(
						buttonVariants({ variant: "default" }),
						"hidden sm:inline-flex",
					)}
				>
					Create account
				</Link>
			</div>
		);
	}

	async function signOut() {
		const { error } = await authClient.signOut();
		if (error) {
			toast.error(error.message || "Couldn't sign out. Try again.");
			return;
		}
		clearSessionCache();
		await navigate({ to: "/" });
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button variant="outline" className="max-w-40" />}
			>
				<span className="truncate">{session.user.name}</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="bg-card min-w-48" align="end">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex flex-col gap-0.5">
						<span className="text-foreground truncate font-medium">
							{session.user.name}
						</span>
						<span className="truncate">{session.user.email}</span>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => navigate({ to: "/dashboard" })}>
						<LayoutDashboard aria-hidden="true" />
						Dashboard
					</DropdownMenuItem>
					<DropdownMenuItem onClick={() => navigate({ to: "/mcp" })}>
						<KeyRound aria-hidden="true" />
						API keys
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => void signOut()}
					>
						<LogOut aria-hidden="true" />
						Sign out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
