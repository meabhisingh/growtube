/**
 * Rank Tracker: (video, search term) pairs whose position in YouTube search
 * is re-checked daily by the background (lib/rank-tracker.ts) and kept as a
 * dated history in chrome.storage.local. Shows the current rank, the change
 * since the previous check, the best rank and a chart; exports CSV.
 *
 * Intent: `{ videoId?, prefill? (search term), autoSubmit? }`, e.g.
 * `navigate("ranks", { videoId, prefill: "budget travel", autoSubmit: true })`.
 */
import { formatRelative } from "@growtube/shared/format";
import { extractVideoId } from "@growtube/shared/youtube";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { cn } from "@growtube/ui/lib/utils";
import {
	ArrowDown,
	ArrowUp,
	Download,
	ExternalLink,
	ListOrdered,
	MonitorPlay,
	Plus,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { AreaChart } from "@/components/common";
import { jobs, yt } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	MAX_RANK_TRACKS,
	newId,
	RANK_DEPTH,
	RANK_HISTORY_DAYS,
	type RankTrack,
	rankTracks,
} from "@/lib/settings";

import { useAsyncTask } from "../../../hooks";
import { Badge } from "../../../ui/badges";
import { IconButton } from "../../../ui/controls";
import { EmptyState, ErrorNotice, Spinner } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import { toast } from "../../../ui/toast";
import { Thumb } from "../../../ui/video";
import { openLink, watchUrl } from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { ToolScroll } from "../../shared";

const normalizeQuery = (q: string) => q.trim().replace(/\s+/g, " ");

