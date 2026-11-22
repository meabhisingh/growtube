/**
 * The watch page panel: collapsible card with Views / Overview / AI Coach
 * tabs. Signed out it is only a compact "Sign in" card (no data is loaded).
 */
import { formatCompact, formatOutlier } from "@growtube/shared/format";
import { outlierTier } from "@growtube/shared/metrics";
import { ChevronDown, ChevronUp, LogIn } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Logo } from "@/components/common/Logo";
import { ACCOUNT_SECTION, authUser } from "@/lib/auth";
import { ext } from "@/lib/client";
import { useStorageItem, useYouTubeDarkTheme } from "@/lib/hooks";
import type { YtPageData } from "@/lib/youtube/types";

import {
	type InjectedPrefs,
	injectedPrefs,
	type WatchPanelTab,
	withPrefDefaults,
} from "../common/prefs";
import { type Store, useStore } from "../common/store";
import { type TabDef, Tabs } from "../common/ui";
import { CoachTab } from "./CoachTab";
import { useWatchData } from "./data";
import { OverviewTab, type TagRanks } from "./OverviewTab";
import { ViewsTab } from "./ViewsTab";

export type WatchPanelState = {
	videoId: string | null;
	page: YtPageData | null;
};

const TABS: readonly TabDef<WatchPanelTab>[] = [
	{ id: "views", label: "Views" },
	{ id: "overview", label: "Overview" },
	{ id: "coach", label: "AI Coach" },
];

export function WatchPanelApp({ store }: { store: Store<WatchPanelState> }) {
	const { videoId, page } = useStore(store);
	const [user, , authLoading] = useStorageItem(authUser);
	if (!videoId || authLoading) return null;
	if (!user) return <SignInCard />;
	// Keyed by video: every navigation starts from a clean state.
	return <VideoPanel key={videoId} videoId={videoId} page={page} />;
}

/** Signed out: one line and a button to Settings → Account. */
function SignInCard() {
	const dark = useYouTubeDarkTheme();
	const [error, setError] = useState<string | null>(null);
	return (
		<div className={dark ? "ovq-root ovq-dark" : "ovq-root"}>
			<section className="ovq-panel" aria-label="GrowTube">
				<div className="ovq-panel-header">
					<Logo size={20} />
					<span className="ovq-panel-title">Sign in to use GrowTube</span>
					<button
						type="button"
						className="ovq-btn primary small"
						style={{ marginLeft: "auto" }}
						onClick={() =>
							void ext
								.openOptions(ACCOUNT_SECTION)
								.then(() => setError(null))
								.catch((e: unknown) =>
									setError(
										e instanceof Error
											? e.message
											: "Couldn't open the settings page.",
									),
								)
						}
					>
						<LogIn size={14} aria-hidden="true" />
						Sign in
					</button>
				</div>
				<div className="ovq-panel-body">
					<p className="ovq-small ovq-muted" style={{ margin: 0 }}>
						{error ??
							"A free account unlocks video stats, history and the AI coach. No plans, no limits."}
					</p>
				</div>
			</section>
		</div>
	);
}

function VideoPanel({
	videoId,
	page,
}: {
	videoId: string;
	page: YtPageData | null;
}) {
	const [stored, setStored, prefsLoading] = useStorageItem(injectedPrefs);
	const prefs = withPrefDefaults(stored);
	const setPrefs = useCallback(
		(patch: Partial<InjectedPrefs>) =>
			void setStored((prev) => ({ ...withPrefDefaults(prev), ...patch })).catch(
				() => {},
			),
		[setStored],
	);
	const dark = useYouTubeDarkTheme();
	const w = useWatchData(videoId, page);
	const [tagRanks, setTagRanks] = useState<TagRanks | null>(null);
	const tab = prefs.watchPanelTab;
	const collapsed = prefs.watchPanelCollapsed;

	// Tabs stay mounted once visited (keeps the coach conversation and
	// already-loaded data when switching back and forth).
	const [visited, setVisited] = useState<Set<WatchPanelTab>>(() => new Set());
	useEffect(() => {
		if (prefsLoading || collapsed) return;
		setVisited((prev) => (prev.has(tab) ? prev : new Set(prev).add(tab)));
	}, [tab, collapsed, prefsLoading]);

	const m = w.metrics;
	const tier = outlierTier(m?.outlierScore);
	const idPrefix = `ovq-watch-${videoId}`;

	return (
		<div className={dark ? "ovq-root ovq-dark" : "ovq-root"}>
			<section className="ovq-panel" aria-label="GrowTube video stats">
				<div className="ovq-panel-header">
					<Logo size={20} />
					<span className="ovq-panel-title">GrowTube</span>
					<div className="ovq-panel-summary" aria-live="polite">
						{m?.vph != null && (
							<span className="ovq-pill" title="Views per hour">
								{formatCompact(m.vph, 1)} VPH
							</span>
						)}
						{m?.outlierScore != null && (
							<span
								className={`ovq-pill ${tier ?? ""}`}
								title="Outlier score vs the channel's typical video"
							>
								{formatOutlier(m.outlierScore)}
							</span>
						)}
					</div>
					<button
						type="button"
						className="ovq-icon-btn"
						aria-expanded={!collapsed}
						aria-controls={`${idPrefix}-body`}
						aria-label={
							collapsed ? "Expand GrowTube panel" : "Collapse GrowTube panel"
						}
						title={collapsed ? "Expand" : "Collapse"}
						onClick={() => setPrefs({ watchPanelCollapsed: !collapsed })}
						style={
							m?.vph == null && m?.outlierScore == null
								? { marginLeft: "auto" }
								: undefined
						}
					>
						{collapsed ? (
							<ChevronDown size={18} aria-hidden="true" />
						) : (
							<ChevronUp size={18} aria-hidden="true" />
						)}
					</button>
				</div>
				{(!collapsed || visited.size > 0) && (
					<div
						className="ovq-panel-body"
						id={`${idPrefix}-body`}
						hidden={collapsed}
					>
						<Tabs
							tabs={TABS}
							value={tab}
							onChange={(id) => setPrefs({ watchPanelTab: id })}
							label="GrowTube sections"
							idPrefix={idPrefix}
						/>
						{TABS.map((t) =>
							visited.has(t.id) || t.id === tab ? (
								<div
									key={t.id}
									role="tabpanel"
									id={`${idPrefix}-panel-${t.id}`}
									aria-labelledby={`${idPrefix}-tab-${t.id}`}
									hidden={t.id !== tab}
								>
									{t.id === "views" && <ViewsTab w={w} />}
									{t.id === "overview" && (
										<OverviewTab w={w} onTagRanks={setTagRanks} />
									)}
									{t.id === "coach" && <CoachTab w={w} tagRanks={tagRanks} />}
								</div>
							) : null,
						)}
					</div>
				)}
			</section>
		</div>
	);
}
