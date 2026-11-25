/**
 * Competitors: track channels (URL / @handle / id / video link), see their
 * size, average recent views, upload cadence and growth sparkline, and expand
 * their latest uploads with VPH + outlier badges. Also sets "My channel".
 */
import {
	formatCompact,
	formatNumber,
	formatRelative,
} from "@growtube/shared/format";
import { channelUrl } from "@growtube/shared/youtube";
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import {
	BellRing,
	ChevronDown,
	Crown,
	ExternalLink,
	MonitorPlay,
	Plus,
	Trash2,
	UserRound,
	Users,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Sparkline } from "@/components/common";
import { server, yt } from "@/lib/client";
import { useBackground, useStorageItem } from "@/lib/hooks";
import { type Competitor, competitors, myChannel } from "@/lib/settings";
import type { ChannelInfo } from "@/lib/youtube/types";
import { isPublicVideo } from "@/lib/youtube/visibility";

import { CompetitorAlertsPanel } from "../../../alerts";
import {
	channelSummary,
	loadChannelOverview,
	resolveChannelInput,
	toCompetitor,
	toMyChannel,
} from "../../../data";
import { type ActiveTab, useAsyncTask, useOnVisible } from "../../../hooks";
import { OutlierBadge, VphBadge } from "../../../ui/badges";
import { IconButton, SearchForm } from "../../../ui/controls";
import {
	EmptyState,
	ErrorNotice,
	SkeletonList,
	Spinner,
} from "../../../ui/feedback";
import { Section, StatGrid, StatTile } from "../../../ui/layout";
import { toast } from "../../../ui/toast";
import { Avatar, VideoRow } from "../../../ui/video";
import { openLink } from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { ToolScroll } from "../../shared";

/** Channel of the active tab (channel page, or the uploader of a video). */
export async function resolveTabChannel(tab: ActiveTab): Promise<ChannelInfo> {
	if (tab.channelRef) return yt.getChannel(tab.channelRef);
	if (tab.videoId) {
		const v = await yt.getVideoDetails(tab.videoId, { level: "basic" });
		// An unlisted or private video's channel is not crowdsourced.
		return yt.getChannel(
			{ channelId: v.channelId },
			{ crowdsource: isPublicVideo(v) },
		);
	}
	throw new Error("Open a YouTube channel or video in this tab first.");
}

export function CompetitorsTool({ intent }: ToolProps) {
	const { activeTab } = usePanel();
	const [list, setList] = useStorageItem(competitors);
	const [input, setInput] = useState("");

	const add = useAsyncTask(async (source: { input?: string; tab?: true }) => {
		const channel = source.tab
			? await resolveTabChannel(activeTab)
			: await resolveChannelInput(source.input ?? "");
		if (list.some((c) => c.channelId === channel.channelId)) {
			toast(`${channel.title} is already in your list.`);
			return channel;
		}
		await setList((prev) => [
			toCompetitor(channel),
			...prev.filter((c) => c.channelId !== channel.channelId),
		]);
		setInput("");
		toast(`Tracking ${channel.title}`, { tone: "success" });
		return channel;
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent?.channelId) void add.run({ input: intent.channelId });
		else if (intent?.prefill) setInput(intent.prefill);
	}, [intent?.id]);

	const remove = (c: Competitor) => {
		const index = list.findIndex((x) => x.channelId === c.channelId);
		void setList((prev) => prev.filter((x) => x.channelId !== c.channelId));
		toast(`Removed ${c.title}`, {
			action: {
				label: "Undo",
				onClick: () =>
					void setList((prev) => {
						if (prev.some((x) => x.channelId === c.channelId)) return prev;
						const next = [...prev];
						next.splice(Math.max(0, index), 0, c);
						return next;
					}),
			},
		});
	};

	const tabHasChannel = !!(activeTab.channelRef || activeTab.videoId);

	return (
		<ToolScroll>
			<MyChannelSection />

			<Section
				title="Add a competitor"
				description="Paste a channel URL, @handle, channel id or any video link."
			>
				<SearchForm
					value={input}
					onChange={setInput}
					onSubmit={(v) => void add.run({ input: v })}
					placeholder="@handle or youtube.com/…"
					inputLabel="Channel to add"
					buttonLabel="Add"
					icon={Plus}
					loading={add.loading}
				/>
				{tabHasChannel ? (
					<Button
						size="xs"
						variant="outline"
						className="self-start"
						disabled={add.loading}
						onClick={() => void add.run({ tab: true })}
					>
						<MonitorPlay /> Add this tab's channel
					</Button>
				) : null}
				{add.error ? <ErrorNotice error={add.error} /> : null}
			</Section>

			<Section title="Outlier alerts" icon={BellRing}>
				<CompetitorAlertsPanel />
			</Section>

			{list.length === 0 ? (
				<EmptyState icon={Users} title="No competitors yet">
					Add channels in your niche to compare growth, spot their outliers in
					Trends, and feed Daily Ideas. Track as many as you like.
				</EmptyState>
			) : (
				<div className="flex flex-col gap-2">
					<div className="text-muted-foreground text-[11px]">
						Tracking {list.length} channel{list.length === 1 ? "" : "s"}
					</div>
					{list.map((c) => (
						<CompetitorCard
							key={c.channelId}
							competitor={c}
							onRemove={() => remove(c)}
						/>
					))}
				</div>
			)}
		</ToolScroll>
	);
}

