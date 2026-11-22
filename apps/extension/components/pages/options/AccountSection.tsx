/**
 * Options → Account. Signed out: sign in / create account. Signed in: who,
 * sign out, a link to the web app's MCP page for API keys, and account deletion.
 */
import { Button, buttonVariants } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import {
	ExternalLink,
	KeyRound,
	LoaderCircle,
	LogOut,
	Trash2,
	UserRound,
} from "lucide-react";
import { useEffect, useId, useState } from "react";

import {
	ACCOUNT_SECTION,
	authUser,
	type SignedInUser,
	WEB_API_KEYS_PATH,
	webAppUrl,
} from "@/lib/auth";
import { account } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { originOf } from "@/lib/permissions";

import { AuthForm } from "../account/AuthForm";
import { Field } from "../ui/controls";
import { ErrorNotice, LoadingBlock, Notice } from "../ui/feedback";
import { Section } from "../ui/layout";
import { toast } from "../ui/toast";

/** Scrolls this page to another section (the form's "change server" link). */
function goToSection(hash: string) {
	if (window.location.hash === `#${hash}`) {
		document
			.getElementById(hash)
			?.scrollIntoView({ behavior: "smooth", block: "start" });
	} else {
		window.location.hash = hash;
	}
}

export function AccountSection() {
	const [user, , loading] = useStorageItem(authUser);
	return (
		<Section
			id={ACCOUNT_SECTION}
			title="Account"
			icon={UserRound}
			description={
				user
					? "You're signed in. Every open-vidiq feature is free and unlimited."
					: "open-vidiq needs a free account: sign in or create one to use the toolkit, the YouTube and Studio panels and the server data. No plans, no credits, no limits."
			}
		>
			{loading ? (
				<LoadingBlock label="Checking your account…" />
			) : user ? (
				<SignedIn user={user} />
			) : (
				<div className="max-w-sm">
					<AuthForm permission="request" onOpenSettings={goToSection} />
				</div>
			)}
		</Section>
	);
}

function SignedIn({ user }: { user: SignedInUser }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const web = webAppUrl(user.serverUrl);

	// Picks up a renamed account or a session ended elsewhere.
	useEffect(() => {
		void account.refresh().catch(() => null);
	}, []);

	const signOut = async () => {
		setBusy(true);
		setError(null);
		try {
			await account.signOut();
			toast("Signed out", { tone: "success" });
		} catch (e) {
			setError(e);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-col gap-3">
			<div className="bg-surface-2 flex flex-wrap items-center gap-3 p-2.5">
				<div className="bg-brand-soft text-brand flex size-9 shrink-0 items-center justify-center text-sm font-semibold uppercase">
					{(user.name || user.email).slice(0, 1)}
				</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<span className="truncate text-xs font-medium">
						{user.name || user.email}
					</span>
					<span className="text-muted-foreground truncate text-[11px]">
						{user.email} · {originOf(user.serverUrl) ?? user.serverUrl}
					</span>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void signOut()}
					disabled={busy}
				>
					{busy ? <LoaderCircle className="animate-spin" /> : <LogOut />}
					Sign out
				</Button>
			</div>
			{error ? <ErrorNotice error={error} title="Couldn't sign out" /> : null}

			{web ? (
				<div className="flex flex-wrap items-center gap-2 text-[11px]">
					<KeyRound
						className="text-muted-foreground size-3.5 shrink-0"
						aria-hidden
					/>
					<span className="text-muted-foreground flex-1">
						API keys for MCP clients (AI assistants that use open-vidiq's data)
						are created on the web app's MCP page.
					</span>
					<a
						href={`${web}${WEB_API_KEYS_PATH}`}
						target="_blank"
						rel="noopener noreferrer"
						className={buttonVariants({ variant: "outline", size: "xs" })}
					>
						<ExternalLink /> Manage API keys
					</a>
				</div>
			) : null}

			<DeleteAccount user={user} />
		</div>
	);
}

function DeleteAccount({ user }: { user: SignedInUser }) {
	const id = useId();
	const [open, setOpen] = useState(false);
	const [password, setPassword] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [emailSent, setEmailSent] = useState(false);
	const server = originOf(user.serverUrl) ?? user.serverUrl;

	const cancel = () => {
		setOpen(false);
		setPassword("");
		setError(null);
	};

	const onDelete = async () => {
		setBusy(true);
		setError(null);
		try {
			const res = await account.deleteAccount(password);
			setPassword("");
			if (res.emailConfirmation) {
				setEmailSent(true);
				setOpen(false);
			} else {
				toast("Your account was deleted", { tone: "success" });
			}
		} catch (e) {
			setError(e);
		} finally {
			setBusy(false);
		}
	};

	if (emailSent) {
		return (
			<Notice tone="info" title="Check your email">
				The server sent a confirmation link to {user.email}. Your account is
				deleted once you open it.
			</Notice>
		);
	}

	return (
		<div className="flex flex-col gap-2 border-t border-red-500/30 pt-3">
			{open ? (
				<Notice
					tone="error"
					title="Delete your open-vidiq account?"
					actions={
						<>
							<Button
								variant="destructive"
								size="sm"
								onClick={() => void onDelete()}
								disabled={busy || !password}
							>
								{busy ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
								Delete my account
							</Button>
							<Button
								size="sm"
								variant="ghost"
								onClick={cancel}
								disabled={busy}
							>
								Cancel
							</Button>
						</>
					}
				>
					<div className="flex flex-col gap-2">
						<p>
							This permanently deletes, on {server}: your account (name, email
							and password hash), every login of it (in this and any other
							browser) and its API keys. It can't be undone.
						</p>
						<p>
							Crowdsourced stats were never linked to your account, so there is
							nothing of yours left in them. Settings, AI key, chats and ideas
							live in this browser and are not touched: use Your data → Reset
							all data for those.
						</p>
						<Field label="Your password" htmlFor={`${id}-password`}>
							<Input
								id={`${id}-password`}
								type="password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && password && !busy) void onDelete();
								}}
								autoComplete="current-password"
								className="max-w-xs"
							/>
						</Field>
					</div>
				</Notice>
			) : (
				<Button
					variant="destructive"
					className="self-start"
					onClick={() => setOpen(true)}
				>
					<Trash2 /> Delete account
				</Button>
			)}
			{error ? (
				<ErrorNotice error={error} title="Couldn't delete your account" />
			) : null}
		</div>
	);
}
