/**
 * "Write an outline": hook, intro promise, sections with beats and retention
 * devices, CTA placement and chapter titles. Copy or download as Markdown.
 */
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Download, ListTree, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/common";
import { downloadText, slugify } from "@/components/injected/common/download";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { ai } from "@/lib/client";

import { useAsyncTask } from "../../../hooks";
import { Badge } from "../../../ui/badges";
import { Field, NativeSelect } from "../../../ui/controls";
import { ErrorNotice, LoadingBlock } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import type { ToolIntent } from "../../nav";
import { AiSetupNotice } from "../../shared";
import {
	modeForIntent,
	OutputBlock,
	ReferencePicker,
	type ReferenceTask,
} from "./shared";

type Outline = GeneratorOutput<"scriptOutline">;

const LENGTHS = [0, 1, 3, 5, 8, 10, 12, 15, 20, 30] as const;

export function OutlineMode({
	intent,
	reference,
}: {
	intent: ToolIntent | null;
	reference: ReferenceTask;
}) {
	const [topic, setTopic] = useState("");
	const [minutes, setMinutes] = useState<number>(10);
	const [audience, setAudience] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (modeForIntent(intent) === "outline" && intent?.prefill)
			setTopic(intent.prefill.slice(0, 500));
	}, [intent?.id]);

	const outline = useAsyncTask(() =>
		ai.generate("scriptOutline", {
			topic: topic.trim(),
			targetMinutes: minutes || undefined,
			audience: audience.trim() || undefined,
			referenceHook: reference.data?.text,
			referenceTitle: reference.data?.title,
		}),
	);

	const result = outline.data;

	return (
		<>
			<Section
				title="Write an outline"
				icon={ListTree}
				description="A structured plan built for retention: hook, promise, sections with open loops and pattern interrupts, CTAs and chapters."
			>
				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						if (topic.trim()) void outline.run();
					}}
				>
					<Field label="Topic or title" htmlFor="outline-topic">
						<Input
							id="outline-topic"
							value={topic}
							onChange={(e) => setTopic(e.target.value)}
							placeholder="e.g. How I edit a video in 30 minutes"
							maxLength={500}
						/>
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field label="Target length" htmlFor="outline-length">
							<NativeSelect
								id="outline-length"
								value={minutes}
								onChange={(e) => setMinutes(Number(e.target.value))}
							>
								{LENGTHS.map((m) => (
									<option key={m} value={m}>
										{m === 0 ? "Any" : `~${m} min`}
									</option>
								))}
							</NativeSelect>
						</Field>
						<Field label="Audience" htmlFor="outline-audience" hint="Optional">
							<Input
								id="outline-audience"
								value={audience}
								onChange={(e) => setAudience(e.target.value)}
								placeholder="e.g. beginner editors"
								maxLength={300}
							/>
						</Field>
					</div>
					<ReferencePicker reference={reference} />
					<AiSetupNotice />
					<Button type="submit" disabled={!topic.trim() || outline.loading}>
						<Sparkles /> {result ? "Write again" : "Write outline"}
					</Button>
				</form>
				{outline.error ? (
					<ErrorNotice
						error={outline.error}
						onRetry={() => void outline.run()}
					/>
				) : null}
			</Section>

			{outline.loading ? <LoadingBlock label="Planning the video…" /> : null}

			{result && !outline.loading ? (
				<OutlineView outline={result} topic={topic} />
			) : null}
		</>
	);
}

