/**
 * Overview tab: channel card + history, controversial keywords (free),
 * SEO score, estimated earnings, channel/video tags (with search ranks) and
 * channel stats.
 */
import {
	CONTROVERSIAL_CATEGORY_LABELS,
	type ControversialCategory,
	type ControversialMatch,
	findControversialKeywords,
} from "@growtube/shared/controversial";
import {
	formatAge,
	formatCompact,
	formatNumber,
	formatOutlier,
} from "@growtube/shared/format";
import {
	computeAverage,
	computeBestPostingSlots,
	computeChannelBaseline,
	computeUploadsPerWeek,
	type PostingSlot,
} from "@growtube/shared/metrics";
import type { SeoResult } from "@growtube/shared/seo";
import {
	Check,
	ChevronDown,
	ChevronUp,
	Download,
	ListOrdered,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AreaChart } from "@/components/common/AreaChart";
import { CopyButton } from "@/components/common/CopyButton";
import { tagsLength } from "@/lib/ai/coach";
import { ext, server, yt } from "@/lib/client";
import { transcriptToText } from "@/lib/youtube/transcript";
import type { ChannelInfo, VideoDetails } from "@/lib/youtube/types";
import { isPublicVideo } from "@/lib/youtube/visibility";

import { errorMessage, isServerUnavailable, useAsync } from "../common/async";
import { downloadText, slugify } from "../common/download";
import {
	Card,
	ErrorNote,
	Note,
	Segmented,
	Skeleton,
	Spinner,
} from "../common/ui";
import type { WatchData } from "./data";
import { EarningsCard } from "./EarningsCard";

export type TagRanks = Record<string, number | null>;

/** CopyButton sits next to pill buttons here, so it gets the same shape. */
const PILL = { borderRadius: "var(--ovq-radius-pill)" } as const;

export function OverviewTab({
	w,
	onTagRanks,
}: {
	w: WatchData;
	onTagRanks: (ranks: TagRanks) => void;
}) {
	const d = w.details.data;
	if (!d) {
		return w.details.error ? (
			<ErrorNote error={w.details.error} onRetry={w.details.reload} />
		) : (
			<div style={{ display: "grid", gap: 10 }}>
				<Skeleton height={90} radius="card" />
				<Skeleton height={120} radius="card" />
				<Skeleton height={120} radius="card" />
			</div>
		);
	}
	return (
		<div>
			<ChannelCard w={w} />
			<ControversialCard details={d} />
			{w.metrics && <SeoCard seo={w.metrics.seo} />}
			<ChaptersCard details={d} />
			<EarningsCard details={d} typicalViews={w.metrics?.baseline ?? null} />
			<ChannelTagsCard w={w} />
			<VideoTagsCard details={d} onTagRanks={onTagRanks} />
			<ChannelStatsCard w={w} />
		</div>
	);
}

// ---------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------

