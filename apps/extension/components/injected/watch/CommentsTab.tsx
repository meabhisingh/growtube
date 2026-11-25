/**
 * Comments tab: the video's top comments (loaded anonymously from YouTube in
 * the background) and, on request, an AI analysis of them: viewer questions,
 * content requests turned into video ideas, complaints, praise and a
 * sentiment split.
 *
 * Privacy: comment text is never sent to the GrowTube server. It goes to the
 * user's own AI provider only when they click "Analyze comments", without
 * author names, clipped to a fixed budget (lib/ai/comment-insights.ts).
 */
import { formatCompact } from "@growtube/shared/format";
import {
	Download,
	Heart,
	MessageCircle,
	PanelRight,
	Pin,
	RefreshCw,
	Settings,
	Sparkles,
	ThumbsUp,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common/CopyButton";
import type { CommentInsights } from "@/lib/ai/comment-insights";
import { ai, ext, yt } from "@/lib/client";
import { aiProvider } from "@/lib/settings";
import type {
	CommentSort,
	VideoComment,
	VideoComments,
	VideoDetails,
} from "@/lib/youtube/types";

import { errorCode, errorMessage, useAsync } from "../common/async";
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

/** Comments loaded per sort order (the background caps it at 200). */
const LOAD_LIMIT = 150;
/** Comments shown before "Show more". */
const PAGE = 20;
/** Comments shown collapsed beyond this many characters. */
const LONG_COMMENT = 280;

const SORTS: readonly { id: CommentSort; label: string }[] = [
	{ id: "top", label: "Top" },
	{ id: "newest", label: "Newest" },
];

/** CopyButton sits next to pill buttons here, so it gets the same shape. */
const PILL = { borderRadius: "var(--ovq-radius-pill)" } as const;

export function CommentsTab({ w }: { w: WatchData }) {
	const d = w.details.data;
	const [sort, setSort] = useState<CommentSort>("top");
	const [force, setForce] = useState(false);
	const noComments = !!d && d.isUpcoming;
	const comments = useAsync(
		() =>
			yt
				.getComments(w.videoId, { sort, limit: LOAD_LIMIT, force })
				.finally(() => setForce(false)),
		[w.videoId, sort],
		!!d && !noComments,
	);

	if (!d) {
		return w.details.error ? (
			<ErrorNote error={w.details.error} onRetry={w.details.reload} />
		) : (
			<div style={{ display: "grid", gap: 8 }}>
				<Skeleton height={44} radius="card" />
				<Skeleton height={80} radius="card" />
			</div>
		);
	}

	if (noComments) {
		return (
			<Note>
				This {d.isLiveContent ? "stream" : "premiere"} hasn't started yet, so
				there are no comments to read. Come back once it's live or over.
			</Note>
		);
	}

	const data = comments.data;
	const total = data?.total ?? d.comments;
	const exact = data ? data.totalExact : d.commentsExact;

	return (
		<div className="ovq-comments-tab">
			<div className="ovq-comments-head">
				<div>
					<div className="ovq-stat-label">
						<MessageCircle size={13} aria-hidden="true" /> Comments
					</div>
					<div className="ovq-stat-value">
						{total != null
							? exact
								? total.toLocaleString()
								: `~${formatCompact(total)}`
							: data?.disabled
								? "Off"
								: "–"}
					</div>
				</div>
				<div className="ovq-comments-head-actions">
					<Segmented
						options={SORTS}
						value={sort}
						onChange={setSort}
						label="Sort comments"
					/>
					<button
						type="button"
						className="ovq-icon-btn"
						aria-label="Reload comments"
						title="Reload comments"
						disabled={comments.loading}
						onClick={() => {
							setForce(true);
							comments.reload();
						}}
					>
						<RefreshCw size={15} aria-hidden="true" />
					</button>
				</div>
			</div>

			{comments.loading && !data ? (
				<div style={{ display: "grid", gap: 8 }}>
					<Skeleton height={60} radius="inner" />
					<Skeleton height={60} radius="inner" />
					<Skeleton height={60} radius="inner" />
				</div>
			) : comments.error ? (
				<ErrorNote
					error={comments.error}
					onRetry={comments.reload}
					prefix="Couldn't load the comments."
				/>
			) : data ? (
				<CommentsBody details={d} data={data} loading={comments.loading} />
			) : null}
		</div>
	);
}

function CommentsBody({
	details,
	data,
	loading,
}: {
	details: VideoDetails;
	data: VideoComments;
	loading: boolean;
}) {
	if (data.disabled && !data.comments.length) {
		return <Note>Comments are turned off for this video.</Note>;
	}
	if (!data.comments.length) {
		return (details.isLive || data.isLive) && !details.isUpcoming ? (
			<Note>
				This is a live stream: viewers are talking in the live chat. Comments
				show up here after the stream ends, if the creator keeps them on.
			</Note>
		) : (
			<Note>No comments yet.</Note>
		);
	}
	return (
		<>
			<InsightsCard details={details} data={data} />
			<CommentList data={data} loading={loading} />
		</>
	);
}

// ---------------------------------------------------------------------------
// Comment list
// ---------------------------------------------------------------------------

function CommentList({
	data,
	loading,
}: {
	data: VideoComments;
	loading: boolean;
}) {
	const [shown, setShown] = useState(PAGE);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset per list
	useEffect(() => setShown(PAGE), [data.sort, data.fetchedAt]);
	const list = data.comments.slice(0, shown);
	return (
		<Card
			title={`${data.sort === "top" ? "Top" : "Newest"} comments`}
			actions={
				<span className="ovq-small ovq-muted">
					{loading ? <Spinner label="Loading comments" /> : null}
					{data.comments.length} loaded
					{data.hasMore ? " (more on YouTube)" : ""}
				</span>
			}
		>
			<ul className="ovq-comment-list">
				{list.map((c) => (
					<CommentItem key={c.id} c={c} />
				))}
			</ul>
			{shown < data.comments.length && (
				<button
					type="button"
					className="ovq-btn small"
					style={{ marginTop: 8 }}
					onClick={() => setShown((n) => n + PAGE)}
				>
					Show more ({data.comments.length - shown} left)
				</button>
			)}
		</Card>
	);
}

function CommentItem({ c }: { c: VideoComment }) {
	const long = c.text.length > LONG_COMMENT;
	const [open, setOpen] = useState(false);
	return (
		<li className="ovq-comment">
			<div className="ovq-comment-meta">
				<span
					className={
						c.isCreator ? "ovq-comment-author creator" : "ovq-comment-author"
					}
				>
					{c.author}
				</span>
				{c.publishedText && (
					<span className="ovq-muted">{c.publishedText}</span>
				)}
				{c.isPinned && (
					<span className="ovq-pill accent" title="Pinned by the creator">
						<Pin size={11} aria-hidden="true" /> Pinned
					</span>
				)}
				{c.isHearted && (
					<span className="ovq-pill" title="Hearted by the creator">
						<Heart
							size={11}
							aria-hidden="true"
							fill="currentColor"
							style={{ color: "var(--ovq-viral)" }}
						/>{" "}
						Hearted
					</span>
				)}
			</div>
			<div
				className={
					long && !open ? "ovq-comment-text clamped" : "ovq-comment-text"
				}
			>
				{c.text}
			</div>
			<div className="ovq-comment-stats ovq-muted">
				<span title={`${c.likes.toLocaleString()} likes`}>
					<ThumbsUp size={12} aria-hidden="true" /> {formatCompact(c.likes)}
				</span>
				{c.replies > 0 && (
					<span title={`${c.replies.toLocaleString()} replies`}>
						<MessageCircle size={12} aria-hidden="true" />{" "}
						{formatCompact(c.replies)}
					</span>
				)}
				{long && (
					<button
						type="button"
						className="ovq-link-btn"
						onClick={() => setOpen((o) => !o)}
						aria-expanded={open}
					>
						{open ? "Show less" : "Read more"}
					</button>
				)}
			</div>
		</li>
	);
}

// ---------------------------------------------------------------------------
// AI insights
// ---------------------------------------------------------------------------

type Run =
	| { state: "idle" }
	| { state: "running" }
	| { state: "done"; insights: CommentInsights; used: number; at: string }
	| { state: "error"; error: unknown };

function InsightsCard({
	details,
	data,
}: {
	details: VideoDetails;
	data: VideoComments;
}) {
	const status = useAsync(() => ai.status(), []);
	const reloadStatus = status.reload;
	// Re-check when the provider is configured in the options page.
	useEffect(() => aiProvider.watch(() => reloadStatus()), [reloadStatus]);
	const [run, setRun] = useState<Run>({ state: "idle" });
	const [uiError, setUiError] = useState<string | null>(null);

	const analyze = async () => {
		if (run.state === "running") return;
		setUiError(null);
		setRun({ state: "running" });
		const input = data.comments.map((c) => ({
			text: c.text,
			likes: c.likes,
			replies: c.replies,
			isCreator: c.isCreator,
			isPinned: c.isPinned,
		}));
		try {
			const insights = await ai.generate("commentInsights", {
				videoTitle: details.title,
				channelTitle: details.channelTitle || undefined,
				totalComments: data.total ?? details.comments,
				comments: input,
			});
			setRun({
				state: "done",
				insights,
				used: input.length,
				at: new Date().toISOString(),
			});
		} catch (error) {
			setRun({ state: "error", error });
		}
	};

	const markdown = useMemo(
		() =>
			run.state === "done"
				? insightsToMarkdown(details, run.insights, run.used)
				: "",
		[run, details],
	);

	const planIdea = (title: string, request: string) => {
		setUiError(null);
		// No await before this call: the side panel needs the click's user gesture.
		ext
			.openSidePanel({
				videoId: details.videoId,
				channelId: details.channelId || undefined,
				tool: "coach",
				prefill: `Help me plan this video: "${title}". Viewers of my video "${details.title}" asked for it in the comments: ${request}`,
			})
			.catch((e: unknown) => setUiError(errorMessage(e)));
	};

	if (status.loading && !status.data) {
		return <Skeleton height={64} radius="card" />;
	}

	const notReady = (status.data && !status.data.ready) || status.error;
	if (notReady) {
		return (
			<div className="ovq-cta">
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						fontWeight: 600,
					}}
				>
					<Sparkles
						size={16}
						aria-hidden="true"
						style={{ color: "var(--ovq-accent)" }}
					/>
					Connect your AI to analyze comments
				</div>
				<div className="ovq-small ovq-muted">
					{status.data?.problem ??
						(status.error ? errorMessage(status.error) : null) ??
						"Add an AI provider in Settings."}{" "}
					Find viewer questions, video ideas and complaints in seconds. Use your
					own key (OpenAI, OpenRouter, Groq, Gemini…) or a free local model with
					Ollama or LM Studio. No limits.
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						className="ovq-btn primary small"
						onClick={() => void ext.openOptions("ai")}
					>
						<Settings size={13} aria-hidden="true" /> Open AI settings
					</button>
					<button
						type="button"
						className="ovq-btn small"
						onClick={reloadStatus}
					>
						Check again
					</button>
				</div>
			</div>
		);
	}

	const code = run.state === "error" ? errorCode(run.error) : undefined;
	const needsSettings = code === "NOT_CONFIGURED" || code === "PERMISSION";

	return (
		<Card
			title="Comment insights"
			className="ovq-insights"
			actions={
				run.state === "done" ? (
					<>
						<CopyButton
							text={markdown}
							label="Copy"
							title="Copy the analysis as Markdown"
							style={PILL}
						/>
						<button
							type="button"
							className="ovq-btn small ghost"
							style={{ border: "1px solid var(--ovq-border)" }}
							onClick={() =>
								downloadText(
									`${slugify(details.title)}-comment-insights.md`,
									markdown,
									"text/markdown",
								)
							}
						>
							<Download size={13} aria-hidden="true" /> .md
						</button>
					</>
				) : null
			}
		>
			{run.state !== "done" && (
				<div style={{ display: "grid", gap: 8 }}>
					<div className="ovq-small ovq-muted">
						Ask your AI what the {data.comments.length} loaded comments are
						saying: questions to answer, videos viewers want, complaints and
						praise. Comment text goes only to your AI provider (
						{status.data?.providerLabel ?? "your provider"}), never to GrowTube.
					</div>
					<div>
						<button
							type="button"
							className="ovq-btn primary small"
							disabled={run.state === "running"}
							onClick={() => void analyze()}
						>
							{run.state === "running" ? (
								<>
									<Spinner label="Analyzing" /> Analyzing…
								</>
							) : (
								<>
									<Sparkles size={13} aria-hidden="true" /> Analyze comments
								</>
							)}
						</button>
					</div>
				</div>
			)}

			{run.state === "error" && (
				<Note tone="error">
					{errorMessage(run.error)}{" "}
					<button
						type="button"
						className="ovq-link-btn"
						onClick={() => void analyze()}
					>
						Retry
					</button>
					{needsSettings && (
						<>
							{" · "}
							<button
								type="button"
								className="ovq-link-btn"
								onClick={() => void ext.openOptions("ai")}
							>
								Open AI settings
							</button>
						</>
					)}
				</Note>
			)}

			{run.state === "done" && (
				<InsightsView
					insights={run.insights}
					used={run.used}
					onPlan={planIdea}
					onRerun={() => void analyze()}
				/>
			)}
			{uiError && <Note tone="error">{uiError}</Note>}
		</Card>
	);
}

