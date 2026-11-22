/**
 * Toolbar popup: status (AI provider, server), quick tool shortcuts that open
 * the side panel, feature toggles and a link to Settings. Signed out it is
 * only the sign-in / create-account screen.
 */
import { Button } from "@open-vidiq/ui/components/button";
import { TooltipProvider } from "@open-vidiq/ui/components/tooltip";
import { cn } from "@open-vidiq/ui/lib/utils";
import { CircleCheck, Heart, PanelRightOpen, Settings } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { browser } from "wxt/browser";

import { Logo } from "@/components/common";
import { authUser } from "@/lib/auth";
import { account } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { crowdsourceStats, features } from "@/lib/settings";
import { openSidePanelFromPage } from "@/lib/sidepanel";

import { SignInScreen } from "../account/AuthForm";
import { FEATURE_INFO } from "../features";
import { useActiveTab } from "../hooks";
import { TOOLS, type ToolId } from "../sidepanel/nav";
import { useAiStatus, useServerHealth } from "../status";
import { Switch } from "../ui/controls";
import { Spinner } from "../ui/feedback";

function openSettings(hash?: string) {
	const url = browser.runtime.getURL(
		`/options.html${hash ? `#${hash}` : ""}` as "/options.html",
	);
	void browser.tabs.create({ url }).then(() => window.close());
}

export function PopupApp() {
	const [user, , loading] = useStorageItem(authUser);
	if (loading) {
		return (
			<div className="bg-background flex h-40 w-[340px] items-center justify-center">
				<Spinner />
			</div>
		);
	}
	if (!user) {
		return (
			<TooltipProvider>
				<div className="bg-background text-foreground flex w-[340px] flex-col">
					{/* The popup closes when Chrome's permission prompt opens: ask in Settings. */}
					<SignInScreen
						permission="redirect"
						onOpenSettings={openSettings}
						compact
					/>
					<footer className="bg-surface text-muted-foreground flex items-center gap-1.5 border-t px-3.5 py-2.5 text-[11px]">
						<Heart className="text-brand size-3.5 shrink-0" aria-hidden />
						<span className="flex-1">
							Free and unlimited. No plans, no credits.
						</span>
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="Settings"
							title="Settings"
							onClick={() => openSettings()}
						>
							<Settings />
						</Button>
					</footer>
				</div>
			</TooltipProvider>
		);
	}
	return <SignedInPopup email={user.email} />;
}

