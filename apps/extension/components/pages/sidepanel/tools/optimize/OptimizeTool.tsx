/**
 * Optimize: AI title ideas, a description writer and a 500-character tag
 * generator for a topic or an existing video, with a live SEO score
 * (computeSeoScore) of the chosen combination.
 */
import { computeSeoScore, type SeoResult } from "@growtube/shared/seo";
import { extractVideoId } from "@growtube/shared/youtube";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Textarea } from "@growtube/ui/components/textarea";
import { cn } from "@growtube/ui/lib/utils";
import {
	Check,
	FileText,
	Gauge,
	Lightbulb,
	MonitorPlay,
	RotateCcw,
	Scissors,
	Sparkles,
	Tags,
	Type,
	X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common";
import { fitTagsTo500, tagsLength } from "@/lib/ai/prompts";
import { ai, yt } from "@/lib/client";

import { coachVideo } from "../../../data";
import { useAsyncTask } from "../../../hooks";
import { Badge, scoreTone } from "../../../ui/badges";
import { Field, Segmented } from "../../../ui/controls";
import { ErrorNotice, LoadingBlock } from "../../../ui/feedback";
import { Collapsible, Section } from "../../../ui/layout";
import { VideoRow } from "../../../ui/video";
import { segmentsToText } from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { AiSetupNotice, ToolScroll } from "../../shared";

type Source = "topic" | "video";

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5_000;

function splitTags(text: string): string[] {
	return text
		.split(/[,\n]/)
		.map((t) => t.trim().replace(/^#/, ""))
		.filter(Boolean);
}

export function OptimizeTool({ intent }: ToolProps) {
	const { activeTab } = usePanel();
	const [source, setSource] = useState<Source>("topic");
	const [topic, setTopic] = useState("");
	const [videoInput, setVideoInput] = useState("");
	const [keyword, setKeyword] = useState("");
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [tags, setTags] = useState<string[]>([]);
	const [tagDraft, setTagDraft] = useState("");
	const [includeChapters, setIncludeChapters] = useState(true);
	const [inputError, setInputError] = useState<string | null>(null);

	const video = useAsyncTask(async (id: string) => {
		const v = await yt.getVideoDetails(id);
		setTitle(v.title);
		setDescription(v.description);
		setTags(v.keywords);
		setKeyword((k) => k || v.keywords[0] || "");
		return v;
	});
	const v = source === "video" ? video.data : undefined;

	const loadVideo = (input: string) => {
		const id = extractVideoId(input.trim());
		if (!id) {
			setInputError("That doesn't look like a YouTube video link or id.");
			return false;
		}
		setInputError(null);
		setVideoInput(input.trim());
		setSource("video");
		void video.run(id);
		return true;
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent) return;
		if (intent.videoId) loadVideo(intent.videoId);
		else if (intent.prefill) {
			setSource("topic");
			setTopic(intent.prefill);
			// Short prefills are keywords (from Keyword Research); long ones are titles.
			if (intent.prefill.trim().split(/\s+/).length <= 5)
				setKeyword(intent.prefill);
		}
	}, [intent?.id]);

	const keywords = keyword.trim() ? [keyword.trim()] : undefined;
	const subject = source === "video" ? v?.title : topic.trim();

	const titleIdeas = useAsyncTask(() =>
		ai.generate("titleIdeas", {
			topic: source === "topic" ? topic.trim() : undefined,
			video: v ? coachVideo(v) : undefined,
			keywords,
			count: 10,
		}),
	);

	const descriptionDraft = useAsyncTask(async () => {
		let transcriptExcerpt: string | undefined;
		if (v && includeChapters) {
			const t = await yt.getTranscript(v.videoId).catch(() => null);
			if (t?.segments.length)
				transcriptExcerpt = segmentsToText(t.segments, { maxChars: 10_000 });
		}
		const out = await ai.generate("descriptionDraft", {
			title: title.trim() || subject || "",
			keywords,
			transcriptExcerpt,
			includeChapters: !!transcriptExcerpt,
			currentDescription: v?.description || undefined,
		});
		const chapters = out.chapters.length
			? `\n\n${out.chapters.map((c) => `${c.time} ${c.title}`).join("\n")}`
			: "";
		const hashtags = out.hashtags.length ? `\n\n${out.hashtags.join(" ")}` : "";
		setDescription(`${out.description.trim()}${chapters}${hashtags}`);
		return out;
	});

	const tagSet = useAsyncTask(async () => {
		const out = await ai.generate("tagSet", {
			title: title.trim() || subject || "",
			description: description || undefined,
			keywords,
			existingTags: tags.length ? tags : undefined,
		});
		setTags(out.tags);
		return out;
	});

	const seo = useMemo(
		() =>
			computeSeoScore({
				title,
				description,
				tags,
				targetKeyword: keyword.trim() || null,
				durationSec: v?.durationSec,
				isShort: v?.isShort,
			}),
		[title, description, tags, keyword, v],
	);
	const originalSeo = useMemo(
		() =>
			v
				? computeSeoScore({
						title: v.title,
						description: v.description,
						tags: v.keywords,
						targetKeyword: keyword.trim() || null,
						durationSec: v.durationSec,
						isShort: v.isShort,
					}).score
				: null,
		[v, keyword],
	);

	const tagChars = tagsLength(tags);
	const addTags = (text: string) => {
		const next = splitTags(text);
		if (!next.length) return;
		setTags((prev) => {
			const lower = new Set(prev.map((t) => t.toLowerCase()));
			return [...prev, ...next.filter((t) => !lower.has(t.toLowerCase()))];
		});
		setTagDraft("");
	};

	const canGenerate = source === "topic" ? !!topic.trim() : !!v;

	return (
		<ToolScroll>
			<SeoBar
				seo={seo}
				original={originalSeo}
				empty={!title.trim() && !description.trim() && tags.length === 0}
			/>
			<AiSetupNotice />

			<Section title="What are you optimizing?" icon={Lightbulb}>
				<Segmented<Source>
					size="xs"
					value={source}
					onChange={setSource}
					options={[
						{ value: "topic", label: "New video (topic)" },
						{ value: "video", label: "Existing video" },
					]}
				/>
				{source === "topic" ? (
					<Field label="Topic" htmlFor="opt-topic">
						<Input
							id="opt-topic"
							value={topic}
							onChange={(e) => setTopic(e.target.value)}
							placeholder="e.g. how to start a vegetable garden on a balcony"
						/>
					</Field>
				) : (
					<>
						<form
							className="flex gap-1.5"
							onSubmit={(e) => {
								e.preventDefault();
								loadVideo(videoInput);
							}}
						>
							<Input
								value={videoInput}
								onChange={(e) => setVideoInput(e.target.value)}
								placeholder="Video URL or id"
								aria-label="Video URL or id"
							/>
							<Button
								type="submit"
								variant="outline"
								disabled={!videoInput.trim() || video.loading}
							>
								Load
							</Button>
						</form>
						{activeTab.videoId && activeTab.videoId !== v?.videoId ? (
							<Button
								size="xs"
								variant="outline"
								className="self-start"
								onClick={() =>
									activeTab.videoId && loadVideo(activeTab.videoId)
								}
							>
								<MonitorPlay /> Use current video
							</Button>
						) : null}
						{inputError ? (
							<ErrorNotice error={inputError} title="Can't load that video" />
						) : video.error ? (
							<ErrorNotice error={video.error} />
						) : video.loading ? (
							<LoadingBlock label="Loading the video…" />
						) : v ? (
							<VideoRow video={v} />
						) : null}
					</>
				)}
				<Field
					label="Target keyword"
					htmlFor="opt-keyword"
					hint="The search phrase you want to rank for. Used by every generator and the SEO score."
				>
					<Input
						id="opt-keyword"
						value={keyword}
						onChange={(e) => setKeyword(e.target.value)}
						placeholder={v?.keywords[0] ?? "e.g. balcony vegetable garden"}
					/>
				</Field>
			</Section>

			<Section
				title="Title"
				icon={Type}
				actions={
					<Button
						size="xs"
						onClick={() => void titleIdeas.run()}
						disabled={!canGenerate || titleIdeas.loading}
					>
						<Sparkles /> {titleIdeas.data ? "More ideas" : "10 title ideas"}
					</Button>
				}
			>
				<Field
					label="Chosen title"
					htmlFor="opt-title"
					trailing={<Counter value={title.length} soft={70} max={TITLE_MAX} />}
				>
					<Input
						id="opt-title"
						value={title}
						maxLength={TITLE_MAX}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Pick an idea below or write your own"
					/>
				</Field>
				{titleIdeas.error ? (
					<ErrorNotice
						error={titleIdeas.error}
						onRetry={() => void titleIdeas.run()}
					/>
				) : titleIdeas.loading ? (
					<LoadingBlock label="Writing titles…" />
				) : titleIdeas.data ? (
					<ol className="flex flex-col gap-1">
						{titleIdeas.data.titles.map((t) => {
							const chosen = t.title === title;
							return (
								<li
									key={t.title}
									className={cn(
										"ring-foreground/7 flex items-start gap-2 rounded-lg p-2 ring-1 transition-colors duration-150",
										chosen ? "bg-brand-soft ring-brand/40" : "bg-surface",
									)}
								>
									<div className="flex min-w-0 flex-1 flex-col gap-1">
										<span className="text-xs leading-snug font-medium">
											{t.title}
										</span>
										<div className="flex flex-wrap items-center gap-1">
											<Badge tone="sky">{t.angle}</Badge>
											<span className="ovq-num text-muted-foreground text-[10px]">
												{t.title.length} chars
											</span>
										</div>
										<span className="text-muted-foreground text-[11px] leading-relaxed">
											{t.why}
										</span>
									</div>
									<div className="flex shrink-0 flex-col items-end gap-1">
										<Button
											size="xs"
											variant={chosen ? "secondary" : "outline"}
											onClick={() => setTitle(t.title)}
										>
											{chosen ? <Check /> : null}
											{chosen ? "Chosen" : "Use"}
										</Button>
										<CopyButton
											text={t.title}
											size={11}
											style={{ padding: 3, border: "none" }}
										/>
									</div>
								</li>
							);
						})}
					</ol>
				) : null}
			</Section>

			<Section
				title="Description"
				icon={FileText}
				actions={
					<Button
						size="xs"
						onClick={() => void descriptionDraft.run()}
						disabled={!(title.trim() || subject) || descriptionDraft.loading}
					>
						<Sparkles /> {description ? "Rewrite" : "Write"}
					</Button>
				}
			>
				{v ? (
					<label className="text-muted-foreground flex items-center gap-2 text-[11px]">
						<input
							type="checkbox"
							checked={includeChapters}
							onChange={(e) => setIncludeChapters(e.target.checked)}
						/>
						<Scissors className="size-3" aria-hidden /> Use the transcript for
						chapters
					</label>
				) : null}
				{descriptionDraft.error ? (
					<ErrorNotice
						error={descriptionDraft.error}
						onRetry={() => void descriptionDraft.run()}
					/>
				) : null}
				{descriptionDraft.loading ? (
					<LoadingBlock label="Writing the description…" />
				) : null}
				<Textarea
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					maxLength={DESCRIPTION_MAX}
					placeholder="Write or generate a description. The first 2 lines show above the fold."
					aria-label="Description"
					className="max-h-80 min-h-28"
				/>
				<div className="flex items-center justify-between gap-2">
					<Counter value={description.length} max={DESCRIPTION_MAX} />
					<CopyButton
						text={description}
						label="Copy"
						size={11}
						disabled={!description}
					/>
				</div>
			</Section>

			<Section
				title="Tags"
				icon={Tags}
				actions={
					<Button
						size="xs"
						onClick={() => void tagSet.run()}
						disabled={!(title.trim() || subject) || tagSet.loading}
					>
						<Sparkles /> Generate
					</Button>
				}
			>
				{tagSet.error ? (
					<ErrorNotice error={tagSet.error} onRetry={() => void tagSet.run()} />
				) : null}
				{tagSet.loading ? <LoadingBlock label="Picking tags…" /> : null}
				<div className="flex flex-wrap gap-1">
					{tags.map((t) => (
						<span
							key={t}
							className="bg-muted inline-flex items-center gap-1 rounded-lg py-0.5 pr-1 pl-2 text-[11px]"
						>
							{t}
							<button
								type="button"
								onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
								aria-label={`Remove tag ${t}`}
								className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 focus-visible:ring-ring/50 rounded-full transition-colors duration-150 outline-none focus-visible:ring-2"
							>
								<X className="size-3" />
							</button>
						</span>
					))}
					{tags.length === 0 ? (
						<span className="text-muted-foreground text-xs">No tags yet.</span>
					) : null}
				</div>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						addTags(tagDraft);
					}}
				>
					<Input
						value={tagDraft}
						onChange={(e) => {
							const value = e.target.value;
							if (value.includes(",")) addTags(value);
							else setTagDraft(value);
						}}
						placeholder="Add tags (Enter or comma)"
						aria-label="Add tags"
					/>
				</form>
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={cn(
							"ovq-num text-[11px] font-medium",
							tagChars > 500
								? "text-red-600 dark:text-red-400"
								: tagChars >= 400
									? "text-emerald-600 dark:text-emerald-400"
									: "text-muted-foreground",
						)}
						title="YouTube counts tags with spaces as if quoted, plus the commas"
					>
						{tagChars}/500 characters
					</span>
					<div className="flex-1" />
					{tagChars > 500 ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => setTags(fitTagsTo500(tags))}
						>
							Fit to 500
						</Button>
					) : null}
					{v ? (
						<Button
							size="xs"
							variant="ghost"
							onClick={() => setTags(v.keywords)}
						>
							<RotateCcw /> Current tags
						</Button>
					) : null}
					<CopyButton
						text={() => tags.join(", ")}
						label="Copy"
						size={11}
						disabled={!tags.length}
					/>
				</div>
			</Section>

			<Section title="SEO checklist" icon={Gauge}>
				<SeoChecklist seo={seo} />
			</Section>
		</ToolScroll>
	);
}