function OutlineView({ outline, topic }: { outline: Outline; topic: string }) {
	const markdown = () => outlineToMarkdown(outline);
	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">
					{outline.workingTitle || topic}
				</h3>
				<div className="flex items-center gap-1">
					<CopyButton text={markdown} label="Copy Markdown" size={11} />
					<Button
						size="xs"
						variant="outline"
						onClick={() =>
							downloadText(
								`${slugify(outline.workingTitle || topic)}-outline.md`,
								markdown(),
								"text/markdown",
							)
						}
					>
						<Download /> .md
					</Button>
				</div>
			</div>

			<OutputBlock title="Hook (first 30 s)" copyText={outline.hook}>
				<p className="border-brand/60 border-l-2 pl-2 text-xs leading-relaxed whitespace-pre-wrap italic">
					{outline.hook}
				</p>
				{outline.introPromise ? (
					<p className="text-muted-foreground text-[11px] leading-relaxed">
						<span className="text-foreground font-medium">Promise: </span>
						{outline.introPromise}
					</p>
				) : null}
			</OutputBlock>

			{outline.sections.map((s, i) => (
				<OutputBlock
					key={i}
					title={
						<span className="flex items-center gap-1.5">
							<span className="text-muted-foreground ovq-num">{i + 1}.</span>
							{s.title}
							{s.minutes ? (
								<span className="text-muted-foreground ovq-num font-normal">
									· ~{formatMinutes(s.minutes)}
								</span>
							) : null}
						</span>
					}
				>
					{s.beats.length ? (
						<ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs leading-relaxed">
							{s.beats.map((b) => (
								<li key={b}>{b}</li>
							))}
						</ul>
					) : null}
					{s.retention.length ? (
						<div className="flex flex-col gap-1">
							{s.retention.map((r) => (
								<div
									key={`${r.type}-${r.detail}`}
									className="flex items-start gap-1.5 text-[11px] leading-relaxed"
								>
									<Badge tone="violet" className="shrink-0">
										{r.type}
									</Badge>
									<span className="text-muted-foreground">{r.detail}</span>
								</div>
							))}
						</div>
					) : null}
				</OutputBlock>
			))}

			{outline.ctas.length ? (
				<OutputBlock title="Calls to action">
					<ul className="flex flex-col gap-1 text-xs leading-relaxed">
						{outline.ctas.map((c) => (
							<li key={`${c.placement}-${c.text}`}>
								<span className="font-medium">{c.placement}: </span>
								<span className="text-muted-foreground">{c.text}</span>
							</li>
						))}
					</ul>
				</OutputBlock>
			) : null}

			{outline.outro ? (
				<OutputBlock title="Outro" copyText={outline.outro}>
					<p className="text-xs leading-relaxed whitespace-pre-wrap">
						{outline.outro}
					</p>
				</OutputBlock>
			) : null}

			{outline.chapterTitles.length ? (
				<OutputBlock
					title="Suggested chapter titles"
					copyText={outline.chapterTitles.join("\n")}
				>
					<ol className="flex list-decimal flex-col gap-0.5 pl-4 text-xs leading-relaxed">
						{outline.chapterTitles.map((c) => (
							<li key={c}>{c}</li>
						))}
					</ol>
					<p className="text-muted-foreground text-[11px]">
						Add timestamps after filming, or generate them from the transcript
						in “Chapters & description”.
					</p>
				</OutputBlock>
			) : null}
		</>
	);
}

function formatMinutes(m: number): string {
	return m < 1 ? `${Math.round(m * 60)} s` : `${Math.round(m * 10) / 10} min`;
}

export function outlineToMarkdown(o: Outline): string {
	const lines: string[] = [`# ${o.workingTitle || "Video outline"}`, ""];
	lines.push("## Hook", "", o.hook, "");
	if (o.introPromise) lines.push(`**Promise:** ${o.introPromise}`, "");
	o.sections.forEach((s, i) => {
		lines.push(
			`## ${i + 1}. ${s.title}${s.minutes ? ` (~${formatMinutes(s.minutes)})` : ""}`,
			"",
		);
		for (const b of s.beats) lines.push(`- ${b}`);
		if (s.beats.length) lines.push("");
		if (s.retention.length) {
			lines.push("Retention:");
			for (const r of s.retention) lines.push(`- **${r.type}:** ${r.detail}`);
			lines.push("");
		}
	});
	if (o.ctas.length) {
		lines.push("## Calls to action", "");
		for (const c of o.ctas) lines.push(`- **${c.placement}:** ${c.text}`);
		lines.push("");
	}
	if (o.outro) lines.push("## Outro", "", o.outro, "");
	if (o.chapterTitles.length) {
		lines.push("## Chapters", "");
		o.chapterTitles.forEach((c, i) => {
			lines.push(`${i + 1}. ${c}`);
		});
		lines.push("");
	}
	return `${lines.join("\n").trim()}\n`;
}
