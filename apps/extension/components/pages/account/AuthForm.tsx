/**
 * Sign in / create account, shared by the popup, the side panel and the
 * options page. Credentials go to the background (`auth.signIn` /
 * `auth.signUp`), which talks to the server; this page never sees the token.
 * Success shows up everywhere through the `authUser` storage item.
 */
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import {
	Eye,
	EyeOff,
	LoaderCircle,
	LogIn,
	Settings,
	UserPlus,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { Logo } from "@/components/common";
import {
	ACCOUNT_SECTION,
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	normalizeServerUrl,
} from "@/lib/auth";
import { account, BackgroundError, ext } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	ensureOriginPermission,
	hasOriginPermission,
	originOf,
} from "@/lib/permissions";
import { serverUrl } from "@/lib/settings";

import { Field, Segmented } from "../ui/controls";
import { ErrorNotice, Notice } from "../ui/feedback";

export type AuthMode = "signIn" | "signUp";

/** Where a missing host permission is asked for. */
type PermissionMode =
	/** Ask right here (options page, side panel) */
	| "request"
	/** Send the user to Settings: the popup closes when Chrome's prompt opens */
	| "redirect";

export function AuthForm({
	permission = "request",
	initialMode = "signIn",
	onOpenSettings = (hash) => void ext.openOptions(hash).catch(() => {}),
	autoFocus,
}: {
	permission?: PermissionMode;
	initialMode?: AuthMode;
	/** Opens Settings at a section ("server", "account") */
	onOpenSettings?: (hash: string) => void;
	autoFocus?: boolean;
}) {
	const id = useId();
	const [mode, setMode] = useState<AuthMode>(initialMode);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<unknown>(null);
	const [needsPermission, setNeedsPermission] = useState<string | null>(null);
	const [server] = useStorageItem(serverUrl);
	const base = normalizeServerUrl(server);
	const signUp = mode === "signUp";

	const switchMode = (next: AuthMode) => {
		setMode(next);
		setError(null);
		setNeedsPermission(null);
	};

	const onSubmit = async (e: FormEvent) => {
		e.preventDefault();
		if (busy) return;
		setError(null);
		setNeedsPermission(null);
		setBusy(true);
		try {
			// A custom server URL needs a host permission. Asked inside this
			// submit (user gesture); the default server's is in the manifest.
			if (!(await hasOriginPermission(base))) {
				if (permission === "redirect") {
					setNeedsPermission(originOf(base) ?? base);
					return;
				}
				if (!(await ensureOriginPermission(base))) {
					setError(
						`Chrome didn't grant access to ${originOf(base) ?? base}. open-vidiq needs it to reach its server (Settings → Server URL).`,
					);
					return;
				}
			}
			if (signUp) await account.signUp(name, email, password);
			else await account.signIn(email, password);
			setPassword("");
		} catch (err) {
			setError(err);
		} finally {
			setBusy(false);
		}
	};

	const code = error instanceof BackgroundError ? error.code : null;
	const canSubmit =
		!busy &&
		email.trim().length > 0 &&
		password.length > 0 &&
		(!signUp || name.trim().length > 0);

	return (
		<form className="flex flex-col gap-3" onSubmit={(e) => void onSubmit(e)}>
			<Segmented<AuthMode>
				value={mode}
				onChange={switchMode}
				options={[
					{ value: "signIn", label: "Sign in", icon: LogIn },
					{ value: "signUp", label: "Create account", icon: UserPlus },
				]}
				className="self-start"
				ariaLabel="Sign in or create an account"
			/>
			{signUp ? (
				<Field label="Name" htmlFor={`${id}-name`}>
					<Input
						id={`${id}-name`}
						value={name}
						onChange={(e) => setName(e.target.value)}
						autoComplete="name"
						maxLength={100}
						required
						autoFocus={autoFocus}
					/>
				</Field>
			) : null}
			<Field label="Email" htmlFor={`${id}-email`}>
				<Input
					id={`${id}-email`}
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					autoComplete="email"
					spellCheck={false}
					required
					autoFocus={autoFocus && !signUp}
				/>
			</Field>
			<Field
				label="Password"
				htmlFor={`${id}-password`}
				hint={
					signUp ? `At least ${MIN_PASSWORD_LENGTH} characters.` : undefined
				}
			>
				<div className="relative">
					<Input
						id={`${id}-password`}
						type={showPassword ? "text" : "password"}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete={signUp ? "new-password" : "current-password"}
						minLength={signUp ? MIN_PASSWORD_LENGTH : undefined}
						maxLength={MAX_PASSWORD_LENGTH}
						required
						className="pr-8"
					/>
					<button
						type="button"
						onClick={() => setShowPassword((s) => !s)}
						aria-label={showPassword ? "Hide password" : "Show password"}
						className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
					>
						{showPassword ? (
							<EyeOff className="size-3.5" />
						) : (
							<Eye className="size-3.5" />
						)}
					</button>
				</div>
			</Field>

			{needsPermission ? (
				<Notice
					tone="warning"
					title="Permission needed"
					actions={
						<Button
							size="xs"
							variant="outline"
							type="button"
							onClick={() => onOpenSettings(ACCOUNT_SECTION)}
						>
							<Settings /> Open settings
						</Button>
					}
				>
					open-vidiq needs access to {needsPermission} to sign you in. Sign in
					from the settings page to grant it.
				</Notice>
			) : null}
			{code === "EMAIL_TAKEN" ? (
				<Notice
					tone="warning"
					title="You already have an account"
					actions={
						<Button
							size="xs"
							variant="outline"
							type="button"
							onClick={() => switchMode("signIn")}
						>
							<LogIn /> Sign in instead
						</Button>
					}
				>
					{error instanceof Error ? error.message : null}
				</Notice>
			) : error ? (
				<ErrorNotice
					error={error}
					title={
						signUp ? "Couldn't create your account" : "Couldn't sign you in"
					}
				/>
			) : null}

			<Button type="submit" disabled={!canSubmit} className="w-full">
				{busy ? (
					<LoaderCircle className="animate-spin" />
				) : signUp ? (
					<UserPlus />
				) : (
					<LogIn />
				)}
				{signUp ? "Create free account" : "Sign in"}
			</Button>

			<p className="text-muted-foreground text-[11px] leading-relaxed">
				{signUp ? "Already have an account? " : "New here? "}
				<button
					type="button"
					className="text-brand font-medium hover:underline"
					onClick={() => switchMode(signUp ? "signIn" : "signUp")}
				>
					{signUp ? "Sign in" : "Create a free account"}
				</button>
				. Account on{" "}
				<span className="text-foreground font-medium">
					{originOf(base) ?? base}
				</span>{" "}
				(
				<button
					type="button"
					className="hover:text-foreground underline underline-offset-2"
					onClick={() => onOpenSettings("server")}
				>
					change server
				</button>
				).
			</p>
		</form>
	);
}

/**
 * Whole-surface sign-in screen for the popup and the side panel (nothing
 * else of the extension renders while signed out).
 */
export function SignInScreen({
	permission,
	onOpenSettings,
	compact,
}: {
	permission?: PermissionMode;
	onOpenSettings?: (hash: string) => void;
	compact?: boolean;
}) {
	return (
		<div className="flex flex-col gap-4 p-4">
			<div className="flex items-center gap-2.5">
				<Logo size={compact ? 28 : 32} />
				<div className="flex min-w-0 flex-col">
					<span className="text-sm leading-tight font-semibold">
						Sign in to open-vidiq
					</span>
					<span className="text-muted-foreground text-[11px]">
						A free account is required. No plans, no credits, no limits.
					</span>
				</div>
			</div>
			<AuthForm
				permission={permission}
				onOpenSettings={onOpenSettings}
				autoFocus
			/>
		</div>
	);
}