function InsightsView({
	insights: x,
	used,
	onPlan,
	onRerun,
}: {
	insights: CommentInsights;
	used: number;
	onPlan: (title: string, request: string) => void;
	onRerun: () => void;
}) {
	const s = x.sentiment;
	const hasSentiment = s.positive + s.neutral + s.negative > 0;
	const empty =
		!x.questions.length &&
		!x.requests.length &&
		!x.complaints.length &&
		!x.praise.length;
	return (
		<div className="ovq-insights-body">
			{x.summary && <p className="ovq-insights-summary">{x.summary}</p>}
			{hasSentiment && (
				<div>
					<div
						className="ovq-sentiment"
						role="img"
						aria-label={`Sentiment: ${s.positive}% positive, ${s.neutral}% neutral, ${s.negative}% negative`}
					>
						<span className="pos" style={{ width: `${s.positive}%` }} />
						<span className="neu" style={{ width: `${s.neutral}%` }} />
						<span className="neg" style={{ width: `${s.negative}%` }} />
					</div>
					<div className="ovq-sentiment-legend ovq-small">
						<span>
							<i className="pos" /> {s.positive}% positive
						</span>
						<span>
							<i className="neu" /> {s.neutral}% neutral
						</span>
						<span>
							<i className="neg" /> {s.negative}% negative
						</span>
					</div>
				</div>
			)}

			{empty && (
				<Note>
					Nothing stood out in these comments: no questions, requests or
					complaints worth acting on.
				</Note>
			)}

			{x.requests.length > 0 && (
				<InsightSection title="Video ideas from requests">
					{x.requests.map((r) => (
						<li key={`${r.request}-${r.videoTitle}`} className="ovq-insight">
							<div className="ovq-insight-title">{r.videoTitle}</div>
							<div className="ovq-small ovq-muted">
								Requested: {r.request}
								<Mentions n={r.mentions} />
							</div>
							{r.why && <div className="ovq-small">{r.why}</div>}
							<div>
								<button
									type="button"
									className="ovq-btn small"
									onClick={() => onPlan(r.videoTitle, r.request)}
								>
									<PanelRight size={13} aria-hidden="true" /> Plan with AI Coach
								</button>
							</div>
						</li>
					))}
				</InsightSection>
			)}

			{x.questions.length > 0 && (
				<InsightSection title="Viewer questions">
					{x.questions.map((q) => (
						<li key={q.question} className="ovq-insight">
							<div className="ovq-insight-title">
								{q.question}
								<Mentions n={q.mentions} />
							</div>
							{q.answerIdea && (
								<div className="ovq-small ovq-muted">{q.answerIdea}</div>
							)}
						</li>
					))}
				</InsightSection>
			)}

			{x.complaints.length > 0 && (
				<InsightSection title="Complaints & criticism">
					{x.complaints.map((c) => (
						<li key={c.point} className="ovq-insight">
							<div className="ovq-insight-title">
								{c.point}
								<Mentions n={c.mentions} />
							</div>
							{c.suggestion && (
								<div className="ovq-small ovq-muted">Fix: {c.suggestion}</div>
							)}
						</li>
					))}
				</InsightSection>
			)}

			{x.praise.length > 0 && (
				<InsightSection title="What viewers love">
					{x.praise.map((p) => (
						<li key={p.theme} className="ovq-insight">
							<div className="ovq-insight-title">
								{p.theme}
								<Mentions n={p.mentions} />
							</div>
							{p.detail && (
								<div className="ovq-small ovq-muted">{p.detail}</div>
							)}
						</li>
					))}
				</InsightSection>
			)}

			<div className="ovq-insights-foot ovq-small ovq-muted">
				Based on {used} comments. AI can be wrong: check the comments before
				acting.
				<button type="button" className="ovq-link-btn" onClick={onRerun}>
					<RefreshCw size={12} aria-hidden="true" /> Analyze again
				</button>
			</div>
		</div>
	);
}

