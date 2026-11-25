/** Pieces shared by the Script tool's modes. */
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import { GraduationCap, X } from "lucide-react";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/common";
import { yt } from "@/lib/client";
import { transcriptToText } from "@/lib/youtube/transcript";

import { useAsyncTask } from "../../../hooks";
import { scoreLabel, scoreTone, type Tone } from "../../../ui/badges";
import { ErrorNotice } from "../../../ui/feedback";
import type { ToolIntent } from "../../nav";
import { usePanel } from "../../nav";

export type ScriptMode = "hook" | "outline" | "chapters";

/** Which mode an intent targets (view first, then "a video = chapters"). */
export function modeForIntent(intent: ToolIntent | null): ScriptMode | null {
	if (!intent) return null;
	const v = intent.view;
	if (v === "hook" || v === "outline" || v === "chapters") return v;
	if (intent.videoId) return "chapters";
	return null;
}

// ---------------------------------------------------------------------------
// "Learn from this video": the active tab's opening ~60 s as a reference hook
// ---------------------------------------------------------------------------

export type ReferenceHook = {
	videoId: string;
	title: string;
	text: string;
};

const REFERENCE_SECONDS = 60;

export function useReferenceHook() {
	return useAsyncTask(async (videoId: string): Promise<ReferenceHook> => {
		const [video, transcript] = await Promise.all([
			yt.getVideoDetails(videoId, { level: "basic" }),
			yt.getTranscript(videoId),
		]);
		if (!transcript?.segments.length)
			throw new Error(
				"This video has no captions, so there's no opening to learn from.",
			);
		const text = transcriptToText(transcript.segments, {
			toSec: REFERENCE_SECONDS,
			timestamps: false,
		});
		return { videoId, title: video.title, text };
	});
}

export type ReferenceTask = ReturnType<typeof useReferenceHook>;

/**
 * Offers the active tab's video as a style reference. The opening text stays
 * in the panel and is only sent to the user's AI provider with the request.
 */
