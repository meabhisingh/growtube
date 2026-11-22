/**
 * The side panel toolkit: a left icon rail with every tool, the active tool
 * on the right. Tools stay mounted once visited, so switching tools keeps
 * their state (results, drafts, chats).
 *
 * The panel follows `currentContext` (storage.session): content scripts and
 * the popup set it to open a tool with a prefilled input. Each context is
 * consumed once (then cleared) by the panel of the window it came from.
 *
 * Signed out, the panel is only the sign-in / create-account screen: no tool
 * is mounted, so nothing is loaded. It switches live on sign-in/out.
 */
import { TooltipProvider } from "@growtube/ui/components/tooltip";
import { cn } from "@growtube/ui/lib/utils";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { Logo } from "@/components/common";
import { authUser } from "@/lib/auth";
import { account, ext } from "@/lib/client";
import { type CurrentContext, currentContext } from "@/lib/context";
import { useStorageItem } from "@/lib/hooks";

import { SignInScreen } from "../account/AuthForm";
import { useActiveTab, useLocalPref } from "../hooks";
import { IconButton, InfoTip } from "../ui/controls";
import { LoadingBlock } from "../ui/feedback";
import { Toasts } from "../ui/toast";
import {
	type IntentInput,
	PanelContext,
	resolveTool,
	TOOLS,
	type ToolId,
	type ToolIntent,
	toolDef,
} from "./nav";
import { AuditTool } from "./tools/audit/AuditTool";
import { ClipsTool } from "./tools/clips/ClipsTool";
import { CoachTool } from "./tools/coach/CoachTool";
import { CompetitorsTool } from "./tools/competitors/CompetitorsTool";
import { IdeasTool } from "./tools/ideas/IdeasTool";
import { KeywordsTool } from "./tools/keywords/KeywordsTool";
import { OptimizeTool } from "./tools/optimize/OptimizeTool";
import { ThumbnailsTool } from "./tools/thumbnails/ThumbnailsTool";
import { TrendsTool } from "./tools/trends/TrendsTool";

/** Contexts older than this are ignored (e.g. left over from a closed panel). */
const CONTEXT_MAX_AGE_MS = 5 * 60_000;

const RENDER: Record<
	ToolId,
	(props: { intent: ToolIntent | null; active: boolean }) => React.ReactNode
> = {
	coach: (p) => <CoachTool {...p} />,
	keywords: (p) => <KeywordsTool {...p} />,
	trending: (p) => <TrendsTool {...p} />,
	competitors: (p) => <CompetitorsTool {...p} />,
	ideas: (p) => <IdeasTool {...p} />,
	thumbnails: (p) => <ThumbnailsTool {...p} />,
	optimize: (p) => <OptimizeTool {...p} />,
	clips: (p) => <ClipsTool {...p} />,
	channel: (p) => <AuditTool {...p} />,
};

async function contextBelongsHere(ctx: CurrentContext): Promise<boolean> {
	if (ctx.tabId == null) return true;
	try {
		const [win, tab] = await Promise.all([
			browser.windows.getCurrent(),
			browser.tabs.get(ctx.tabId),
		]);
		return win.id == null || tab.windowId === win.id;
	} catch {
		// Tab closed: whoever is open may handle it.
		return true;
	}
}

function intentFromContext(ctx: CurrentContext): {
	tool: ToolId;
	input: IntentInput;
} | null {
	const tool =
		resolveTool(ctx.tool) ??
		(ctx.prefill || ctx.coach || ctx.videoId ? "coach" : null) ??
		(ctx.channelId ? "channel" : null);
	if (!tool) return null;
	return {
		tool,
		input: {
			prefill: ctx.prefill,
			autoSubmit: ctx.autoSubmit,
			videoId: ctx.videoId,
			channelId: ctx.channelId,
			coach: ctx.coach,
		},
	};
}

export function SidePanelApp() {
	const [user, , loading] = useStorageItem(authUser);
	if (loading) return <LoadingBlock className="h-screen" />;
	if (!user) {
		return (
			<TooltipProvider delay={300}>
				<div className="bg-background text-foreground flex min-h-screen w-full justify-center overflow-y-auto">
					<div className="w-full max-w-sm pt-6">
						<SignInScreen permission="request" />
					</div>
				</div>
			</TooltipProvider>
		);
	}
	return <Toolkit />;
}