function Counter({
	value,
	max,
	soft,
}: {
	value: number;
	max: number;
	soft?: number;
}) {
	const over = value > max;
	const warn = soft != null && value > soft;
	return (
		<span
			className={cn(
				"ovq-num text-[11px]",
				over
					? "text-red-600 dark:text-red-400"
					: warn
						? "text-amber-600 dark:text-amber-400"
						: "text-muted-foreground",
			)}
		>
			{value.toLocaleString()}/{max.toLocaleString()}
		</span>
	);
}

/** Sticky score summary at the top of the tool. */
function SeoBar({
	seo,
	original,
	empty,
}: {
	seo: SeoResult;
	original: number | null;
	empty: boolean;
}) {
	if (empty) {
		return (
			<div className="bg-background/95 text-muted-foreground sticky top-0 z-10 -mx-3 -mt-3 border-b px-3 py-2.5 text-xs backdrop-blur">
				The SEO score updates live as you fill in a title, description and tags.
			</div>
		);
	}
	const tone = scoreTone(seo.score);
	const color =
		tone === "emerald" || tone === "green"
			? "bg-emerald-500"
			: tone === "amber"
				? "bg-amber-500"
				: tone === "orange"
					? "bg-orange-500"
					: "bg-red-500";
	return (
		<div className="bg-background/95 sticky top-0 z-10 -mx-3 -mt-3 flex flex-col gap-1.5 border-b px-3 py-2 backdrop-blur">
			<div className="flex items-center gap-2 text-xs">
				<span className="font-medium">SEO score</span>
				<Badge tone={tone}>{seo.score}/100</Badge>
				{original != null && original !== seo.score ? (
					<span className="text-muted-foreground text-[11px]">
						was {original} {seo.score > original ? "▲" : "▼"}
					</span>
				) : null}
				<div className="flex-1" />
				<span className="text-muted-foreground truncate text-[11px]">
					{seo.keyword ? `for "${seo.keyword}"` : "add a target keyword"}
				</span>
			</div>
			<div className="bg-muted h-1 w-full overflow-hidden rounded-full">
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-200",
						color,
					)}
					style={{ width: `${seo.score}%` }}
				/>
			</div>
		</div>
	);
}

