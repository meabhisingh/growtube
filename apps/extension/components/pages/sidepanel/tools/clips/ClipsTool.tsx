/**
 * Clip Finder: reads a video's transcript and lets the AI pick the most
 * Short-worthy segments (clipFinder generator). Each clip opens the video at
 * its timestamp; nothing is downloaded.
 */
import { formatDuration } from "@open-vidiq/shared/format";
import { extractVideoId } from "@open-vidiq/shared/youtube";
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { Captions, Play, Scissors, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CopyButton } from "@/components/common";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { ai, yt } from "@/lib/client";
import type { Transcript, VideoDetails } from "@/lib/youtube/types";

import { useAsyncTask } from "../../../hooks";
import { ScoreBadge } from "../../../ui/badges";
import { Field, NativeSelect } from "../../../ui/controls";
import {
	EmptyState,
	ErrorNotice,
	LoadingBlock,
	Notice,
} from "../../../ui/feedback";
import { Collapsible, Section } from "../../../ui/layout";
import { VideoRow } from "../../../ui/video";
import {
	formatClock,
	openVideoAt,
	segmentsToText,
	watchUrl,
} from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { AiSetupNotice, ToolScroll } from "../../shared";

type Clip = GeneratorOutput<"clipFinder">["clips"][number];

type Loaded = {
	video: VideoDetails;
	transcript: Transcript | null;
	/** Set when the captions couldn't be loaded (as opposed to not existing) */
	transcriptError: unknown;
};

const LENGTHS = {
	short: { label: "15–60 s (Shorts)", min: 15, max: 60 },
	medium: { label: "30–90 s", min: 30, max: 90 },
	long: { label: "60–180 s (long Shorts)", min: 60, max: 180 },
} as const;

type LengthKey = keyof typeof LENGTHS;

