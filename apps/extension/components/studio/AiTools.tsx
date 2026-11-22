/**
 * AI actions for the Studio optimizer: titles, description, tags and
 * thumbnail ideas. Every result can be copied; titles, descriptions and tags
 * can be applied to Studio's fields (never saved: the creator clicks Save).
 */
import { formatNumber } from "@growtube/shared/format";
import {
	Check,
	Download,
	ImageIcon,
	Plus,
	RefreshCw,
	Replace,
	Sparkles,
	Wand2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { type CoachContext, imageExtension } from "@/lib/ai/types";
import { ai, ext, yt } from "@/lib/client";
import { useBackground } from "@/lib/hooks";

import { useRemembered } from "./prefs";
import {
	composeDescription,
	extractLinks,
	fitTags,
	hasChapters,
	LIMITS,
	segmentsToText,
	youtubeTagsLength,
} from "./text";
import { Btn, Chip, cx, ErrorNotice, Notice, withTimeout } from "./ui";

type Job<T> = {
	status: "idle" | "loading" | "done" | "error";
	data?: T;
	error?: unknown;
};

const IDLE = { status: "idle" } as const;

/** CopyButton sits next to small Btns, so it gets their radius. */
const COPY_STYLE = { borderRadius: "var(--ovq-radius-inner)" } as const;

/** A remembered async job (survives remounts, keyed per video). */
function useJob<T>(key: string) {
	const [job, setJob] = useRemembered<Job<T>>(key, IDLE);
	const run = async (fn: () => Promise<T>) => {
		setJob((prev) => ({ ...prev, status: "loading", error: undefined }));
		try {
			const data = await fn();
			setJob({ status: "done", data });
		} catch (error) {
			setJob((prev) => ({ ...prev, status: "error", error }));
		}
	};
	return [job, run] as const;
}

export type AiToolsProps = {
	/** Per-video key for remembered results */
	memoryKey: string;
	videoId: string | null;
	title: string;
	description: string;
	tags: string[];
	keyword: string;
	suggestions: string[];
	video: NonNullable<CoachContext["video"]>;
	channel?: CoachContext["channel"];
	canApply: { title: boolean; description: boolean; tags: boolean };
	onApplyTitle: (text: string) => Promise<void>;
	onApplyDescription: (text: string) => Promise<void>;
	onAddTags: (tags: string[], mode: "add" | "replace") => Promise<void>;
};

type Tool = "titles" | "description" | "tags" | "thumbnails";

const TOOLS: { id: Tool; label: string }[] = [
	{ id: "titles", label: "Titles" },
	{ id: "description", label: "Description" },
	{ id: "tags", label: "Tags" },
	{ id: "thumbnails", label: "Thumbnails" },
];

function uniq(values: (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		const t = v?.trim();
		if (!t || seen.has(t.toLowerCase())) continue;
		seen.add(t.toLowerCase());
		out.push(t);
	}
	return out;
}

export function AiTools(props: AiToolsProps) {
	const [tool, setTool] = useRemembered<Tool>("studio:ai-tool", "titles");
	const [nonce, setNonce] = useState(0);
	const status = useBackground("ai.status", {}, [nonce]);

	// Re-check after the user configures AI in the options tab.
	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === "visible") setNonce((n) => n + 1);
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, []);

	const notReady = status.data && !status.data.ready;

	return (
		<div className="ovq-ai">
			{notReady ? (
				<Notice
					kind="warn"
					action={
						<Btn
							small
							onClick={() => void ext.openOptions("ai").catch(() => {})}
						>
							Set up AI
						</Btn>
					}
				>
					{status.data?.problem ??
						"Connect your own AI provider (OpenAI, Ollama, OpenRouter, …) to use these tools. Free and unlimited."}
				</Notice>
			) : null}
			<div className="ovq-tabs" role="tablist" aria-label="AI tools">
				{TOOLS.map((t) => (
					<button
						key={t.id}
						type="button"
						role="tab"
						aria-selected={tool === t.id}
						className={cx("ovq-tab", tool === t.id && "ovq-tab-active")}
						onClick={() => setTool(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>
			<div role="tabpanel">
				{tool === "titles" ? <TitleIdeas {...props} /> : null}
				{tool === "description" ? <DescriptionWriter {...props} /> : null}
				{tool === "tags" ? <TagGenerator {...props} /> : null}
				{tool === "thumbnails" ? (
					<ThumbnailIdeas
						{...props}
						imageModel={status.data?.imageModel ?? ""}
					/>
				) : null}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------

function TitleIdeas(p: AiToolsProps) {
	const [job, run] = useJob<GeneratorOutput<"titleIdeas">>(
		`${p.memoryKey}:titles`,
	);
	const [applying, setApplying] = useState<string | null>(null);
	const topic =
		p.title || p.description.split("\n").find((l) => l.trim()) || p.keyword;

	const generate = () =>
		run(() =>
			ai.generate("titleIdeas", {
				topic: topic || undefined,
				video: p.video,
				keywords: uniq([p.keyword, ...p.tags.slice(0, 5)]),
				count: 10,
			}),
		);

	const apply = async (text: string) => {
		setApplying(text);
		try {
			await p.onApplyTitle(text);
		} finally {
			setApplying(null);
		}
	};

	return (
		<div className="ovq-tool">
			<div className="ovq-tool-head">
				<p className="ovq-muted ovq-small">
					10 title ideas built around your keyword, each with its angle.
				</p>
				<Btn
					variant="primary"
					small
					icon={job.data ? <RefreshCw size={12} /> : <Sparkles size={12} />}
					loading={job.status === "loading"}
					disabled={!topic}
					title={
						topic
							? undefined
							: "Add a working title, description or keyword first"
					}
					onClick={generate}
				>
					{job.data ? "Regenerate" : "Suggest titles"}
				</Btn>
			</div>
			{job.status === "error" ? (
				<ErrorNotice error={job.error} onRetry={generate} />
			) : null}
			{job.data ? (
				<ol className="ovq-results">
					{job.data.titles.map((t) => {
						const len = t.title.length;
						return (
							<li key={t.title} className="ovq-result">
								<div className="ovq-result-text">{t.title}</div>
								<div className="ovq-result-meta ovq-small">
									<span className="ovq-pill">{t.angle}</span>
									<span
										className={
											len > LIMITS.titleVisible ? "ovq-warn-text" : "ovq-muted"
										}
									>
										{len} chars
									</span>
								</div>
								{t.why ? (
									<div className="ovq-small ovq-muted">{t.why}</div>
								) : null}
								<div className="ovq-result-actions">
									<CopyButton
										text={t.title}
										label="Copy"
										size={12}
										style={COPY_STYLE}
									/>
									<Btn
										small
										icon={<Wand2 size={12} />}
										loading={applying === t.title}
										disabled={!p.canApply.title || applying != null}
										title={
											p.canApply.title
												? "Write into Studio's title field"
												: "Title field not found"
										}
										onClick={() => void apply(t.title)}
									>
										Apply
									</Btn>
								</div>
							</li>
						);
					})}
				</ol>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

type DescriptionResult = { text: string; usedTranscript: boolean };

function DescriptionWriter(p: AiToolsProps) {
	const [job, run] = useJob<DescriptionResult>(`${p.memoryKey}:description`);
	const [useCaptions, setUseCaptions] = useRemembered(
		"studio:use-captions",
		true,
	);
	const [draft, setDraft] = useRemembered(
		`${p.memoryKey}:description-draft`,
		"",
	);
	const [applying, setApplying] = useState(false);
	const links = useMemo(() => extractLinks(p.description), [p.description]);
	const keepsTimestamps = hasChapters(p.description);

	const generate = () =>
		run(async () => {
			let transcriptExcerpt: string | undefined;
			if (useCaptions && p.videoId) {
				const transcript = await withTimeout(
					yt.getTranscript(p.videoId),
					15_000,
					null,
				);
				if (transcript?.segments.length)
					transcriptExcerpt = segmentsToText(transcript.segments);
			}
			const out = await ai.generate("descriptionDraft", {
				title: p.title || p.keyword || "Untitled video",
				keywords: uniq([p.keyword, ...p.tags.slice(0, 8)]),
				currentDescription: p.description || undefined,
				links: links.length ? links : undefined,
				includeChapters: !!transcriptExcerpt && !keepsTimestamps,
				transcriptExcerpt,
				channel: p.channel,
			});
			const text = composeDescription(out, p.description);
			setDraft(text);
			return { text, usedTranscript: !!transcriptExcerpt };
		});

	const apply = async () => {
		setApplying(true);
		try {
			await p.onApplyDescription(draft);
		} finally {
			setApplying(false);
		}
	};

	const len = draft.length;
	return (
		<div className="ovq-tool">
			<div className="ovq-tool-head">
				<p className="ovq-muted ovq-small">
					An SEO description with your keyword up front.
					{links.length || keepsTimestamps
						? " Your links and timestamps are kept."
						: ""}
				</p>
				<Btn
					variant="primary"
					small
					icon={job.data ? <RefreshCw size={12} /> : <Sparkles size={12} />}
					loading={job.status === "loading"}
					disabled={!p.title && !p.keyword}
					title={
						p.title || p.keyword ? undefined : "Add a title or keyword first"
					}
					onClick={generate}
				>
					{job.data ? "Rewrite" : "Write description"}
				</Btn>
			</div>
			{p.videoId ? (
				<label className="ovq-check-row ovq-small">
					<input
						type="checkbox"
						checked={useCaptions}
						onChange={(e) => setUseCaptions(e.target.checked)}
					/>
					<span>
						Use the video's captions (adds chapters when there are none)
					</span>
				</label>
			) : null}
			{job.status === "loading" ? (
				<div className="ovq-muted ovq-small">
					{useCaptions && p.videoId
						? "Reading captions and writing…"
						: "Writing…"}
				</div>
			) : null}
			{job.status === "error" ? (
				<ErrorNotice error={job.error} onRetry={generate} />
			) : null}
			{job.data ? (
				<div className="ovq-result">
					<textarea
						className="ovq-textarea"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						rows={10}
						aria-label="Generated description (editable)"
					/>
					<div className="ovq-result-meta ovq-small">
						<span
							className={
								len > LIMITS.description ? "ovq-bad-text" : "ovq-muted"
							}
						>
							{formatNumber(len)}/5,000
						</span>
						{job.data.usedTranscript ? (
							<span className="ovq-pill">from captions</span>
						) : null}
					</div>
					<div className="ovq-result-actions">
						<CopyButton
							text={() => draft}
							label="Copy"
							size={12}
							style={COPY_STYLE}
						/>
						<Btn
							small
							icon={<Wand2 size={12} />}
							loading={applying}
							disabled={!p.canApply.description || !draft.trim()}
							title={
								p.canApply.description
									? "Replace Studio's description (you can undo)"
									: "Description field not found"
							}
							onClick={() => void apply()}
						>
							Apply
						</Btn>
					</div>
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

function TagGenerator(p: AiToolsProps) {
	const [job, run] = useJob<string[]>(`${p.memoryKey}:tags`);
	const [busy, setBusy] = useState<string | null>(null);
	const lowerExisting = useMemo(
		() => new Set(p.tags.map((t) => t.trim().toLowerCase())),
		[p.tags],
	);

	const generate = () =>
		run(async () => {
			const out = await ai.generate("tagSet", {
				title: p.title || p.keyword || "Untitled video",
				description: p.description || undefined,
				keywords: uniq([p.keyword, ...p.suggestions.slice(0, 8)]),
				existingTags: p.tags.length ? p.tags : undefined,
			});
			return fitTags(out.tags);
		});

	const generated = job.data ?? [];
	const newTags = generated.filter((t) => !lowerExisting.has(t.toLowerCase()));
	// New tags that still fit next to the existing ones.
	const addable = fitTags([...p.tags, ...newTags]).filter(
		(t) => !lowerExisting.has(t.toLowerCase()),
	);

	const act = async (key: string, tags: string[], mode: "add" | "replace") => {
		setBusy(key);
		try {
			await p.onAddTags(tags, mode);
		} finally {
			setBusy(null);
		}
	};

	return (
		<div className="ovq-tool">
			<div className="ovq-tool-head">
				<p className="ovq-muted ovq-small">
					A tag set ordered by relevance that fits YouTube's 500-character
					limit.
				</p>
				<Btn
					variant="primary"
					small
					icon={job.data ? <RefreshCw size={12} /> : <Sparkles size={12} />}
					loading={job.status === "loading"}
					disabled={!p.title && !p.keyword}
					title={
						p.title || p.keyword ? undefined : "Add a title or keyword first"
					}
					onClick={generate}
				>
					{job.data ? "Regenerate" : "Generate tags"}
				</Btn>
			</div>
			{job.status === "error" ? (
				<ErrorNotice error={job.error} onRetry={generate} />
			) : null}
			{job.data ? (
				<div className="ovq-result">
					<div className="ovq-chips">
						{generated.map((t) => {
							const present = lowerExisting.has(t.toLowerCase());
							return (
								<span key={t} className="ovq-chip-group">
									<Chip
										tone={present ? "muted" : undefined}
										title={present ? "Already a tag" : undefined}
									>
										{present ? <Check size={11} aria-hidden="true" /> : null}
										{t}
									</Chip>
									{!present && p.canApply.tags ? (
										<button
											type="button"
											className="ovq-chip-add"
											title={`Add "${t}" to Studio`}
											aria-label={`Add "${t}" to Studio`}
											disabled={busy != null}
											onClick={() => void act(`one:${t}`, [t], "add")}
										>
											<Plus size={11} />
										</button>
									) : null}
								</span>
							);
						})}
					</div>
					<div className="ovq-result-meta ovq-small">
						<span className="ovq-muted">
							{generated.length} tags · {youtubeTagsLength(generated)}/500
							characters
						</span>
					</div>
					<div className="ovq-result-actions">
						<CopyButton
							text={generated.join(", ")}
							label="Copy"
							size={12}
							style={COPY_STYLE}
						/>
						<Btn
							small
							icon={<Plus size={12} />}
							loading={busy === "add"}
							disabled={!p.canApply.tags || !addable.length || busy != null}
							title={
								p.canApply.tags
									? "Add the new tags that still fit after your current ones"
									: "Tags field not found: use Copy"
							}
							onClick={() => void act("add", addable, "add")}
						>
							Add {addable.length} new
						</Btn>
						<Btn
							small
							icon={<Replace size={12} />}
							loading={busy === "replace"}
							disabled={!p.canApply.tags || !generated.length || busy != null}
							title="Remove the current tags and use this set"
							onClick={() => void act("replace", generated, "replace")}
						>
							Replace all
						</Btn>
					</div>
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Thumbnails
// ---------------------------------------------------------------------------

type Concept = GeneratorOutput<"thumbnailConcepts">["concepts"][number];

function conceptText(c: Concept): string {
	return [
		c.headline ? `Text: ${c.headline}` : null,
		`Visual: ${c.visual}`,
		`Composition: ${c.composition}`,
		c.colors.length ? `Colors: ${c.colors.join(", ")}` : null,
		`Emotion: ${c.emotion}`,
		`Image prompt: ${c.imagePrompt}`,
	]
		.filter(Boolean)
		.join("\n");
}

const CSS_COLOR_RE = /^(#[0-9a-f]{3,8}|[a-z]+)$/i;

function ThumbnailIdeas(p: AiToolsProps & { imageModel: string }) {
	const [job, run] = useJob<GeneratorOutput<"thumbnailConcepts">>(
		`${p.memoryKey}:thumbnails`,
	);
	const generate = () =>
		run(() =>
			ai.generate("thumbnailConcepts", {
				title: p.title || p.keyword || "Untitled video",
				topic: p.keyword || undefined,
				video: p.video,
				count: 3,
			}),
		);
	return (
		<div className="ovq-tool">
			<div className="ovq-tool-head">
				<p className="ovq-muted ovq-small">
					3 thumbnail concepts that complement your title, with image prompts.
				</p>
				<Btn
					variant="primary"
					small
					icon={job.data ? <RefreshCw size={12} /> : <Sparkles size={12} />}
					loading={job.status === "loading"}
					disabled={!p.title && !p.keyword}
					title={
						p.title || p.keyword ? undefined : "Add a title or keyword first"
					}
					onClick={generate}
				>
					{job.data ? "Regenerate" : "Thumbnail ideas"}
				</Btn>
			</div>
			{job.status === "error" ? (
				<ErrorNotice error={job.error} onRetry={generate} />
			) : null}
			{job.data ? (
				<ol className="ovq-results">
					{job.data.concepts.map((c, i) => (
						<ConceptCard
							key={`${i}:${c.headline}:${c.visual}`}
							concept={c}
							imageModel={p.imageModel}
						/>
					))}
				</ol>
			) : null}
		</div>
	);
}

function ConceptCard({
	concept: c,
	imageModel,
}: {
	concept: Concept;
	imageModel: string;
}) {
	const [image, setImage] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<unknown>(null);

	const makeImage = async () => {
		setLoading(true);
		setError(null);
		try {
			// 16:9; falls back to 1536x1024 / provider default when rejected.
			const { images } = await ai.generateImage(c.imagePrompt, {
				size: "1280x720",
			});
			setImage(images[0] ?? null);
			if (!images[0]) setError(new Error("The image model returned no image."));
		} catch (e) {
			setError(e);
		} finally {
			setLoading(false);
		}
	};

	return (
		<li className="ovq-result">
			{c.headline ? (
				<div className="ovq-concept-headline">{c.headline}</div>
			) : null}
			<div className="ovq-small">{c.visual}</div>
			<div className="ovq-small ovq-muted">{c.composition}</div>
			<div className="ovq-result-meta ovq-small">
				<span className="ovq-pill">{c.emotion}</span>
				{c.colors.map((color) => (
					<span key={color} className="ovq-swatch-row">
						{CSS_COLOR_RE.test(color.trim()) ? (
							<span
								className="ovq-swatch"
								style={{ background: color.trim() }}
							/>
						) : null}
						<span className="ovq-muted">{color}</span>
					</span>
				))}
			</div>
			<details className="ovq-details">
				<summary className="ovq-small">Image prompt</summary>
				<div className="ovq-small ovq-muted">{c.imagePrompt}</div>
			</details>
			{error ? <ErrorNotice error={error} /> : null}
			{image ? (
				<div className="ovq-thumb">
					<img
						src={image}
						alt={c.headline || "Generated thumbnail background"}
					/>
					<div className="ovq-small ovq-muted">
						Add your text overlay, then upload it in Studio's Thumbnail section.
					</div>
				</div>
			) : null}
			<div className="ovq-result-actions">
				<CopyButton
					text={conceptText(c)}
					label="Copy"
					size={12}
					style={COPY_STYLE}
				/>
				<CopyButton
					text={c.imagePrompt}
					label="Copy prompt"
					size={12}
					style={COPY_STYLE}
				/>
				{image ? (
					<a
						className="ovq-btn ovq-btn-default ovq-btn-sm"
						href={image}
						download={`thumbnail.${imageExtension(image)}`}
					>
						<Download size={12} aria-hidden="true" />
						<span>Download</span>
					</a>
				) : (
					<Btn
						small
						icon={<ImageIcon size={12} />}
						loading={loading}
						disabled={!imageModel}
						title={
							imageModel
								? "Generate a background image with your image model"
								: "Set an image model in GrowTube's AI settings"
						}
						onClick={() => void makeImage()}
					>
						Generate image
					</Btn>
				)}
			</div>
		</li>
	);
}
