import { Button } from "@open-vidiq/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@open-vidiq/ui/components/card";
import { Input } from "@open-vidiq/ui/components/input";
import { Label } from "@open-vidiq/ui/components/label";
import { cn } from "@open-vidiq/ui/lib/utils";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	ArrowRight,
	Flame,
	KeyRound,
	LoaderCircle,
	LogOut,
	type LucideIcon,
	MonitorSmartphone,
	Search,
	ShieldCheck,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";

import { notifyAuthRequired } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { clearSessionCache } from "@/lib/session";

export const Route = createFileRoute("/_auth/dashboard")({
	head: () => ({ meta: [{ title: "Your account · open-vidiq" }] }),
	component: DashboardPage,
});

const memberSince = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });

function formatDate(value: Date | string | null | undefined): string {
	if (!value) return "—";
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? "—" : memberSince.format(date);
}

interface AuthErrorLike {
	status?: number;
	message?: string;
	statusText?: string;
}

/** Message for a better-auth client error; a 401 also refreshes the session state. */
function authErrorMessage(error: AuthErrorLike, fallback: string): string {
	if (error.status === 401) notifyAuthRequired();
	return error.message || error.statusText || fallback;
}

function DashboardPage() {
	const { session: initial } = Route.useRouteContext();
	const { data: live } = authClient.useSession();
	const user = (live ?? initial).user;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
			<header className="flex flex-col gap-2">
				<p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
					Account
				</p>
				<h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
					Hi, {user.name}
				</h1>
				<p className="text-muted-foreground text-sm">
					Everything in open-vidiq is free and unlimited. Your account just
					keeps the tools and the API to signed-in people.
				</p>
			</header>

			<ToolLinks />

			<Card>
				<CardHeader>
					<CardTitle className="text-sm">Account details</CardTitle>
					<CardDescription>
						This is all the personal information open-vidiq keeps about you.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-x-6 gap-y-3 text-xs sm:grid-cols-[auto_1fr]">
						<dt className="text-muted-foreground">Name</dt>
						<dd className="min-w-0 truncate font-medium">{user.name}</dd>
						<dt className="text-muted-foreground">Email</dt>
						<dd className="min-w-0 truncate font-medium">{user.email}</dd>
						<dt className="text-muted-foreground">Member since</dt>
						<dd className="font-medium">{formatDate(user.createdAt)}</dd>
					</dl>
				</CardContent>
			</Card>

			<SessionsCard />
			<StoredDataCard />
			<DeleteAccountCard />
		</div>
	);
}

const TOOLS: {
	to: "/trending" | "/lookup" | "/mcp";
	icon: LucideIcon;
	title: string;
	body: string;
}[] = [
	{
		to: "/trending",
		icon: Flame,
		title: "Trending",
		body: "The fastest-growing videos right now.",
	},
	{
		to: "/lookup",
		icon: Search,
		title: "Lookup",
		body: "Views over time for any video or channel.",
	},
	{
		to: "/mcp",
		icon: KeyRound,
		title: "MCP & API keys",
		body: "Connect an AI assistant with your own key.",
	},
];