// ---------------------------------------------------------------------------

function MyChannelSection() {
	const { activeTab } = usePanel();
	const [mine, setMine] = useStorageItem(myChannel);
	const [editing, setEditing] = useState(false);
	const [input, setInput] = useState("");
	const info = useBackground(
		"yt.getChannel",
		mine ? { ref: { channelId: mine.channelId } } : null,
		[mine?.channelId],
	);
	const set = useAsyncTask(async (source: { input?: string; tab?: true }) => {
		const channel = source.tab
			? await resolveTabChannel(activeTab)
			: await resolveChannelInput(source.input ?? "");
		await setMine(toMyChannel(channel));
		setEditing(false);
		setInput("");
		toast(`My channel: ${channel.title}`, { tone: "success" });
		return channel;
	});

	const showForm = !mine || editing;
	return (
		<Section
			title="My channel"
			icon={Crown}
			description={
				showForm
					? "Used by Daily Ideas, Channel Audit and the coach."
					: undefined
			}
			actions={
				mine && !editing ? (
					<>
						<Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
							Change
						</Button>
						<IconButton
							label="Clear my channel"
							icon={X}
							size="icon-xs"
							onClick={() => void setMine(null)}
						/>
					</>
				) : editing ? (
					<IconButton
						label="Cancel"
						icon={X}
						size="icon-xs"
						onClick={() => setEditing(false)}
					/>
				) : null
			}
		>
			{mine && !editing ? (
				<div className="flex items-center gap-2.5">
					<Avatar src={info.data?.avatarUrl} size={36} />
					<div className="flex min-w-0 flex-col">
						<span className="truncate text-xs font-medium">{mine.title}</span>
						<span className="text-muted-foreground truncate text-[11px]">
							{info.loading
								? "Loading…"
								: info.data
									? channelSummary(info.data)
									: mine.handle}
						</span>
					</div>
				</div>
			) : (
				<>
					<SearchForm
						value={input}
						onChange={setInput}
						onSubmit={(v) => void set.run({ input: v })}
						placeholder="Your channel URL or @handle"
						inputLabel="Your channel"
						buttonLabel="Save"
						icon={UserRound}
						loading={set.loading}
					/>
					{activeTab.channelRef || activeTab.videoId ? (
						<Button
							size="xs"
							variant="outline"
							className="self-start"
							disabled={set.loading}
							onClick={() => void set.run({ tab: true })}
						>
							<MonitorPlay /> Use this tab's channel
						</Button>
					) : null}
					{set.error ? <ErrorNotice error={set.error} /> : null}
				</>
			)}
		</Section>
	);
}

// ---------------------------------------------------------------------------