function ChannelCard({ w }: { w: WatchData }) {
	const ch = w.channel.data;
	const [metric, setMetric] = useState<"subs" | "views">("subs");
	const history = useAsync(
		() => server.getChannelHistory(ch?.channelId as string),
		[ch?.channelId],
		!!ch,
	);

	if (!ch) {
		return (
			<Card>
				{w.channel.error ? (
					<ErrorNote
						error={w.channel.error}
						onRetry={w.channel.reload}
						prefix="Couldn't load the channel."
					/>
				) : (
					<div className="ovq-channel">
						<Skeleton width={44} height={44} radius="round" />
						<div style={{ flex: 1, display: "grid", gap: 6 }}>
							<Skeleton width="60%" />
							<Skeleton width="40%" height={12} />
						</div>
					</div>
				)}
			</Card>
		);
	}

	const points = (history.data?.points ?? [])
		.map((p) => ({
			x: Date.parse(`${p.day}T00:00:00Z`),
			y: metric === "subs" ? p.subscribers : p.totalViews,
		}))
		.filter((p) => p.y != null);

	return (
		<Card>
			<div className="ovq-channel">
				{ch.avatarUrl ? (
					<img
						className="ovq-avatar"
						src={ch.avatarUrl}
						alt=""
						width={44}
						height={44}
						loading="lazy"
					/>
				) : (
					<span className="ovq-avatar" aria-hidden="true" />
				)}
				<div style={{ minWidth: 0 }}>
					<div className="ovq-channel-name" title={ch.title}>
						{ch.title}
					</div>
					{ch.handle && <div className="ovq-small ovq-muted">{ch.handle}</div>}
				</div>
			</div>
			<div className="ovq-chips" style={{ marginTop: 10 }}>
				{ch.videoCount != null && (
					<span className="ovq-chip">{formatNumber(ch.videoCount)} videos</span>
				)}
				{ch.joinedAt && (
					<span className="ovq-chip" title={`Joined ${ch.joinedAt}`}>
						{formatAge(ch.joinedAt)}
					</span>
				)}
				{ch.subscribers != null && (
					<span className="ovq-chip">
						{formatCompact(ch.subscribers, 2)} subscribers
					</span>
				)}
				{ch.country && <span className="ovq-chip">{ch.country}</span>}
			</div>

			<div className="ovq-chart-head" style={{ marginTop: 12 }}>
				<span className="ovq-small ovq-muted">Channel growth</span>
				<Segmented
					label="Channel metric"
					options={[
						{ id: "subs", label: "Subs" },
						{ id: "views", label: "Views" },
					]}
					value={metric}
					onChange={setMetric}
				/>
			</div>
			{history.loading ? (
				<Skeleton height={110} radius="inner" />
			) : points.length >= 2 ? (
				<AreaChart
					data={points}
					height={110}
					zeroBaseline={false}
					valueLabel={metric === "subs" ? "subscribers" : "views"}
					formatX={(x) =>
						new Date(x).toLocaleDateString(undefined, {
							month: "short",
							day: "numeric",
						})
					}
					ariaLabel={
						metric === "subs"
							? "Subscribers over time"
							: "Channel views over time"
					}
				/>
			) : (
				<>
					<dl className="ovq-kv">
						<dt>Subscribers</dt>
						<dd>
							{ch.subscribers != null
								? formatCompact(ch.subscribers, 2)
								: "Hidden"}
						</dd>
						<dt>Total views</dt>
						<dd>{ch.totalViews != null ? formatNumber(ch.totalViews) : "—"}</dd>
					</dl>
					{history.error && isServerUnavailable(history.error) ? (
						<Note tone="warn">
							Channel history comes from the GrowTube server, which isn't
							reachable right now.
						</Note>
					) : (
						<Note>Tracking started; daily history fills in from here.</Note>
					)}
				</>
			)}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Controversial keywords (free, unlimited)
// ---------------------------------------------------------------------------

type CategoryGroup = {
	category: ControversialCategory;
	total: number;
	terms: ControversialMatch[];
};

function groupMatches(matches: ControversialMatch[]): CategoryGroup[] {
	const groups = new Map<ControversialCategory, CategoryGroup>();
	for (const m of matches) {
		const g = groups.get(m.category) ?? {
			category: m.category,
			total: 0,
			terms: [],
		};
		g.total += m.count;
		g.terms.push(m);
		groups.set(m.category, g);
	}
	return [...groups.values()].sort((a, b) => b.total - a.total);
}

function ControversialCard({ details }: { details: VideoDetails }) {
	const transcript = useAsync(
		() => yt.getTranscript(details.videoId),
		[details.videoId],
	);
	const transcriptText = transcript.data
		? transcriptToText(transcript.data.segments, { timestamps: false })
		: null;
	const groups = useMemo(
		() =>
			groupMatches(
				findControversialKeywords(
					details.title,
					details.description,
					details.keywords,
					transcriptText,
				),
			),
		[details, transcriptText],
	);
	const total = groups.reduce((n, g) => n + g.total, 0);
	const sources = [
		"title",
		"description",
		"tags",
		...(transcriptText ? ["transcript"] : []),
	].join(", ");

	return (
		<Card
			title="Controversial Keywords"
			actions={
				groups.length ? (
					<span className="ovq-pill" style={{ color: "var(--ovq-warn)" }}>
						{total} match{total === 1 ? "" : "es"}
					</span>
				) : null
			}
		>
			{groups.length === 0 ? (
				<Note tone="good">
					No advertiser-unfriendly keywords found in the {sources}.
				</Note>
			) : (
				groups.map((g) => (
					<div key={g.category} className="ovq-cat">
						<div className="ovq-cat-title">
							{CONTROVERSIAL_CATEGORY_LABELS[g.category]}
							<span className="ovq-pill" style={{ height: 18 }}>
								{g.total}
							</span>
						</div>
						<div className="ovq-chips">
							{g.terms.map((t) => (
								<span key={t.term} className="ovq-chip">
									{t.term}
									{t.count > 1 && <span className="ovq-muted">×{t.count}</span>}
								</span>
							))}
						</div>
					</div>
				))
			)}
			<div
				className="ovq-small ovq-muted"
				style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}
			>
				{transcript.loading ? (
					<>
						<Spinner label="Scanning transcript" /> Scanning the transcript…
					</>
				) : transcriptText ? (
					`Scanned the ${sources}. A match means "double-check the context", not "demonetized".`
				) : transcript.error ? (
					<span>
						Scanned the {sources}. Couldn't load the transcript.{" "}
						<button
							type="button"
							className="ovq-link-btn"
							onClick={transcript.reload}
						>
							Retry
						</button>
					</span>
				) : (
					`Scanned the ${sources} (no transcript available). A match means "double-check the context".`
				)}
			</div>
		</Card>
	);
}

// ---------------------------------------------------------------------------
// SEO score
// ---------------------------------------------------------------------------

function SeoCard({ seo }: { seo: SeoResult }) {
	const [open, setOpen] = useState(false);
	const passed = seo.checks.filter((c) => c.passed).length;
	const tone =
		seo.score >= 75
			? "var(--ovq-good)"
			: seo.score >= 50
				? "var(--ovq-warn)"
				: "var(--ovq-danger)";
	return (
		<Card title="SEO score">
			<div className="ovq-seo-score">
				<span style={{ color: tone }}>{seo.score.toFixed(1)}</span>
				<small>/100</small>
			</div>
			<div className="ovq-meter" aria-hidden="true">
				<span
					style={{ width: `${Math.max(2, seo.score)}%`, background: tone }}
				/>
			</div>
			<div className="ovq-small ovq-muted">
				{seo.keyword ? (
					<>
						Target keyword:{" "}
						<strong style={{ color: "var(--ovq-text)" }}>{seo.keyword}</strong>{" "}
						(first tag)
					</>
				) : (
					"No tags, so there's no target keyword to check against."
				)}
			</div>
			<button
				type="button"
				className="ovq-link-btn"
				style={{ marginTop: 8 }}
				aria-expanded={open}
				onClick={() => setOpen((v) => !v)}
			>
				{open ? (
					<ChevronUp size={14} aria-hidden="true" />
				) : (
					<ChevronDown size={14} aria-hidden="true" />
				)}
				{open
					? "Hide checklist"
					: `Show checklist (${passed}/${seo.checks.length} passed)`}
			</button>
			{open && (
				<ul className="ovq-checklist" style={{ marginTop: 6 }}>
					{seo.checks.map((c) => (
						<li key={c.id}>
							{c.passed ? (
								<Check
									size={15}
									className="ovq-check-pass"
									aria-label="Passed"
								/>
							) : (
								<X
									size={15}
									className="ovq-check-fail"
									aria-label="Not passed"
								/>
							)}
							<div style={{ minWidth: 0 }}>
								<div>
									{c.label}{" "}
									<span className="ovq-muted ovq-small">+{c.weight}</span>
								</div>
								{!c.passed && (
									<div className="ovq-small ovq-muted">{c.hint}</div>
								)}
							</div>
						</li>
					))}
				</ul>
			)}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Chapters & description (opens the side panel's Script tool)
// ---------------------------------------------------------------------------

function ChaptersCard({ details }: { details: VideoDetails }) {
	const [error, setError] = useState<string | null>(null);
	const open = () => {
		setError(null);
		// Must run in the click handler: opening the side panel needs the gesture.
		ext
			.openSidePanel({
				videoId: details.videoId,
				channelId: details.channelId || undefined,
				// Alias of the Script tool that opens its "Chapters & description" mode.
				tool: "chapters",
			})
			.catch((e: unknown) => setError(errorMessage(e)));
	};
	return (
		<Card title="Chapters & description">
			<div className="ovq-small ovq-muted" style={{ marginBottom: 8 }}>
				Draft YouTube chapters, an SEO description and a pinned comment from
				this video's captions, with your own AI provider.
			</div>
			<button type="button" className="ovq-btn small primary" onClick={open}>
				<ListOrdered size={13} aria-hidden="true" /> Generate in side panel
			</button>
			{error && <Note tone="error">{error}</Note>}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function ChannelTagsCard({ w }: { w: WatchData }) {
	const ch: ChannelInfo | undefined = w.channel.data;
	if (!ch) return null;
	const tags = ch.keywords;
	return (
		<Card
			title="Channel Tags"
			actions={
				tags.length ? (
					<CopyButton
						text={tags.join(", ")}
						label="Copy"
						title="Copy channel tags"
						style={PILL}
					/>
				) : null
			}
		>
			{tags.length ? (
				<div className="ovq-chips">
					{tags.map((t) => (
						<span key={t} className="ovq-chip">
							{t}
						</span>
					))}
				</div>
			) : (
				<div className="ovq-small ovq-muted">
					This channel has no public channel tags.
				</div>
			)}
		</Card>
	);
}

const RANKED_TAGS = 8;

function VideoTagsCard({
	details,
	onTagRanks,
}: {
	details: VideoDetails;
	onTagRanks: (ranks: TagRanks) => void;
}) {
	const tags = details.keywords;
	const top = useMemo(() => tags.slice(0, RANKED_TAGS), [tags]);
	const ranks = useAsync(
		() => yt.findVideoRanks(details.videoId, top),
		[details.videoId, top.join("\u0000")],
		top.length > 0,
	);
	useEffect(() => {
		if (ranks.data) onTagRanks(ranks.data);
	}, [ranks.data, onTagRanks]);

	const rankOf = (tag: string): number | null =>
		ranks.data?.[tag.trim()] ?? null;
	const text = tags.join(", ");

	return (
		<Card
			title="Video Tags"
			actions={
				tags.length ? (
					<>
						<CopyButton
							text={text}
							label="Copy all"
							title="Copy all tags"
							style={PILL}
						/>
						<button
							type="button"
							className="ovq-btn small ghost"
							style={{ border: "1px solid var(--ovq-border)" }}
							onClick={() =>
								downloadText(`${slugify(details.title)}-tags.txt`, `${text}\n`)
							}
						>
							<Download size={13} aria-hidden="true" /> Download
						</button>
					</>
				) : null
			}
		>
			{tags.length ? (
				<>
					<div className="ovq-chips">
						{tags.map((t, i) => {
							const rank = i < RANKED_TAGS ? rankOf(t) : null;
							return (
								<span key={`${t}-${i}`} className="ovq-chip">
									{t}
									{rank != null && (
										<span
											className={rank <= 3 ? "ovq-rank top" : "ovq-rank"}
											title={`This video ranks #${rank} in YouTube search for "${t}"`}
										>
											#{rank}
										</span>
									)}
								</span>
							);
						})}
					</div>
					<div
						className="ovq-small ovq-muted"
						style={{
							marginTop: 8,
							display: "flex",
							gap: 6,
							alignItems: "center",
						}}
					>
						{ranks.loading ? (
							<>
								<Spinner label="Checking search ranks" /> Checking search ranks
								for the first {top.length} tags…
							</>
						) : (
							<>
								{tags.length} tags · {tagsLength(tags)}/500 characters
								{ranks.data
									? " · #N = this video's position in YouTube search for that tag"
									: ""}
							</>
						)}
					</div>
				</>
			) : (
				<div className="ovq-small ovq-muted">
					This video has no public tags.
				</div>
			)}
		</Card>
	);
}

// ---------------------------------------------------------------------------
// Channel stats
// ---------------------------------------------------------------------------

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function slotLabel(slot: PostingSlot): string {
	const d = new Date();
	d.setHours(slot.hour, 0, 0, 0);
	const hour = d.toLocaleTimeString(undefined, { hour: "numeric" });
	return `${WEEKDAYS[slot.weekday] ?? ""} · ${hour}`;
}

type Upload = {
	views: number | null;
	publishedAt: string | null;
	exactDate: boolean;
};

/**
 * Recent uploads of the same format; exact publish times for the newest 20.
 * `crowdsource`: false while the watched video isn't public, so its channel's
 * uploads don't reveal that it was opened.
 */
async function loadUploads(
	channelId: string,
	format: "long" | "short",
	crowdsource: boolean,
): Promise<Upload[]> {
	const videos = await yt.getChannelVideos(channelId, {
		tab: format === "short" ? "shorts" : "videos",
		limit: 30,
	});
	const usable = videos.filter((v) => !v.isLive && !v.isUpcoming);
	const ids = usable.slice(0, 20).map((v) => v.videoId);
	const exact = ids.length
		? await yt
				.getVideoDetailsBatch(ids, "basic", { crowdsource })
				.catch(() => ({}) as Record<string, VideoDetails | null>)
		: {};
	return usable.map((v) => {
		const e = exact[v.videoId];
		return {
			views: e?.views ?? v.views,
			publishedAt: e?.publishedAt ?? v.publishedAt,
			exactDate: !!e?.publishedAt,
		};
	});
}

function ChannelStatsCard({ w }: { w: WatchData }) {
	const channelId = w.details.data?.channelId || null;
	const format = w.metrics?.format ?? "long";
	const crowdsource = isPublicVideo(w.details.data);
	const uploads = useAsync(
		() => loadUploads(channelId as string, format, crowdsource),
		[channelId, format, crowdsource],
		!!channelId,
	);

	const stats = useMemo(() => {
		const list = uploads.data ?? [];
		const views = list
			.map((u) => u.views)
			.filter((v): v is number => v != null);
		const baseline = w.metrics?.baseline ?? computeChannelBaseline(views);
		const dated = list.filter(
			(u): u is Upload & { publishedAt: string } => !!u.publishedAt,
		);
		const exact = dated.filter((u) => u.exactDate && u.views != null) as {
			publishedAt: string;
			views: number;
		}[];
		return {
			count: views.length,
			average: computeAverage(views),
			baseline,
			perWeek: computeUploadsPerWeek(dated.map((u) => u.publishedAt)),
			slots: computeBestPostingSlots(exact, baseline, 3),
			exactCount: exact.length,
		};
	}, [uploads.data, w.metrics?.baseline]);

	const maxOutlier = Math.max(...stats.slots.map((s) => s.avgOutlier), 0.0001);
	const label = format === "short" ? "Shorts" : "uploads";

	return (
		<Card title="Channel stats">
			{uploads.loading || (!uploads.data && !uploads.error) ? (
				<div style={{ display: "grid", gap: 8 }}>
					<Skeleton width="80%" />
					<Skeleton width="65%" />
					<Skeleton width="70%" />
				</div>
			) : uploads.error ? (
				<ErrorNote
					error={uploads.error}
					onRetry={uploads.reload}
					prefix="Couldn't load recent uploads."
				/>
			) : stats.count === 0 ? (
				<div className="ovq-small ovq-muted">No recent {label} to analyze.</div>
			) : (
				<>
					<dl className="ovq-kv">
						<dt>
							Average views (last {stats.count} {label})
						</dt>
						<dd>{formatCompact(stats.average, 1)}</dd>
						<dt>Typical views (median)</dt>
						<dd>{formatCompact(stats.baseline, 1)}</dd>
						<dt>Uploads per week</dt>
						<dd>{stats.perWeek != null ? stats.perWeek.toFixed(1) : "—"}</dd>
					</dl>
					<div className="ovq-cat" style={{ marginTop: 12 }}>
						<div className="ovq-cat-title">
							Best posting times (your local time)
						</div>
						{stats.slots.length ? (
							<div className="ovq-slots">
								{stats.slots.map((s) => (
									<div key={`${s.weekday}-${s.hour}`} className="ovq-slot">
										<span style={{ width: 92, flexShrink: 0, fontWeight: 500 }}>
											{slotLabel(s)}
										</span>
										<span className="ovq-slot-bar" aria-hidden="true">
											<span
												style={{
													width: `${(s.avgOutlier / maxOutlier) * 100}%`,
												}}
											/>
										</span>
										<span
											className="ovq-small ovq-muted"
											style={{ width: 92, textAlign: "right", flexShrink: 0 }}
										>
											{formatOutlier(s.avgOutlier)} · {s.count}{" "}
											{s.count === 1 ? "upload" : "uploads"}
										</span>
									</div>
								))}
							</div>
						) : (
							<div className="ovq-small ovq-muted">
								Not enough dated uploads yet.
							</div>
						)}
						<div className="ovq-small ovq-muted" style={{ marginTop: 6 }}>
							Ranked by average outlier score of the last {stats.exactCount}{" "}
							{label} published in each slot.
						</div>
					</div>
				</>
			)}
		</Card>
	);
}