function SeoChecklist({ seo }: { seo: SeoResult }) {
	const failed = seo.checks.filter((c) => !c.passed);
	const passed = seo.checks.filter((c) => c.passed);
	return (
		<div className="flex flex-col gap-2">
			{failed.length === 0 ? (
				<div className="text-xs text-emerald-600 dark:text-emerald-400">
					Every check passes. Nice.
				</div>
			) : (
				<ul className="flex flex-col gap-1.5">
					{failed.map((c) => (
						<li key={c.id} className="flex gap-2 text-xs">
							<X
								className="mt-0.5 size-3.5 shrink-0 text-red-500"
								aria-hidden
							/>
							<div className="flex min-w-0 flex-col gap-0.5">
								<span className="font-medium">
									{c.label}{" "}
									<span className="text-muted-foreground">(+{c.weight})</span>
								</span>
								<span className="text-muted-foreground text-[11px] leading-relaxed">
									{c.hint}
								</span>
							</div>
						</li>
					))}
				</ul>
			)}
			{passed.length ? (
				<Collapsible summary={`${passed.length} passed checks`}>
					<ul className="flex flex-col gap-1">
						{passed.map((c) => (
							<li
								key={c.id}
								className="text-muted-foreground flex items-center gap-2 text-xs"
							>
								<Check
									className="size-3.5 shrink-0 text-emerald-500"
									aria-hidden
								/>
								{c.label}
							</li>
						))}
					</ul>
				</Collapsible>
			) : null}
		</div>
	);
}
