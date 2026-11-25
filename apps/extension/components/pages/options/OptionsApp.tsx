/**
 * Options page (opens in a tab): account, AI provider, server & privacy, my
 * channel, features, appearance, data and about. Deep links:
 * options.html#account, #ai, #server, #channel, #alerts, #features, #appearance,
 * #data, #about. Signed out, only Account, Server & privacy (the server URL
 * must be settable before signing in) and Your data (erasing what this
 * browser keeps is a privacy control, e.g. after deleting the account) are
 * shown; the rest is locked.
 */
import { Button } from "@growtube/ui/components/button";
import { TooltipProvider } from "@growtube/ui/components/tooltip";
import { cn } from "@growtube/ui/lib/utils";
import {
	BellRing,
	Crown,
	Database,
	Info,
	Lock,
	Palette,
	PanelRightOpen,
	Server,
	SlidersHorizontal,
	Sparkles,
	UserRound,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Logo } from "@/components/common";
import { ACCOUNT_SECTION, authUser } from "@/lib/auth";
import { useStorageItem } from "@/lib/hooks";
import { onboardingDone } from "@/lib/settings";
import { openSidePanelFromPage } from "@/lib/sidepanel";

import { LoadingBlock, Notice } from "../ui/feedback";
import { Toasts } from "../ui/toast";
import { AccountSection } from "./AccountSection";
import { AiSection } from "./AiSection";
import { AlertsSection } from "./AlertsSection";
import {
	AboutSection,
	AppearanceSection,
	ChannelSection,
	DataSection,
	FeaturesSection,
} from "./OtherSections";
import { ServerSection } from "./ServerSection";

const NAV = [
	{ id: ACCOUNT_SECTION, label: "Account", icon: UserRound, open: true },
	{ id: "ai", label: "AI provider", icon: Sparkles, open: false },
	{ id: "server", label: "Server & privacy", icon: Server, open: true },
	{ id: "channel", label: "My channel", icon: Crown, open: false },
	{ id: "alerts", label: "Competitor alerts", icon: BellRing, open: false },
	{ id: "features", label: "Features", icon: SlidersHorizontal, open: false },
	{ id: "appearance", label: "Appearance", icon: Palette, open: false },
	{ id: "data", label: "Your data", icon: Database, open: true },
	{ id: "about", label: "About", icon: Info, open: false },
] as const;

function scrollToHash() {
	const id = window.location.hash.replace(/^#/, "");
	if (!id) return;
	requestAnimationFrame(() =>
		document
			.getElementById(id)
			?.scrollIntoView({ behavior: "smooth", block: "start" }),
	);
}

export function OptionsApp() {
	const [welcome, setWelcome] = useState(false);
	const [user, , authLoading] = useStorageItem(authUser);
	const signedIn = !!user;
	const nav = NAV.filter((n) => signedIn || n.open);
	const [activeId, setActiveId] = useState<string>(
		() => window.location.hash.replace(/^#/, "") || ACCOUNT_SECTION,
	);

	// First run: show the welcome card once, and don't auto-open this page again.
	useEffect(() => {
		void onboardingDone.getValue().then((done) => {
			if (!done) {
				setWelcome(true);
				void onboardingDone.setValue(true);
			}
		});
	}, []);

	// Deep links (#ai…) need the sections rendered before scrolling (and
	// signing in renders the rest of them).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll once sections change
	useEffect(() => {
		if (authLoading) return;
		const t = setTimeout(scrollToHash, 50);
		const onHash = () => {
			setActiveId(window.location.hash.replace(/^#/, "") || ACCOUNT_SECTION);
			scrollToHash();
		};
		window.addEventListener("hashchange", onHash);
		return () => {
			clearTimeout(t);
			window.removeEventListener("hashchange", onHash);
		};
	}, [authLoading, signedIn]);

	// Highlight the section in view (re-observed when sections appear/disappear).
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-run when sections change
	useEffect(() => {
		const obs = new IntersectionObserver(
			(entries) => {
				const visible = entries
					.filter((e) => e.isIntersecting)
					.sort(
						(a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
					)[0];
				if (visible?.target.id) setActiveId(visible.target.id);
			},
			{ rootMargin: "-20% 0px -60% 0px" },
		);
		for (const n of NAV) {
			const el = document.getElementById(n.id);
			if (el) obs.observe(el);
		}
		return () => obs.disconnect();
	}, [authLoading, signedIn]);

	return (
		<TooltipProvider>
			<div className="bg-background text-foreground min-h-screen">
				<header className="bg-background/90 sticky top-0 z-20 border-b backdrop-blur">
					<div className="mx-auto flex max-w-5xl items-center gap-3 px-5 py-3">
						<Logo size={30} />
						<div className="flex min-w-0 flex-1 flex-col">
							<span className="text-sm font-semibold">GrowTube settings</span>
							<span className="text-muted-foreground truncate text-[11px]">
								{user
									? `Free · no limits · ${user.email}`
									: "Free · no limits · free account required"}
							</span>
						</div>
						{signedIn ? (
							<Button
								variant="outline"
								onClick={() => void openSidePanelFromPage().catch(() => {})}
							>
								<PanelRightOpen /> Open toolkit
							</Button>
						) : null}
					</div>
				</header>

				<div className="mx-auto grid max-w-5xl gap-6 px-5 py-6 md:grid-cols-[190px_1fr]">
					<nav aria-label="Settings sections" className="hidden md:block">
						<ul className="sticky top-20 flex flex-col gap-0.5">
							{nav.map((n) => (
								<li key={n.id}>
									<a
										href={`#${n.id}`}
										className={cn(
											"focus-visible:ring-ring/50 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors duration-150 outline-none focus-visible:ring-2",
											activeId === n.id
												? "bg-brand-soft text-brand font-medium"
												: "text-muted-foreground hover:bg-muted hover:text-foreground",
										)}
									>
										<n.icon className="size-3.5" aria-hidden />
										{n.label}
									</a>
								</li>
							))}
						</ul>
					</nav>

					<main className="flex min-w-0 flex-col gap-5 [&>section]:scroll-mt-20">
						{welcome ? (
							<Notice
								tone="success"
								icon={Sparkles}
								title="Welcome to GrowTube!"
								actions={
									<Button
										size="xs"
										variant="ghost"
										onClick={() => setWelcome(false)}
									>
										<X /> Got it
									</Button>
								}
							>
								Four quick steps: 1) create a free account (or sign in) below,
								2) connect an AI provider (your own key, or free local Ollama),
								3) optionally set your channel, 4) open YouTube: badges, the
								watch panel and the toolkit (toolbar icon → Open toolkit) are
								ready. Everything is free and unlimited.
							</Notice>
						) : null}
						{authLoading ? (
							<LoadingBlock label="Loading settings…" />
						) : signedIn ? (
							<>
								<AccountSection />
								<AiSection />
								<ServerSection />
								<ChannelSection />
								<AlertsSection />
								<FeaturesSection />
								<AppearanceSection />
								<DataSection />
								<AboutSection />
							</>
						) : (
							<>
								<AccountSection />
								<ServerSection />
								<DataSection />
								<Notice tone="info" icon={Lock} title="Sign in to see the rest">
									AI provider, my channel, features and appearance settings
									unlock once you're signed in.
								</Notice>
							</>
						)}
					</main>
				</div>
				<Toasts />
			</div>
		</TooltipProvider>
	);
}