export function ClipsTool({ intent, active }: ToolProps) {
	const { activeTab } = usePanel();
	const [input, setInput] = useState("");
	const [inputError, setInputError] = useState<string | null>(null);
	const [count, setCount] = useState(5);
	const [length, setLength] = useState<LengthKey>("short");

	const load = useAsyncTask(async (videoId: string): Promise<Loaded> => {
		const [video, captions] = await Promise.all([
			yt.getVideoDetails(videoId, { level: "basic" }),
			// Missing captions surface as "No captions found" below; a failed
			// lookup gets its own retryable notice.
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

	const clips = useAsyncTask(async (data: Loaded) => {
		if (!data.transcript)
			throw new Error("This video has no captions to work from.");
		const range = LENGTHS[length];
		return ai.generate("clipFinder", {
			transcript: segmentsToText(data.transcript.segments, {
				maxChars: 30_000,
			}),
			videoTitle: data.video.title,
			maxClips: count,
			minSec: range.min,
			maxSec: range.max,
		});
	});

	const start = (raw: string) => {
		const id = extractVideoId(raw.trim());
		if (!id) {
			setInputError("Paste a YouTube video link or an 11-character video id.");
			return;
		}
		setInputError(null);
		setInput(raw.trim());
		clips.reset();
		void load.run(id);
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent?.videoId) start(intent.videoId);
		else if (intent?.prefill) start(intent.prefill);
	}, [intent?.id]);

	// Default to the current tab's video the first time the tool is shown.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when first shown
	useEffect(() => {
		if (active && !input && !load.data && !load.loading && activeTab.videoId)
			start(activeTab.videoId);
	}, [active, activeTab.videoId]);

	const loaded = load.data;
	const sorted = useMemo(
		() => [...(clips.data?.clips ?? [])].sort((a, b) => b.score - a.score),
		[clips.data],
	);

	return (
		<ToolScroll>
			<Section
				title="Find Short-worthy moments"
				icon={Scissors}
				description="Works from the video's captions. No downloading: each clip opens the video at the right time."
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
							</div>
						) : loaded.transcriptError ? (
							<ErrorNotice
								error={loaded.transcriptError}
								title="Couldn't load the captions"
								onRetry={() => start(input)}
							/>
						) : (
							<Notice tone="warning" title="No captions found">
								Clip Finder needs captions (manual or auto-generated). Try
								another video.
							</Notice>
						)}
					</>
				) : null}
			</Section>

			{loaded?.transcript ? (
				<Section>
					<AiSetupNotice />
					<div className="grid grid-cols-2 gap-2">
						<Field label="Clips" htmlFor="clip-count">
							<NativeSelect
								id="clip-count"
								value={count}
								onChange={(e) => setCount(Number(e.target.value))}
							>
								{[3, 4, 5, 6, 7, 8].map((n) => (
									<option key={n} value={n}>
										Up to {n}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label="Length" htmlFor="clip-length">
							<NativeSelect
								id="clip-length"
								value={length}
								onChange={(e) => setLength(e.target.value as LengthKey)}
							>
								{(Object.keys(LENGTHS) as LengthKey[]).map((k) => (
									<option key={k} value={k}>
										{LENGTHS[k].label}
									</option>
								))}
							</NativeSelect>
						</Field>
					</div>
					<Button
						onClick={() => void clips.run(loaded)}
						disabled={clips.loading}
					>
						<Sparkles /> {clips.data ? "Find again" : "Find clips"}
					</Button>
					{clips.error ? (
						<ErrorNotice
							error={clips.error}
							onRetry={() => void clips.run(loaded)}
						/>
					) : null}
				</Section>
			) : null}

			{clips.loading ? (
				<LoadingBlock label="Reading the transcript for hooks…" />
			) : null}

			{!loaded && !load.loading && !load.error ? (
				<EmptyState icon={Scissors} title="Turn long videos into Shorts">
					Open a video on YouTube or paste a link. The AI finds 3–8 moments with
					a strong hook and a self-contained payoff, scored for viral potential.
				</EmptyState>
			) : null}

			{clips.data && !clips.loading && loaded ? (
				sorted.length === 0 ? (
					<Notice>
						No strong standalone moments found. Try a longer length range.
					</Notice>
				) : (
					<div className="flex flex-col gap-2">
						<div className="text-muted-foreground flex items-center justify-between text-[11px]">
							<span>{sorted.length} clips, best first</span>
							<CopyButton
								text={() =>
									sorted
										.map((c) => clipText(c, loaded.video.videoId))
										.join("\n\n")
								}
								label="Copy all"
								size={11}
							/>
						</div>
						{sorted.map((clip) => (
							<ClipCard
								key={`${clip.start}-${clip.end}`}
								clip={clip}
								videoId={loaded.video.videoId}
								transcript={loaded.transcript}
							/>
						))}
					</div>
				)
			) : null}
		</ToolScroll>
	);
}

function clipText(clip: Clip, videoId: string): string {
	return [
		clip.title,
		`${formatClock(clip.start)}–${formatClock(clip.end)} (${Math.round(clip.end - clip.start)} s)`,
		`Hook: ${clip.hook}`,
		`Why: ${clip.reason}`,
		watchUrl(videoId, clip.start),
	].join("\n");
}

function ClipCard({
	clip,
	videoId,
	transcript,
}: {
	clip: Clip;
	videoId: string;
	transcript: Transcript | null;
}) {
	const excerpt = transcript
		? segmentsToText(transcript.segments, {
				fromSec: clip.start,
				toSec: clip.end,
			})
		: "";
	return (
		<article className="bg-card ring-foreground/8 flex flex-col gap-2 p-3 ring-1">
			<div className="flex items-start gap-2">
				<ScoreBadge score={clip.score} title="Viral potential (0–100)" />
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<h3 className="text-xs leading-snug font-semibold">{clip.title}</h3>
					<span className="ovq-num text-muted-foreground text-[11px]">
						{formatClock(clip.start)} – {formatClock(clip.end)} ·{" "}
						{formatDuration(clip.end - clip.start)}
					</span>
				</div>
			</div>
			<div className="border-brand/60 border-l-2 pl-2 text-xs leading-relaxed italic">
				“{clip.hook}”
			</div>
			<p className="text-muted-foreground text-[11px] leading-relaxed">
				{clip.reason}
			</p>
			{excerpt ? (
				<Collapsible summary="Transcript of this clip">
					<pre className="bg-surface-2 max-h-48 overflow-y-auto p-2 font-sans text-[11px] leading-relaxed whitespace-pre-wrap">
						{excerpt}
					</pre>
				</Collapsible>
			) : null}
			<div className="flex flex-wrap gap-1.5">
				<Button size="xs" onClick={() => void openVideoAt(videoId, clip.start)}>
					<Play /> Open at {formatClock(clip.start)}
				</Button>
				<CopyButton
					text={() => clipText(clip, videoId)}
					label="Copy"
					size={11}
				/>
			</div>
		</article>
	);
}