function InsightSection({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="ovq-insight-section">
			<h4 className="ovq-insight-heading">{title}</h4>
			<ul className="ovq-insight-list">{children}</ul>
		</section>
	);
}

function Mentions({ n }: { n: number }) {
	if (n <= 1) return null;
	return (
		<span className="ovq-pill" style={{ marginLeft: 6 }} title="Comments">
			×{n}
		</span>
	);
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

const mdLine = (s: string) => s.replace(/\s+/g, " ").trim();
const mentions = (n: number) => (n > 1 ? ` (×${n})` : "");

export function insightsToMarkdown(
	details: Pick<VideoDetails, "title" | "videoId" | "channelTitle">,
	x: CommentInsights,
	used: number,
): string {
	const out: string[] = [
		`# Comment insights: ${mdLine(details.title)}`,
		"",
		`https://www.youtube.com/watch?v=${details.videoId}${details.channelTitle ? ` · ${mdLine(details.channelTitle)}` : ""}`,
		"",
		`Based on ${used} top comments, ${new Date().toISOString().slice(0, 10)}.`,
		"",
	];
	if (x.summary) out.push(mdLine(x.summary), "");
	const s = x.sentiment;
	if (s.positive + s.neutral + s.negative > 0) {
		out.push(
			`**Sentiment:** ${s.positive}% positive · ${s.neutral}% neutral · ${s.negative}% negative`,
			"",
		);
	}
	if (x.requests.length) {
		out.push("## Video ideas from requests", "");
		for (const r of x.requests) {
			out.push(
				`- **${mdLine(r.videoTitle)}**${mentions(r.mentions)}: requested "${mdLine(r.request)}"${r.why ? `. ${mdLine(r.why)}` : ""}`,
			);
		}
		out.push("");
	}
	if (x.questions.length) {
		out.push("## Viewer questions", "");
		for (const q of x.questions) {
			out.push(
				`- ${mdLine(q.question)}${mentions(q.mentions)}${q.answerIdea ? `: ${mdLine(q.answerIdea)}` : ""}`,
			);
		}
		out.push("");
	}
	if (x.complaints.length) {
		out.push("## Complaints & criticism", "");
		for (const c of x.complaints) {
			out.push(
				`- ${mdLine(c.point)}${mentions(c.mentions)}${c.suggestion ? `. Fix: ${mdLine(c.suggestion)}` : ""}`,
			);
		}
		out.push("");
	}
	if (x.praise.length) {
		out.push("## What viewers love", "");
		for (const p of x.praise) {
			out.push(
				`- ${mdLine(p.theme)}${mentions(p.mentions)}${p.detail ? `: ${mdLine(p.detail)}` : ""}`,
			);
		}
		out.push("");
	}
	return `${out.join("\n").trimEnd()}\n`;
}
