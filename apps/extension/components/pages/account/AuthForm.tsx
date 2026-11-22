/**
 * Sign in / create account, shared by the popup, the side panel and the
 * options page. Credentials go to the background (`auth.signIn` /
 * `auth.signUp`), which talks to the server; this page never sees the token.
 * Success shows up everywhere through the `authUser` storage item.
 *
 * It also carries the data notice the Chrome Web Store asks for before any
 * collection starts (nothing reaches the server while signed out), and the
 * opt-in "Share public stats" checkbox (off unless the user ticks it). Keep
 * its wording in line with ServerSection and the web app's /privacy page.
 */
import { Button } from "@growtube/ui/components/button";
import { Checkbox } from "@growtube/ui/components/checkbox";
import { Input } from "@growtube/ui/components/input";
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
	privacyPolicyUrl,
} from "@/lib/auth";
import { account, BackgroundError, ext } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	ensureOriginPermission,
	hasOriginPermission,
	originOf,
} from "@/lib/permissions";
import { crowdsourceStats, serverUrl } from "@/lib/settings";

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
						`Chrome didn't grant access to ${originOf(base) ?? base}. GrowTube needs it to reach its server (Settings → Server URL).`,
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
						className="text-muted-foreground hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/50 absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-0.5 transition-colors duration-150 outline-none focus-visible:ring-2"
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
					GrowTube needs access to {needsPermission} to sign you in. Sign in
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

			<DataNotice base={base} onOpenSettings={onOpenSettings} />

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
					className="text-brand focus-visible:ring-ring/50 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2"
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
					className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2"
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
 * What signing in starts sending, and the opt-in for uploads. The checkbox
 * writes the setting right away; uploads also need a session, so nothing is
 * sent before the user signs in.
 */
function DataNotice({
	base,
	onOpenSettings,
}: {
	base: string;
	onOpenSettings: (hash: string) => void;
}) {
	const shareId = useId();
	const [share, setShare] = useStorageItem(crowdsourceStats);
	const policy = privacyPolicyUrl(base);
	const link =
		"text-foreground focus-visible:ring-ring/50 rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2";
	return (
		<div className="bg-surface-2 text-muted-foreground flex flex-col gap-2 rounded-lg p-2.5 text-[11px] leading-relaxed">
			<p>
				<span className="text-foreground font-medium">
					What GrowTube sends.
				</span>{" "}
				To show their stats, GrowTube sends the IDs of the public YouTube videos
				and channels you view, and your Trends searches, to the GrowTube server
				with your login. Nothing from unlisted or private videos.
			</p>
			<label
				htmlFor={shareId}
				className="flex cursor-pointer items-start gap-2"
			>
				<Checkbox
					id={shareId}
					checked={share}
					onCheckedChange={(v) => void setShare(!!v)}
					className="mt-0.5"
				/>
				<span>
					<span className="text-foreground font-medium">
						Share public stats
					</span>{" "}
					(optional): also upload their public numbers (video title, channel
					name, views, likes, comments, channel avatar URL, country, keywords)
					with no account ID, to build view history and Trends for everyone.
				</span>
			</label>
			<p>
				{policy ? (
					<>
						<a href={policy} target="_blank" rel="noreferrer" className={link}>
							Privacy policy
						</a>
						{" · "}
					</>
				) : null}
				<button
					type="button"
					className={link}
					onClick={() => onOpenSettings("server")}
				>
					What the server stores
				</button>
			</p>
		</div>
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
						Sign in to GrowTube
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