function CompetitorCard({
	competitor,
	onRemove,
}: {
	competitor: Competitor;
	onRemove: () => void;
}) {
	const [, setMine] = useStorageItem(myChannel);
	const [expanded, setExpanded] = useState(false);
	const overview = useAsyncTask(() =>
		loadChannelOverview(competitor.channelId),
	);
	const history = useAsyncTask(() =>
		server.getChannelHistory(competitor.channelId),
	);
	const ref = useOnVisible<HTMLDivElement>(() => {
		void overview.run();
		void history.run();
	});

	const o = overview.data;
	const channel = o?.channel;
	const points = history.data?.points ?? [];
	const growth = points
		.map((p) => p.totalViews ?? p.subscribers)
		.filter((v): v is number => v != null);

	return (
		<div
			ref={ref}
			className="bg-card ring-foreground/7 flex flex-col overflow-hidden rounded-xl shadow-xs ring-1"
		>
			<div className="flex items-start gap-2.5 p-3">
				<button
					type="button"
					onClick={(e) => openLink(channelUrl(competitor.channelId), e)}
					className="focus-visible:ring-ring shrink-0 rounded-full outline-none focus-visible:ring-2"
					aria-label={`Open ${competitor.title} on YouTube`}
				>
					<Avatar src={channel?.avatarUrl ?? competitor.avatarUrl} size={40} />
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-xs font-semibold">
							{channel?.title ?? competitor.title}
						</span>
						{overview.loading ? <Spinner className="size-3" /> : null}
					</div>
					<span className="text-muted-foreground truncate text-[11px]">
						{channel?.handle ?? competitor.handle ?? competitor.channelId}
					</span>
				</div>
				<div className="flex shrink-0 items-center">
					{growth.length >= 2 ? (
						<Sparkline
							values={growth}
							width={64}
							height={22}
							ariaLabel="Channel views trend (crowdsourced history)"
						/>
					) : null}
					<IconButton
						label="Open on YouTube"
						icon={ExternalLink}
						size="icon-xs"
						onClick={(e) => openLink(channelUrl(competitor.channelId), e)}
					/>
					<IconButton
						label="Set as my channel"
						icon={Crown}
						size="icon-xs"
						onClick={() => {
							void setMine({
								channelId: competitor.channelId,
								handle: channel?.handle ?? competitor.handle,
								title: channel?.title ?? competitor.title,
							});
							toast(`My channel: ${competitor.title}`, { tone: "success" });
						}}
					/>
					<IconButton
						label="Remove"
						icon={Trash2}
						size="icon-xs"
						onClick={onRemove}
					/>
				</div>
			</div>

			{overview.error ? (
				<div className="px-3 pb-3">
					<ErrorNotice
						error={overview.error}
						onRetry={() => void overview.run()}
					/>
				</div>
			) : (
				<div className="px-3 pb-2">
					<StatGrid className="grid-cols-3">
						<StatTile
							label="Subscribers"
							value={o ? formatCompact(channel?.subscribers, 2) : "…"}
						/>
						<StatTile
							label="Avg views"
							value={o ? formatCompact(o.avgRecentViews) : "…"}
							title="Mean views of the 15 newest long-form uploads older than a day"
						/>
						<StatTile
							label="Uploads/wk"
							value={
								o
									? o.uploadsPerWeek == null
										? "—"
										: o.uploadsPerWeek.toFixed(1)
									: "…"
							}
						/>
					</StatGrid>
				</div>
			)}

			<button
				type="button"
				onClick={() => setExpanded((e) => !e)}
				aria-expanded={expanded}
				className="text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03] focus-visible:text-foreground focus-visible:bg-foreground/[0.04] flex items-center gap-1.5 border-t px-3 py-2 text-[11px] transition-colors duration-150 outline-none"
			>
				<ChevronDown
					className={cn(
						"size-3.5 transition-transform duration-200",
						!expanded && "-rotate-90",
					)}
					aria-hidden
				/>
				Recent uploads
				{o?.videos[0]?.publishedAt
					? ` · newest ${formatRelative(o.videos[0].publishedAt)}`
					: ""}
				{channel?.videoCount != null ? (
					<span className="ml-auto">
						{formatNumber(channel.videoCount)} videos
					</span>
				) : null}
			</button>
			{expanded ? (
				<div className="flex flex-col gap-3 px-3 pt-1 pb-3">
					{!o ? (
						<SkeletonList rows={3} />
					) : o.videos.length === 0 ? (
						<div className="text-muted-foreground text-xs">
							No long-form uploads.
						</div>
					) : (
						o.videos.slice(0, 10).map((v) => (
							<VideoRow
								key={v.videoId}
								video={v}
								badges={
									<>
										<OutlierBadge score={v.outlier} />
										<VphBadge vph={v.vph} />
									</>
								}
							/>
						))
					)}
				</div>
			) : null}
		</div>
	);
}