function searchUrl(query: string): string {
	return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

export type RankSummary = {
	current: number | null;
	previous: number | null | undefined;
	best: number | null;
	checks: number;
};

export function summarize(track: RankTrack): RankSummary {
	const h = track.history;
	const ranks = h.map((p) => p.rank).filter((r): r is number => r != null);
	return {
		current: h.at(-1)?.rank ?? null,
		previous: h.length >= 2 ? (h.at(-2)?.rank ?? null) : undefined,
		best: ranks.length ? Math.min(...ranks) : null,
		checks: h.length,
	};
}

function csvCell(value: string | number | null): string {
	const s = value == null ? "" : String(value);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per check: video, term, time, rank (empty = not in the top N). */
export function rankHistoryCsv(tracks: readonly RankTrack[]): string {
	const rows: (string | number | null)[][] = [
		["video_id", "video_title", "search_term", "checked_at", "rank"],
	];
	for (const t of tracks)
		for (const p of t.history)
			rows.push([t.videoId, t.title, t.query, p.t, p.rank]);
	return `${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function downloadCsv(tracks: readonly RankTrack[]) {
	const blob = new Blob([rankHistoryCsv(tracks)], {
		type: "text/csv;charset=utf-8",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `growtube-ranks-${new Date().toISOString().slice(0, 10)}.csv`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function RankTrackerTool({ intent }: ToolProps) {
	const { activeTab } = usePanel();
	const [list, setList, loading] = useStorageItem(rankTracks);
	const [video, setVideo] = useState("");
	const [query, setQuery] = useState("");
	const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
	const full = list.length >= MAX_RANK_TRACKS;

	const runCheck = async (ids?: string[]) => {
		const key = ids ?? ["*"];
		setChecking((s) => new Set([...s, ...key]));
		try {
			const r = await jobs.checkRanks(ids);
			if (r.failed)
				toast(`${r.failed} check${r.failed === 1 ? "" : "s"} failed`, {
					tone: "error",
				});
			return r;
		} finally {
			setChecking((s) => {
				const next = new Set(s);
				for (const k of key) next.delete(k);
				return next;
			});
		}
	};

	const add = useAsyncTask(async (videoInput: string, termInput: string) => {
		const videoId = extractVideoId(videoInput.trim());
		if (!videoId)
			throw new Error(
				"Paste a YouTube video link or an 11-character video id.",
			);
		const term = normalizeQuery(termInput);
		if (!term) throw new Error("Enter the search term to track.");
		const current = await rankTracks.getValue();
		if (current.length >= MAX_RANK_TRACKS)
			throw new Error(
				`You can track up to ${MAX_RANK_TRACKS} pairs. Remove one to add another.`,
			);
		if (
			current.some(
				(t) =>
					t.videoId === videoId && t.query.toLowerCase() === term.toLowerCase(),
			)
		) {
			toast("Already tracking this video for that term.");
			return null;
		}
		// Title/thumbnail for the list; not crowdsourced.
		const d = await yt.getVideoDetails(videoId, {
			level: "basic",
			crowdsource: false,
		});
		const track: RankTrack = {
			id: newId(),
			videoId,
			query: term,
			title: d.title,
			channelTitle: d.channelTitle || null,
			thumbnail: d.thumbnailUrl || null,
			createdAt: Date.now(),
			history: [],
			lastCheckedAt: null,
			lastAttemptAt: null,
			lastError: null,
		};
		await setList((prev) => [track, ...prev].slice(0, MAX_RANK_TRACKS));
		setQuery("");
		toast(`Tracking “${term}”`, { tone: "success" });
		void runCheck([track.id]).catch(() => null);
		return track;
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent) return;
		if (intent.videoId) setVideo(intent.videoId);
		if (intent.prefill) setQuery(intent.prefill);
		if (intent.autoSubmit && intent.videoId && intent.prefill)
			void add.run(intent.videoId, intent.prefill);
	}, [intent?.id]);

	const submit = (e: FormEvent) => {
		e.preventDefault();
		void add.run(video, query);
	};

	const remove = (t: RankTrack) => {
		const index = list.findIndex((x) => x.id === t.id);
		void setList((prev) => prev.filter((x) => x.id !== t.id));
		toast(`Stopped tracking “${t.query}”`, {
			action: {
				label: "Undo",
				onClick: () =>
					void setList((prev) => {
						if (prev.some((x) => x.id === t.id)) return prev;
						const next = [...prev];
						next.splice(Math.max(0, index), 0, t);
						return next.slice(0, MAX_RANK_TRACKS);
					}),
			},
		});
	};

	const checkingAll = checking.has("*");

	return (
		<ToolScroll>
			<Section
				title="Track a search rank"
				description={`Where a video shows up in YouTube search for a term (top ${RANK_DEPTH}, signed-out results). Re-checked once a day.`}
			>
				<form onSubmit={submit} className="flex flex-col gap-1.5">
					<Input
						value={video}
						onChange={(e) => setVideo(e.target.value)}
						placeholder="Video link or id"
						aria-label="Video link or id"
						className="h-8"
					/>
					<div className="flex gap-1.5">
						<div className="relative min-w-0 flex-1">
							<Search
								className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
								aria-hidden
							/>
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Search term, e.g. budget travel tips"
								aria-label="Search term"
								className="h-8 pl-8"
							/>
						</div>
						<Button
							type="submit"
							className="h-8"
							disabled={add.loading || full || !video.trim() || !query.trim()}
						>
							{add.loading ? <Spinner className="size-3.5" /> : <Plus />}
							Track
						</Button>
					</div>
				</form>
				<div className="flex flex-wrap items-center gap-2">
					{activeTab.videoId && activeTab.videoId !== extractVideoId(video) ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => setVideo(activeTab.videoId ?? "")}
						>
							<MonitorPlay /> Use this tab's video
						</Button>
					) : null}
					<span
						className={cn(
							"text-[11px]",
							full
								? "text-amber-600 dark:text-amber-400"
								: "text-muted-foreground",
						)}
					>
						{list.length} / {MAX_RANK_TRACKS} tracked
					</span>
				</div>
				{add.error ? <ErrorNotice error={add.error} /> : null}
			</Section>

			{loading ? null : list.length === 0 ? (
				<EmptyState icon={ListOrdered} title="No ranks tracked yet">
					Add a video and the search term you want it to rank for. GrowTube
					checks its position every day and charts it here. Everything stays in
					this browser.
				</EmptyState>
			) : (
				<>
					<div className="flex flex-wrap items-center gap-1.5">
						<Button
							size="xs"
							variant="outline"
							disabled={checkingAll}
							onClick={() => void runCheck().catch(() => null)}
						>
							<RefreshCw className={checkingAll ? "animate-spin" : undefined} />
							{checkingAll ? "Checking…" : "Check all now"}
						</Button>
						<Button
							size="xs"
							variant="ghost"
							onClick={() => downloadCsv(list)}
							disabled={!list.some((t) => t.history.length)}
						>
							<Download /> Export CSV
						</Button>
						<span className="text-muted-foreground ml-auto text-[10px]">
							{RANK_HISTORY_DAYS} days of history kept
						</span>
					</div>
					{list.map((t) => (
						<RankCard
							key={t.id}
							track={t}
							checking={checkingAll || checking.has(t.id)}
							onCheck={() => void runCheck([t.id]).catch(() => null)}
							onRemove={() => remove(t)}
						/>
					))}
				</>
			)}
		</ToolScroll>
	);
}

// ---------------------------------------------------------------------------

function RankChange({ s }: { s: RankSummary }) {
	if (s.previous === undefined)
		return s.checks ? (
			<Badge tone="neutral" title="Only one check so far">
				new
			</Badge>
		) : null;
	if (s.current == null && s.previous == null) return null;
	if (s.current == null)
		return (
			<Badge tone="red" title={`Was #${s.previous} at the previous check`}>
				<ArrowDown className="size-3" aria-hidden /> dropped out
			</Badge>
		);
	if (s.previous == null)
		return (
			<Badge tone="emerald" title={`Entered the top ${RANK_DEPTH}`}>
				<ArrowUp className="size-3" aria-hidden /> entered
			</Badge>
		);
	const delta = s.previous - s.current;
	if (delta === 0)
		return (
			<Badge tone="neutral" title="Same as the previous check">
				±0
			</Badge>
		);
	return delta > 0 ? (
		<Badge tone="emerald" title={`Up from #${s.previous}`}>
			<ArrowUp className="size-3" aria-hidden />
			{delta}
		</Badge>
	) : (
		<Badge tone="red" title={`Down from #${s.previous}`}>
			<ArrowDown className="size-3" aria-hidden />
			{-delta}
		</Badge>
	);
}

/** Chart y = -rank, so up means better; "not ranked" sits just below #N. */
const OUT_OF_RANGE = -(RANK_DEPTH + 1);
const formatRankAxis = (y: number) => {
	const r = Math.round(-y);
	return r > RANK_DEPTH ? `>${RANK_DEPTH}` : `#${r}`;
};
const formatDay = (x: number) =>
	new Date(x).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function RankCard({
	track,
	checking,
	onCheck,
	onRemove,
}: {
	track: RankTrack;
	checking: boolean;
	onCheck: () => void;
	onRemove: () => void;
}) {
	const s = summarize(track);
	const checked = s.checks > 0;
	return (
		<div className="bg-card ring-foreground/7 flex flex-col gap-2.5 rounded-xl p-3 shadow-xs ring-1">
			<div className="flex items-start gap-2.5">
				<button
					type="button"
					onClick={(e) => openLink(watchUrl(track.videoId), e)}
					className="focus-visible:ring-ring/60 shrink-0 rounded-lg outline-none focus-visible:ring-2"
					aria-label={`Open “${track.title}” on YouTube`}
				>
					<Thumb
						videoId={track.videoId}
						src={track.thumbnail}
						className="w-20"
					/>
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<span
						className="ovq-clamp-2 text-xs leading-snug font-medium"
						title={track.title}
					>
						{track.title}
					</span>
					<button
						type="button"
						onClick={(e) => openLink(searchUrl(track.query), e)}
						className="text-brand inline-flex min-w-0 items-center gap-1 self-start text-[11px] outline-none hover:underline focus-visible:underline"
						title="Open this search on YouTube"
					>
						<Search className="size-3 shrink-0" aria-hidden />
						<span className="truncate">{track.query}</span>
					</button>
				</div>
				<div className="flex shrink-0 items-center">
					<IconButton
						label="Check now"
						icon={RefreshCw}
						size="icon-xs"
						disabled={checking}
						onClick={onCheck}
						className={checking ? "[&_svg]:animate-spin" : undefined}
					/>
					<IconButton
						label="Open video"
						icon={ExternalLink}
						size="icon-xs"
						onClick={(e) => openLink(watchUrl(track.videoId), e)}
					/>
					<IconButton
						label="Stop tracking"
						icon={Trash2}
						size="icon-xs"
						onClick={onRemove}
					/>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<div className="flex items-baseline gap-1.5">
					<span className="ovq-num text-lg font-semibold">
						{!checked
							? checking
								? "…"
								: "—"
							: s.current != null
								? `#${s.current}`
								: `Not in top ${RANK_DEPTH}`}
					</span>
					<RankChange s={s} />
				</div>
				<span className="text-muted-foreground text-[11px]">
					Best {s.best != null ? `#${s.best}` : "—"}
				</span>
				<span className="text-muted-foreground ml-auto text-[11px]">
					{checking
						? "Checking…"
						: track.lastCheckedAt
							? `Checked ${formatRelative(track.lastCheckedAt)}`
							: "Not checked yet"}
				</span>
			</div>

			{track.lastError ? (
				<div className="text-[11px] text-red-600 dark:text-red-400">
					Last check failed: {track.lastError}
				</div>
			) : null}

			{s.checks >= 2 ? (
				<div className="flex flex-col gap-1">
					<AreaChart
						data={track.history.map((p) => ({
							x: p.t,
							y: p.rank == null ? OUT_OF_RANGE : -p.rank,
						}))}
						height={96}
						zeroBaseline={false}
						formatY={formatRankAxis}
						formatX={formatDay}
						valueLabel="rank"
						ariaLabel={`Search rank history for ${track.query}`}
					/>
					<span className="text-muted-foreground text-[10px]">
						Higher on the chart = better position (#1 is the top result).
					</span>
				</div>
			) : checked ? (
				<span className="text-muted-foreground text-[10px]">
					The chart appears after the next check.
				</span>
			) : null}
		</div>
	);
}
