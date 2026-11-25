/**
 * Side panel tools, the intents that open them and the panel-wide context
 * (navigation + active tab) every tool can use.
 *
 * Tool ids accepted in `CurrentContext.tool` (from content scripts via
 * `ext.openSidePanel({ tool, prefill, videoId, channelId, coach, autoSubmit })`):
 *   coach, keywords, trending, competitors, ideas, thumbnails, optimize,
 *   clips, channel, ranks  (+ aliases in TOOL_ALIASES, e.g. "transcript" -> clips)
 */
import {
	ChartColumn,
	Gauge,
	Image,
	Lightbulb,
	ListOrdered,
	type LucideIcon,
	MessagesSquare,
	Scissors,
	Search,
	TrendingUp,
	Users,
} from "lucide-react";
import { createContext, useContext } from "react";

import type { CoachContext } from "@/lib/ai/types";

import type { ActiveTab } from "../hooks";

export type ToolId =
	| "coach"
	| "keywords"
	| "trending"
	| "competitors"
	| "ideas"
	| "thumbnails"
	| "optimize"
	| "clips"
	| "channel"
	| "ranks";

export type ToolDef = {
	id: ToolId;
	label: string;
	icon: LucideIcon;
	description: string;
};

export const TOOLS: readonly ToolDef[] = [
	{
		id: "coach",
		label: "AI Coach",
		icon: MessagesSquare,
		description: "Chat about any video or channel. Unlimited.",
	},
	{
		id: "keywords",
		label: "Keyword Research",
		icon: Search,
		description: "Find keywords with demand and weak competition.",
	},
	{
		id: "trending",
		label: "Trends",
		icon: TrendingUp,
		description: "What's taking off right now, and your competitors' outliers.",
	},
	{
		id: "competitors",
		label: "Competitors",
		icon: Users,
		description: "Track channels you compete with.",
	},
	{
		id: "ideas",
		label: "Daily Ideas",
		icon: Lightbulb,
		description: "Fresh video ideas based on what works for you.",
	},
	{
		id: "thumbnails",
		label: "Thumbnails",
		icon: Image,
		description: "Research, preview and generate thumbnails.",
	},
	{
		id: "optimize",
		label: "Optimize",
		icon: Gauge,
		description: "Titles, description and tags with a live SEO score.",
	},
	{
		id: "clips",
		label: "Clip Finder",
		icon: Scissors,
		description: "Find Short-worthy moments in any video.",
	},
	{
		id: "channel",
		label: "Channel Audit",
		icon: ChartColumn,
		description: "Stats, posting times, outliers and an AI audit.",
	},
	{
		id: "ranks",
		label: "Rank Tracker",
		icon: ListOrdered,
		description:
			"Track where your videos rank in YouTube search for the terms you choose. Re-checked daily.",
	},
];

export const TOOL_ALIASES: Record<string, ToolId> = {
	chat: "coach",
	ai: "coach",
	keyword: "keywords",
	research: "keywords",
	trends: "trending",
	trend: "trending",
	competitor: "competitors",
	idea: "ideas",
	"daily-ideas": "ideas",
	thumbnail: "thumbnails",
	seo: "optimize",
	titles: "optimize",
	title: "optimize",
	tags: "optimize",
	description: "optimize",
	clip: "clips",
	transcript: "clips",
	shorts: "clips",
	audit: "channel",
	"channel-audit": "channel",
	rank: "ranks",
	rankings: "ranks",
	"rank-tracker": "ranks",
};

export function resolveTool(tool: string | null | undefined): ToolId | null {
	if (!tool) return null;
	const t = tool.toLowerCase();
	if (TOOLS.some((d) => d.id === t)) return t as ToolId;
	return TOOL_ALIASES[t] ?? null;
}

export function toolDef(id: ToolId): ToolDef {
	return TOOLS.find((t) => t.id === id) ?? (TOOLS[0] as ToolDef);
}

/** A request to open a tool with some input. `id` changes on every request. */
export type ToolIntent = {
	id: number;
	tool: ToolId;
	prefill?: string;
	autoSubmit?: boolean;
	videoId?: string;
	channelId?: string;
	coach?: CoachContext;
	/** Tool-specific sub-view (e.g. thumbnails: "similar" | "preview" | "generate") */
	view?: string;
};

export type IntentInput = Omit<ToolIntent, "id" | "tool">;

export type PanelApi = {
	navigate: (tool: ToolId, intent?: IntentInput) => void;
	activeTab: ActiveTab;
};

export const PanelContext = createContext<PanelApi | null>(null);

export function usePanel(): PanelApi {
	const api = useContext(PanelContext);
	if (!api) throw new Error("usePanel() outside the side panel");
	return api;
}

export type ToolProps = {
	/** Latest intent for this tool (null until one arrives) */
	intent: ToolIntent | null;
	/** The tool is currently visible */
	active: boolean;
};