function SignedInPopup({ email }: { email: string }) {
	const tab = useActiveTab();
	const ai = useAiStatus();
	const health = useServerHealth();
	const [flags, setFlags] = useStorageItem(features);
	const [crowdsource, setCrowdsource] = useStorageItem(crowdsourceStats);

	// A session ended elsewhere (signed out on all devices, account deleted
	// on the web) locks the popup as soon as it opens.
	useEffect(() => {
		void account.refresh().catch(() => null);
	}, []);

	const open = (tool?: ToolId) => {
		// Must run inside the click handler (user gesture for sidePanel.open).
		void openSidePanelFromPage(
			tool
				? {
						tool,
						tabId: tab.tabId ?? undefined,
					}
				: undefined,
			{ closePopup: true },
		).catch((error) => console.warn("[open-vidiq] side panel", error));
	};

	return (
		<TooltipProvider>
			<div className="bg-background text-foreground flex w-[340px] flex-col">
				<header className="flex items-center gap-2.5 border-b px-3.5 py-3">
					<Logo size={28} />
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="text-sm leading-tight font-semibold">
							open-vidiq
						</span>
						<span
							className="text-muted-foreground truncate text-[11px]"
							title={email}
						>
							{email}
						</span>
					</div>
					<Button
						size="icon-sm"
						variant="ghost"
						aria-label="Settings"
						title="Settings"
						onClick={() => openSettings()}
					>
						<Settings />
					</Button>
				</header>

				<div className="flex flex-col gap-3 p-3.5">
					<Button size="lg" className="w-full" onClick={() => open()}>
						<PanelRightOpen /> Open toolkit
					</Button>

					<div className="grid grid-cols-3 gap-1">
						{TOOLS.map((t) => (
							<button
								key={t.id}
								type="button"
								onClick={() => open(t.id)}
								title={t.description}
								className="bg-surface ring-foreground/8 hover:bg-brand-soft hover:text-brand focus-visible:ring-ring flex flex-col items-center gap-1 px-1 py-2 text-[10.5px] ring-1 transition-colors outline-none"
							>
								<t.icon className="size-4" aria-hidden />
								<span className="truncate">{t.label}</span>
							</button>
						))}
					</div>

					<div className="bg-surface ring-foreground/8 flex flex-col divide-y ring-1">
						<StatusRow
							label="AI provider"
							loading={ai.loading && !ai.data}
							ok={!!ai.data?.ready}
							value={
								!ai.data
									? "Checking…"
									: ai.data.ready
										? `${ai.data.providerLabel} · ${ai.data.model}`
										: (ai.data.problem ?? "Not set up")
							}
							action={
								ai.data && !ai.data.ready ? (
									<Button
										size="xs"
										variant="outline"
										onClick={() => openSettings("ai")}
									>
										Set up
									</Button>
								) : null
							}
						/>
						<StatusRow
							label="Server"
							loading={health.loading && !health.data}
							ok={!!health.data?.ok}
							value={
								health.data?.ok
									? "Connected"
									: health.data
										? "Unreachable: history & trending paused"
										: "Checking…"
							}
							action={
								health.data && !health.data.ok ? (
									<Button
										size="xs"
										variant="outline"
										onClick={() => openSettings("server")}
									>
										Fix
									</Button>
								) : null
							}
						/>
						<div className="flex items-center gap-2 px-3 py-2">
							<span className="flex-1 text-xs">
								Share public view counts
								<span className="text-muted-foreground block text-[10.5px]">
									Powers history and trending for everyone
								</span>
							</span>
							<Switch
								checked={crowdsource}
								onCheckedChange={(v) => void setCrowdsource(v)}
								ariaLabel="Share public view counts"
							/>
						</div>
					</div>

					<div className="flex flex-col">
						<span className="text-muted-foreground pb-1 text-[10px] font-semibold tracking-wider uppercase">
							On YouTube
						</span>
						{FEATURE_INFO.map((f) => (
							<div key={f.key} className="flex items-center gap-2.5 py-1.5">
								<f.icon
									className="text-muted-foreground size-3.5 shrink-0"
									aria-hidden
								/>
								<span className="flex-1 text-xs" title={f.description}>
									{f.title}
								</span>
								<Switch
									checked={flags[f.key]}
									onCheckedChange={(v) =>
										void setFlags((prev) => ({ ...prev, [f.key]: v }))
									}
									ariaLabel={f.title}
								/>
							</div>
						))}
					</div>
				</div>

				<footer className="bg-surface text-muted-foreground flex items-center gap-1.5 border-t px-3.5 py-2.5 text-[11px]">
					<Heart className="text-brand size-3.5 shrink-0" aria-hidden />
					Everything is free and unlimited. No plans, no credits.
				</footer>
			</div>
		</TooltipProvider>
	);
}

function StatusRow({
	label,
	value,
	ok,
	loading,
	action,
}: {
	label: string;
	value: string;
	ok: boolean;
	loading?: boolean;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center gap-2 px-3 py-2">
			{loading ? (
				<Spinner className="size-3.5" />
			) : ok ? (
				<CircleCheck
					className="size-3.5 shrink-0 text-emerald-500"
					aria-hidden
				/>
			) : (
				<span
					className="size-2 shrink-0 rounded-full bg-amber-500"
					aria-hidden
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col">
				<span className="text-xs">{label}</span>
				<span
					className={cn(
						"truncate text-[10.5px]",
						ok ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300",
					)}
					title={value}
				>
					{value}
				</span>
			</div>
			{action}
		</div>
	);
}
