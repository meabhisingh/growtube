/**
 * "Chapters & description": from a video's transcript the AI drafts YouTube
 * chapters, an SEO description and a pinned comment. Chapters are always
 * re-validated in code (0:00 first, 3+, 10 s apart, inside the video), also
 * after the user edits them. The transcript only goes to the user's own AI
 * provider, on click.
 */
import { extractVideoId } from "@growtube/shared/youtube";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Textarea } from "@growtube/ui/components/textarea";
import { Captions, ListOrdered, Play, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common";
import {
	chaptersToText,
	compactTranscript,
	parseChaptersText,
	validateChapters,
} from "@/lib/ai/chapters";
import { ai, yt } from "@/lib/client";
import type { Transcript, VideoDetails } from "@/lib/youtube/types";

import { useAsyncTask } from "../../../hooks";
import { Badge } from "../../../ui/badges";
import {
	EmptyState,
	ErrorNotice,
	LoadingBlock,
	Notice,
} from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import { VideoRow } from "../../../ui/video";
import { type ToolIntent, usePanel } from "../../nav";
import { AiSetupNotice } from "../../shared";
import { modeForIntent, OutputBlock } from "./shared";

/** ~7k tokens of transcript: enough for chapters, cheap for any provider. */
const TRANSCRIPT_BUDGET = 28_000;
const DESCRIPTION_MAX = 5_000;

type Loaded = {
	video: VideoDetails;
	transcript: Transcript | null;
	transcriptError: unknown;
};

export function ChaptersMode({
	intent,
	active,
}: {
	intent: ToolIntent | null;
	/** This mode is visible */
	active: boolean;
}) {
	const { activeTab } = usePanel();
	const [input, setInput] = useState("");
	const [inputError, setInputError] = useState<string | null>(null);

	const [chaptersText, setChaptersText] = useState("");
	const [description, setDescription] = useState("");
	const [hashtags, setHashtags] = useState("");
	const [pinned, setPinned] = useState("");

	const load = useAsyncTask(async (videoId: string): Promise<Loaded> => {
		const [video, captions] = await Promise.all([
			yt.getVideoDetails(videoId, { level: "basic" }),
			yt.getTranscript(videoId).then(
				(transcript) => ({ transcript, error: null as unknown }),
				(error: unknown) => ({ transcript: null, error }),
			),
		]);
		return {
			video,
			transcript: captions.transcript,
			transcriptError: captions.error,
		};
	});

	const loaded = load.data;
	const compact = useMemo(
		() =>
			loaded?.transcript
				? compactTranscript(loaded.transcript.segments, TRANSCRIPT_BUDGET)
				: null,
		[loaded],
	);

	const gen = useAsyncTask(async (data: Loaded) => {
		if (!data.transcript || !compact)
			throw new Error("This video has no captions to work from.");
		return ai.generate("videoChapters", {
			transcript: compact.text,
			truncated: compact.truncated,
			durationSec: data.video.durationSec || null,
			title: data.video.title,
			keywords: data.video.keywords,
			currentDescription: data.video.description || undefined,
		});
	});

	// Fresh results replace the editable drafts (only the latest run lands here).
	useEffect(() => {
		const out = gen.data;
		if (!out) return;
		setChaptersText(chaptersToText(out.chapters));
		setDescription(out.description.slice(0, DESCRIPTION_MAX));
		setHashtags(out.hashtags.join(" "));
		setPinned(out.pinnedComment);
	}, [gen.data]);

	const start = (raw: string) => {
		const id = extractVideoId(raw.trim());
		if (!id) {
			setInputError("Paste a YouTube video link or an 11-character video id.");
			return;
		}
		setInputError(null);
		setInput(raw.trim());
		gen.reset();
		void load.run(id);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (modeForIntent(intent) !== "chapters") return;
		if (intent?.videoId) start(intent.videoId);
		else if (intent?.prefill) start(intent.prefill);
	}, [intent?.id]);

	// Default to the current tab's video the first time the mode is shown.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when first shown
	useEffect(() => {
		if (active && !input && !load.data && !load.loading && activeTab.videoId)
			start(activeTab.videoId);
	}, [active, activeTab.videoId]);

	const duration = loaded?.video.durationSec || null;
	const check = useMemo(
		() => validateChapters(parseChaptersText(chaptersText), duration),
		[chaptersText, duration],
	);
	const fixedText = check.valid ? chaptersToText(check.chapters) : "";
	const canFix = check.valid && fixedText !== chaptersText.trim();

	const fullDescription = () =>
		[
			description.trim(),
			check.valid ? chaptersToText(check.chapters) : "",
			hashtags.trim(),
		]
			.filter(Boolean)
			.join("\n\n");

	const aboveFold = description.split(/\r?\n/).filter((l) => l.trim());

	return (
		<>
			<Section
				title="Chapters & description"
				icon={ListOrdered}
				description="Works from the video's captions: YouTube chapters, an SEO description and a pinned comment, each one click to copy."
			>
				<form
					className="flex gap-1.5"
					onSubmit={(e) => {
						e.preventDefault();
						start(input);
					}}
				>
					<Input
						value={input}
						onChange={(e) => setInput(e.target.value)}
						placeholder="Video URL or id"
						aria-label="Video URL or id"
					/>
					<Button
						type="submit"
						variant="outline"
						disabled={!input.trim() || load.loading}
					>
						Load
					</Button>
				</form>
				{activeTab.videoId && activeTab.videoId !== loaded?.video.videoId ? (
					<Button
						size="xs"
						variant="outline"
						className="self-start"
						onClick={() => activeTab.videoId && start(activeTab.videoId)}
					>
						<Play /> Use current video
					</Button>
				) : null}
				{inputError ? (
					<ErrorNotice error={inputError} title="Can't use that link" />
				) : null}
				{load.error ? (
					<ErrorNotice error={load.error} onRetry={() => start(input)} />
				) : null}
				{load.loading ? (
					<LoadingBlock label="Loading video and captions…" />
				) : null}
				{loaded && !load.loading ? (
					<>
						<VideoRow video={loaded.video} />
						{loaded.transcript ? (
							<div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
								<Captions className="size-3.5" aria-hidden />
								{loaded.transcript.segments.length} caption lines ·{" "}
								{loaded.transcript.kind === "asr" ? "auto-generated" : "manual"}{" "}
								· {loaded.transcript.languageCode}
								{compact?.truncated ? " · condensed to fit" : ""}
							</div>
						) : loaded.transcriptError ? (
							<ErrorNotice
								error={loaded.transcriptError}
								title="Couldn't load the captions"
								onRetry={() => start(input)}
							/>
						) : (
							<Notice tone="warning" title="No captions found">
								Chapters need captions (manual or auto-generated). Try another
								video.
							</Notice>
						)}
					</>
				) : null}
				{loaded?.transcript && !load.loading ? (
					<>
						<AiSetupNotice />
						<Button onClick={() => void gen.run(loaded)} disabled={gen.loading}>
							<Sparkles /> {gen.data ? "Generate again" : "Generate"}
						</Button>
						{gen.error ? (
							<ErrorNotice
								error={gen.error}
								onRetry={() => void gen.run(loaded)}
							/>
						) : null}
					</>
				) : null}
			</Section>

			{gen.loading ? (
				<LoadingBlock label="Reading the transcript for topic changes…" />
			) : null}

			{!loaded && !load.loading && !load.error ? (
				<EmptyState icon={ListOrdered} title="Chapters in one click">
					Open a video on YouTube or paste a link. The AI reads its captions and
					drafts chapters, a description and a pinned comment.
				</EmptyState>
			) : null}

			{gen.data && !gen.loading ? (
				<>
					<OutputBlock
						title="Chapters"
						copyText={() => (check.valid ? fixedText : chaptersText)}
						actions={
							canFix ? (
								<Button
									size="xs"
									variant="outline"
									onClick={() => setChaptersText(fixedText)}
								>
									<Wand2 /> Fix
								</Button>
							) : null
						}
					>
						<Textarea
							value={chaptersText}
							onChange={(e) => setChaptersText(e.target.value)}
							aria-label="Chapters"
							aria-invalid={!check.valid || undefined}
							placeholder={"0:00 Intro\n1:15 First topic\n…"}
							className="ovq-num max-h-72 min-h-24 font-mono text-[11px]"
						/>
						<div className="flex flex-wrap items-center gap-1.5 text-[11px]">
							{check.valid ? (
								<Badge tone="emerald">
									Valid · {check.chapters.length} chapters
								</Badge>
							) : (
								<Badge tone="red">Not valid for YouTube</Badge>
							)}
							<span className="text-muted-foreground">
								0:00 first, 3+ chapters, 10+ s each
							</span>
						</div>
						{check.issues.length ? (
							<ul className="text-muted-foreground flex list-disc flex-col gap-0.5 pl-4 text-[11px] leading-relaxed">
								{check.issues.map((i) => (
									<li key={i}>{i}</li>
								))}
							</ul>
						) : null}
						{gen.data.chapters.length === 0 && !chaptersText.trim() ? (
							<Notice tone="warning">
								The AI's chapters didn't meet YouTube's rules, so none are
								shown. Generate again, or write them here.
							</Notice>
						) : null}
					</OutputBlock>

					<OutputBlock
						title="Description"
						copyText={() => description}
						actions={
							<CopyButton
								text={fullDescription}
								label="Copy all"
								title="Copy description + chapters + hashtags"
								size={11}
							/>
						}
					>
						{aboveFold.length ? (
							<div className="bg-surface-2 rounded-lg p-2 text-[11px] leading-relaxed">
								<div className="text-muted-foreground mb-0.5">
									Above the fold (first 2 lines)
								</div>
								{aboveFold.slice(0, 2).map((l) => (
									<div key={l} className="line-clamp-2">
										{l}
									</div>
								))}
							</div>
						) : null}
						<Textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							maxLength={DESCRIPTION_MAX}
							aria-label="Description"
							className="max-h-80 min-h-28"
						/>
						<div className="text-muted-foreground ovq-num text-right text-[11px]">
							{fullDescription().length}/{DESCRIPTION_MAX} with chapters and
							hashtags
						</div>
						<div className="flex items-center gap-1.5">
							<Input
								value={hashtags}
								onChange={(e) => setHashtags(e.target.value)}
								aria-label="Hashtags"
								placeholder="#hashtags"
							/>
							<CopyButton text={() => hashtags} title="Copy hashtags" />
						</div>
					</OutputBlock>

					<OutputBlock title="Pinned comment" copyText={() => pinned}>
						<Textarea
							value={pinned}
							onChange={(e) => setPinned(e.target.value)}
							aria-label="Pinned comment"
							className="max-h-48 min-h-16"
						/>
					</OutputBlock>
				</>
			) : null}
		</>
	);
}