function Toolkit() {
	const activeTab = useActiveTab();
	// A session ended elsewhere (signed out on all devices, account deleted
	// on the web) locks the panel as soon as it opens.
	useEffect(() => {
		void account.refresh().catch(() => null);
	}, []);
	const [savedTool, setSavedTool] = useLocalPref<string>(
		"sidepanel.tool",
		"coach",
	);
	const [tool, setTool] = useState<ToolId>(
		() => resolveTool(savedTool) ?? "coach",
	);
	const [visited, setVisited] = useState<ReadonlySet<ToolId>>(
		() => new Set([tool]),
	);
	const [intents, setIntents] = useState<Partial<Record<ToolId, ToolIntent>>>(
		{},
	);
	const seq = useRef(0);

	const navigate = useCallback(
		(next: ToolId, input?: IntentInput) => {
			setTool(next);
			setSavedTool(next);
			setVisited((v) => (v.has(next) ? v : new Set(v).add(next)));
			if (input) {
				const id = ++seq.current;
				setIntents((m) => ({ ...m, [next]: { ...input, id, tool: next } }));
			}
		},
		[setSavedTool],
	);

	// Follow the "current context" written by content scripts / the popup.
	const [ctx] = useStorageItem(currentContext);
	const handledAt = useRef(0);
	useEffect(() => {
		if (!ctx?.at || ctx.at <= handledAt.current) return;
		const at = ctx.at;
		handledAt.current = at;
		void (async () => {
			if (Date.now() - at > CONTEXT_MAX_AGE_MS) return;
			if (!(await contextBelongsHere(ctx))) return;
			const resolved = intentFromContext(ctx);
			if (resolved) navigate(resolved.tool, resolved.input);
			// Consume it so a re-opened panel doesn't replay it.
			const latest = await currentContext.getValue();
			if (latest?.at === at) await currentContext.setValue(null);
		})();
	}, [ctx, navigate]);

	const api = useMemo(() => ({ navigate, activeTab }), [navigate, activeTab]);
	const current = toolDef(tool);

	return (
		<PanelContext.Provider value={api}>
			<TooltipProvider delay={300}>
				<div className="bg-background text-foreground flex h-screen min-h-0 w-full overflow-hidden">
					<nav
						aria-label="Tools"
						className="bg-surface flex w-12 shrink-0 [scrollbar-width:none] flex-col items-center gap-1 overflow-x-hidden overflow-y-auto border-r py-2"
					>
						<div className="mb-1.5 flex size-8 items-center justify-center">
							<Logo size={24} />
						</div>
						{TOOLS.map((t) => (
							<IconButton
								key={t.id}
								label={t.label}
								icon={t.icon}
								side="right"
								size="icon"
								active={t.id === tool}
								onClick={() => navigate(t.id)}
								className={cn(
									"text-muted-foreground relative",
									t.id === tool &&
										"bg-brand-soft text-brand hover:bg-brand-soft hover:text-brand before:bg-brand before:absolute before:top-2 before:bottom-2 before:-left-2 before:w-[3px] before:rounded-r-full",
								)}
							/>
						))}
						<div className="flex-1" />
						<IconButton
							label="Settings"
							icon={Settings}
							side="right"
							size="icon"
							onClick={() => void ext.openOptions()}
							className="text-muted-foreground"
						/>
					</nav>
					<main className="flex min-w-0 flex-1 flex-col">
						<header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
							<current.icon className="text-brand size-4" aria-hidden />
							<h1 className="truncate text-sm font-semibold">
								{current.label}
							</h1>
							<InfoTip label={`About ${current.label}`} side="bottom">
								{current.description}
							</InfoTip>
							<div className="flex-1" />
							<span className="text-muted-foreground hidden text-[10px] tracking-wider uppercase min-[420px]:inline">
								Free · Unlimited
							</span>
						</header>
						<div className="relative min-h-0 flex-1">
							{TOOLS.map((t) =>
								visited.has(t.id) ? (
									<div
										key={t.id}
										hidden={t.id !== tool}
										className="absolute inset-0"
									>
										{RENDER[t.id]({
											intent: intents[t.id] ?? null,
											active: t.id === tool,
										})}
									</div>
								) : null,
							)}
						</div>
					</main>
				</div>
				<Toasts />
			</TooltipProvider>
		</PanelContext.Provider>
	);
}