function ToolLinks() {
	return (
		<nav aria-label="Tools">
			<ul className="bg-border ring-border grid gap-px overflow-hidden ring-1 sm:grid-cols-3">
				{TOOLS.map(({ to, icon: Icon, title, body }) => (
					<li key={to} className="flex">
						<Link
							to={to}
							className="group bg-background hover:bg-muted/40 focus-visible:ring-ring flex w-full flex-col gap-2 p-4 transition-colors outline-none focus-visible:ring-1 focus-visible:ring-inset"
						>
							<span className="flex items-center justify-between gap-2">
								<span className="flex items-center gap-2 text-sm font-medium">
									<Icon className="size-4" aria-hidden="true" />
									{title}
								</span>
								<ArrowRight
									className="text-muted-foreground size-3.5 transition-transform group-hover:translate-x-0.5"
									aria-hidden="true"
								/>
							</span>
							<span className="text-muted-foreground text-xs">{body}</span>
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}

function SessionsCard() {
	const navigate = useNavigate();
	const [busy, setBusy] = useState<"this" | "all" | null>(null);

	async function signOut() {
		setBusy("this");
		const { error } = await authClient.signOut();
		setBusy(null);
		if (error) {
			toast.error(authErrorMessage(error, "Couldn't sign out."));
			return;
		}
		clearSessionCache();
		toast.success("Signed out");
		await navigate({ to: "/" });
	}

	async function signOutEverywhere() {
		setBusy("all");
		const { error } = await authClient.revokeSessions();
		setBusy(null);
		if (error) {
			toast.error(authErrorMessage(error, "Couldn't sign out everywhere."));
			return;
		}
		clearSessionCache();
		toast.success("Signed out on all devices");
		await navigate({ to: "/login", search: { mode: "sign-in" } });
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-sm">
					<MonitorSmartphone className="size-4" aria-hidden="true" />
					Logins
				</CardTitle>
				<CardDescription>
					You stay signed in on each browser and in the extension until you sign
					out or the session expires.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-col gap-0.5 text-xs">
						<span className="font-medium">This browser</span>
						<span className="text-muted-foreground">
							Ends the session on this device only.
						</span>
					</div>
					<Button
						variant="outline"
						onClick={() => void signOut()}
						disabled={busy !== null}
						className="self-start sm:self-auto"
					>
						{busy === "this" ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<LogOut aria-hidden="true" />
						)}
						Sign out
					</Button>
				</div>
				<div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex flex-col gap-0.5 text-xs">
						<span className="font-medium">Every device</span>
						<span className="text-muted-foreground">
							Ends all your sessions, including this one and the extension. API
							keys keep working until you revoke them on the MCP page.
						</span>
					</div>
					<Button
						variant="outline"
						onClick={() => void signOutEverywhere()}
						disabled={busy !== null}
						className="shrink-0 self-start sm:self-auto"
					>
						{busy === "all" ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<LogOut aria-hidden="true" />
						)}
						Sign out on all devices
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

const STORED = [
	"Your name and email address.",
	"A hash of your password. The password itself is never stored.",
	"Your login sessions, without your IP address or browser user agent.",
	"API keys you create, stored hashed. Only the first few characters are kept in readable form so you can tell them apart.",
];

const NOT_STORED = [
	"Which account sent which crowdsourced upload. Stats from the extension are never linked to you.",
	"Unlisted or private videos. The extension never uploads them.",
	"Your AI provider key, prompts or AI Coach chats. They stay in your browser.",
];

function StoredDataCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-sm">
					<ShieldCheck className="size-4" aria-hidden="true" />
					What your account stores
				</CardTitle>
				<CardDescription>
					open-vidiq keeps the minimum it needs to sign you in.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-5 text-xs md:grid-cols-2">
				<div className="flex flex-col gap-2">
					<h3 className="font-medium">Stored</h3>
					<ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4">
						{STORED.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
				<div className="flex flex-col gap-2">
					<h3 className="font-medium">Never stored</h3>
					<ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-4">
						{NOT_STORED.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
			</CardContent>
		</Card>
	);
}

function DeleteAccountCard() {
	const navigate = useNavigate();
	const passwordId = useId();
	const errorId = useId();
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState(false);

	function close() {
		setOpen(false);
		setPassword("");
		setError(null);
	}

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!password || deleting) return;
		setDeleting(true);
		setError(null);
		const { data, error: deleteError } = await authClient.deleteUser({
			password,
		});
		setDeleting(false);
		if (deleteError) {
			setError(
				deleteError.status === 404
					? "Account deletion isn't available on this server."
					: authErrorMessage(deleteError, "Couldn't delete the account."),
			);
			return;
		}
		setPassword("");
		if (data?.message === "Verification email sent") {
			toast.success("Check your email to confirm the deletion.");
			close();
			return;
		}
		clearSessionCache();
		toast.success("Your account was deleted");
		await navigate({ to: "/" });
	}

	return (
		<Card className="ring-destructive/30">
			<CardHeader>
				<CardTitle className="text-destructive flex items-center gap-2 text-sm">
					<Trash2 className="size-4" aria-hidden="true" />
					Delete account
				</CardTitle>
				<CardDescription>
					Permanently deletes your account, all of your logins and all of your
					API keys. You'll be signed out everywhere, including the extension,
					and MCP clients using your keys stop working. This can't be undone.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3 text-xs">
				<p className="text-muted-foreground">
					Stats you shared through the extension were never linked to your
					account, so they stay in the public dataset and can't be traced back
					to you.
				</p>
				{open && (
					<form
						onSubmit={(event) => void onSubmit(event)}
						className="border-destructive/30 bg-destructive/5 flex flex-col gap-3 border p-3"
						noValidate
					>
						<p className="flex items-start gap-2 font-medium">
							<TriangleAlert
								className="text-destructive mt-0.5 size-4 shrink-0"
								aria-hidden="true"
							/>
							Enter your password to confirm.
						</p>
						<div className="flex flex-col gap-2">
							<Label htmlFor={passwordId}>Password</Label>
							<Input
								id={passwordId}
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => {
									setPassword(event.target.value);
									if (error) setError(null);
								}}
								aria-invalid={error ? true : undefined}
								aria-describedby={error ? errorId : undefined}
								autoFocus
							/>
							<p
								id={errorId}
								aria-live="polite"
								className={cn("text-destructive", !error && "sr-only")}
							>
								{error}
							</p>
						</div>
						<div className="flex flex-wrap gap-2">
							<Button
								type="submit"
								variant="destructive"
								disabled={!password || deleting}
							>
								{deleting ? (
									<LoaderCircle className="animate-spin" aria-hidden="true" />
								) : (
									<Trash2 aria-hidden="true" />
								)}
								Delete my account permanently
							</Button>
							<Button
								type="button"
								variant="ghost"
								onClick={close}
								disabled={deleting}
							>
								Cancel
							</Button>
						</div>
					</form>
				)}
			</CardContent>
			{!open && (
				<CardFooter>
					<Button variant="destructive" onClick={() => setOpen(true)}>
						<Trash2 aria-hidden="true" />
						Delete account…
					</Button>
				</CardFooter>
			)}
		</Card>
	);
}
