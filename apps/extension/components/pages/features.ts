/** Labels for the feature toggles (settings.features), shared by popup + options. */
import {
	Gauge,
	type LucideIcon,
	MonitorPlay,
	PanelRight,
	Smartphone,
} from "lucide-react";

import type { FeatureFlags } from "@/lib/settings";

export const FEATURE_INFO: readonly {
	key: keyof FeatureFlags;
	title: string;
	description: string;
	icon: LucideIcon;
}[] = [
	{
		key: "feedBadges",
		title: "Badges on thumbnails",
		description:
			"Views per hour and outlier scores on home, search and channel pages.",
		icon: MonitorPlay,
	},
	{
		key: "watchPanel",
		title: "Watch page panel",
		description: "Stats, SEO score, tags and the AI coach next to the player.",
		icon: PanelRight,
	},
	{
		key: "shortsControls",
		title: "Shorts controls",
		description: "Playback speed and auto-scroll while watching Shorts.",
		icon: Smartphone,
	},
	{
		key: "studioOptimizer",
		title: "YouTube Studio optimizer",
		description:
			"SEO checklist and AI title, description and tag helpers in Studio.",
		icon: Gauge,
	},
];