export function ReferencePicker({ reference }: { reference: ReferenceTask }) {
	const { activeTab } = usePanel();
	const ref = reference.data;
	if (ref) {
		return (
			<div className="bg-surface-2 flex flex-col gap-1.5 rounded-lg p-2.5">
				<div className="flex items-start gap-2">
					<GraduationCap
						className="text-brand mt-0.5 size-3.5 shrink-0"
						aria-hidden
					/>
					<div className="min-w-0 flex-1 text-[11px] leading-snug">
						<div className="font-medium">Learning from</div>
						<div className="text-muted-foreground truncate" title={ref.title}>
							{ref.title}
						</div>
					</div>
					<Button
						size="icon-xs"
						variant="ghost"
						aria-label="Stop using this reference"
						onClick={reference.reset}
					>
						<X />
					</Button>
				</div>
				<p className="text-muted-foreground line-clamp-3 text-[11px] leading-relaxed italic">
					“{ref.text}”
				</p>
			</div>
		);
	}
	if (!activeTab.videoId && !reference.error) return null;
	return (
		<div className="flex flex-col gap-1.5">
			{activeTab.videoId ? (
				<Button
					size="xs"
					variant="outline"
					className="self-start"
					disabled={reference.loading}
					onClick={() =>
						activeTab.videoId && void reference.run(activeTab.videoId)
					}
				>
					<GraduationCap />
					{reference.loading ? "Reading its opening…" : "Learn from this video"}
				</Button>
			) : null}
			{reference.error ? (
				<ErrorNotice
					error={reference.error}
					title="Couldn't use this video"
					onRetry={
						activeTab.videoId
							? () => activeTab.videoId && void reference.run(activeTab.videoId)
							: undefined
					}
				/>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Score gauge + bars
// ---------------------------------------------------------------------------

const STROKE: Record<Tone, string> = {
	neutral: "text-muted-foreground",
	brand: "text-brand",
	emerald: "text-emerald-500",
	green: "text-lime-500",
	amber: "text-amber-500",
	orange: "text-orange-500",
	red: "text-red-500",
	sky: "text-sky-500",
	violet: "text-violet-500",
};

/** Half-circle 0–100 gauge. */
export function ScoreGauge({
	score,
	label,
	className,
}: {
	score: number;
	label?: string;
	className?: string;
}) {
	const value = Math.max(0, Math.min(100, Math.round(score)));
	const arc = "M10 60 A50 50 0 0 1 110 60";
	return (
		<div className={cn("flex flex-col items-center", className)}>
			<svg
				viewBox="0 0 120 68"
				className="w-36"
				role="img"
				aria-label={`${label ?? "Score"}: ${value} out of 100, ${scoreLabel(value)}`}
			>
				<path
					d={arc}
					pathLength={100}
					fill="none"
					stroke="currentColor"
					strokeWidth={10}
					strokeLinecap="round"
					className="text-muted"
				/>
				<path
					d={arc}
					pathLength={100}
					fill="none"
					stroke="currentColor"
					strokeWidth={10}
					strokeLinecap="round"
					strokeDasharray={`${Math.max(value, 0.5)} 100`}
					className={cn(
						"transition-[stroke-dasharray] duration-700 ease-out",
						STROKE[scoreTone(value)],
					)}
				/>
				<text
					x={60}
					y={54}
					textAnchor="middle"
					className="ovq-num fill-foreground text-[26px] font-semibold"
				>
					{value}
				</text>
				<text
					x={60}
					y={66}
					textAnchor="middle"
					className="fill-muted-foreground text-[9px]"
				>
					{scoreLabel(value)}
				</text>
			</svg>
		</div>
	);
}

const BAR: Record<Tone, string> = {
	neutral: "bg-muted-foreground",
	brand: "bg-brand",
	emerald: "bg-emerald-500",
	green: "bg-lime-500",
	amber: "bg-amber-500",
	orange: "bg-orange-500",
	red: "bg-red-500",
	sky: "bg-sky-500",
	violet: "bg-violet-500",
};

export function ScoreBar({
	label,
	score,
	hint,
}: {
	label: string;
	score: number | null;
	hint?: string;
}) {
	return (
		<div className="flex items-center gap-2 text-[11px]" title={hint}>
			<span className="w-24 shrink-0 truncate">{label}</span>
			<span className="bg-muted relative h-1.5 flex-1 overflow-hidden rounded-full">
				{score != null ? (
					<span
						className={cn(
							"absolute inset-y-0 left-0 rounded-full",
							BAR[scoreTone(score)],
						)}
						style={{ width: `${Math.max(2, score)}%` }}
					/>
				) : null}
			</span>
			<span className="ovq-num text-muted-foreground w-7 shrink-0 text-right">
				{score ?? "–"}
			</span>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Output block with a copy button
// ---------------------------------------------------------------------------

export function OutputBlock({
	title,
	copyText,
	copyLabel = "Copy",
	actions,
	children,
	className,
}: {
	title: ReactNode;
	copyText?: string | (() => string);
	copyLabel?: string;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"bg-card ring-foreground/7 flex flex-col gap-2 rounded-xl p-3 shadow-xs ring-1",
				className,
			)}
		>
			<header className="flex items-center justify-between gap-2">
				<h3 className="text-xs font-semibold">{title}</h3>
				<div className="flex shrink-0 items-center gap-1">
					{actions}
					{copyText != null ? (
						<CopyButton text={copyText} label={copyLabel} size={11} />
					) : null}
				</div>
			</header>
			{children}
		</section>
	);
}

/** Rough spoken length of a script at ~150 words per minute. */
export function spokenSeconds(text: string): number {
	const words = text.trim() ? text.trim().split(/\s+/).length : 0;
	return Math.round((words / 150) * 60);
}
