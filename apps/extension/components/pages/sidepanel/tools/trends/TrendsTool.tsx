/**
 * Trends: crowdsourced trending videos (by recent views/hour) from the
 * GrowTube server, plus outliers among your competitors' recent uploads.
 */
import type { TrendingQuery } from "@growtube/shared/api";
import { formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Flame, RefreshCw, Search, TrendingUp, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";

import { server } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { competitors } from "@/lib/settings";

import { useOutliers } from "../../../baselines";
import { loadCompetitorOutliers } from "../../../data";
import { useAsyncTask, useDebounced, useLocalPref } from "../../../hooks";
import { Badge, OutlierBadge, VphBadge } from "../../../ui/badges";
import { IconButton, Segmented } from "../../../ui/controls";
import { EmptyState, ErrorNotice, SkeletonList } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import { VideoRow } from "../../../ui/video";
import { type ToolProps, usePanel } from "../../nav";
import { ToolScroll } from "../../shared";

type TrendWindow = TrendingQuery["window"];
type Kind = TrendingQuery["type"];

export function TrendsTool({ active }: ToolProps) {
	return (
		<ToolScroll>
			<TrendingSection active={active} />
			<CompetitorOutliersSection active={active} />
		</ToolScroll>
	);
}

function TrendingSection({ active }: { active: boolean }) {
	const [win, setWin] = useLocalPref<TrendWindow>("trends.window", "24h");
	const [type, setType] = useLocalPref<Kind>("trends.type", "all");
	const [q, setQ] = useState("");
	const query = useDebounced(q.trim(), 350);
	const trending = useAsyncTask((force: boolean) =>
		server.getTrending({
			window: win,
			type,
			q: query || undefined,
			limit: 50,
			force,
		}),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch on filter change
	useEffect(() => {
		if (active) void trending.run(false);
	}, [win, type, query, active]);

	const videos = trending.data?.videos ?? [];
	const outliers = useOutliers(
		videos.slice(0, 30).map((v) => ({
			videoId: v.videoId,
			channelId: v.channelId,
			views: v.views,
			isShort: v.isShort ?? false,
		})),
		active,
	);

	return (
		<Section
			title="Trending now"
			icon={Flame}
			description="Fastest-growing videos seen by GrowTube users, ranked by views per hour."
			actions={
				<IconButton
					label="Refresh"
					icon={RefreshCw}
					onClick={() => void trending.run(true)}
					disabled={trending.loading}
					className={trending.loading ? "[&_svg]:animate-spin" : undefined}
				/>
			}
		>
			<div className="flex flex-wrap items-center gap-1.5">
				<Segmented<TrendWindow>
					size="xs"
					value={win}
					onChange={setWin}
					options={[
						{ value: "24h", label: "24h" },
						{ value: "7d", label: "7 days" },
					]}
					ariaLabel="Time window"
				/>
				<Segmented<Kind>
					size="xs"
					value={type}
					onChange={setType}
					options={[
						{ value: "all", label: "All" },
						{ value: "long", label: "Videos" },
						{ value: "short", label: "Shorts" },
					]}
					ariaLabel="Format"
				/>
			</div>
			<div className="relative">
				<Search
					className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
					aria-hidden
				/>
				<Input
					value={q}
					onChange={(e) => setQ(e.target.value)}
					placeholder="Filter by title"
					aria-label="Filter trending by title"
					className="pl-8"
				/>
			</div>

			{trending.error ? (
				<ErrorNotice
					error={trending.error}
					onRetry={() => void trending.run(true)}
					title="Trending needs the GrowTube server"
				/>
			) : trending.loading && !trending.data ? (
				<SkeletonList rows={6} />
			) : videos.length === 0 ? (
				<EmptyState
					icon={TrendingUp}
					title={query ? "Nothing matches" : "No trending data yet"}
				>
					{query
						? "Try a broader filter, or switch the window to 7 days."
						: "Trending fills up as GrowTube users browse YouTube with crowdsourced stats on. Check back soon."}
				</EmptyState>
			) : (
				<div className="flex flex-col gap-3">
					{videos.map((v, i) => (
						<VideoRow
							key={v.videoId}
							rank={i + 1}
							video={{
								videoId: v.videoId,
								title: v.title ?? "Untitled video",
								channelTitle: v.channelTitle,
								views: v.views,
								publishedAt: v.publishedAt,
								isShort: v.isShort ?? false,
							}}
							badges={
								<>
									<VphBadge vph={v.vph} />
									<OutlierBadge
										score={outliers[v.videoId]}
										loading={
											i < 30 &&
											outliers[v.videoId] === undefined &&
											!!v.channelId
										}
									/>
								</>
							}
						/>
					))}
					{trending.data ? (
						<div className="text-muted-foreground text-[11px]">
							Updated {formatRelative(trending.data.generatedAt)}
						</div>
					) : null}
				</div>
			)}
		</Section>
	);
}

function CompetitorOutliersSection({ active }: { active: boolean }) {
	const { navigate } = usePanel();
	const [list] = useStorageItem(competitors);
	const [days, setDays] = useLocalPref<"7" | "30" | "90">(
		"trends.outlierDays",
		"30",
	);
	const outliers = useAsyncTask(() =>
		loadCompetitorOutliers(list, { maxAgeDays: Number(days), limit: 25 }),
	);
	const ids = list.map((c) => c.channelId).join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch when the list changes
	useEffect(() => {
		if (active && list.length) void outliers.run();
	}, [ids, days, active]);

	return (
		<Section
			title="Outliers from your competitors"
			icon={Zap}
			description="Their recent uploads that beat their own typical views the most."
			actions={
				list.length ? (
					<IconButton
						label="Refresh"
						icon={RefreshCw}
						onClick={() => void outliers.run()}
						disabled={outliers.loading}
						className={outliers.loading ? "[&_svg]:animate-spin" : undefined}
					/>
				) : null
			}
		>
			{list.length === 0 ? (
				<EmptyState
					icon={Users}
					title="No competitors yet"
					action={
						<Button size="sm" onClick={() => navigate("competitors")}>
							<Users /> Add competitors
						</Button>
					}
				>
					Track a few channels in your niche to see which of their videos are
					breaking out.
				</EmptyState>
			) : (
				<>
					<Segmented<"7" | "30" | "90">
						size="xs"
						value={days}
						onChange={setDays}
						options={[
							{ value: "7", label: "7 days" },
							{ value: "30", label: "30 days" },
							{ value: "90", label: "90 days" },
						]}
						ariaLabel="Upload age"
					/>
					{outliers.error ? (
						<ErrorNotice
							error={outliers.error}
							onRetry={() => void outliers.run()}
						/>
					) : outliers.loading && !outliers.data ? (
						<SkeletonList rows={4} />
					) : outliers.data && outliers.data.videos.length === 0 ? (
						<div className="text-muted-foreground py-4 text-center text-xs">
							No uploads from your competitors in this window.
						</div>
					) : outliers.data ? (
						<div className="flex flex-col gap-3">
							{outliers.data.videos.map((v) => (
								<VideoRow
									key={v.videoId}
									video={{ ...v, channelTitle: v.channelTitle }}
									badges={
										<>
											<OutlierBadge score={v.outlier} />
											<VphBadge vph={v.vph} />
										</>
									}
								/>
							))}
							{outliers.data.failed.length ? (
								<Badge tone="amber" className="self-start">
									Couldn't load: {outliers.data.failed.join(", ")}
								</Badge>
							) : null}
						</div>
					) : null}
				</>
			)}
		</Section>
	);
}
