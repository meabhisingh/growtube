/**
 * "Score my hook": the AI rates the opening of a script (with sub-scores),
 * says what works and what to fix, and rewrites it in 3 styles.
 * The script only goes to the user's own AI provider, on click.
 */
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Textarea } from "@growtube/ui/components/textarea";
import { Check, Gauge, Sparkles, Wrench } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/common";
import type { GeneratorOutput } from "@/lib/ai/prompts";
import { ai } from "@/lib/client";

import { useAsyncTask } from "../../../hooks";
import { Badge } from "../../../ui/badges";
import { Field } from "../../../ui/controls";
import { ErrorNotice, LoadingBlock } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import type { ToolIntent } from "../../nav";
import { AiSetupNotice } from "../../shared";
import {
	modeForIntent,
	ReferencePicker,
	type ReferenceTask,
	ScoreBar,
	ScoreGauge,
	spokenSeconds,
} from "./shared";

type HookResult = GeneratorOutput<"hookScore">;

const SCRIPT_MAX = 12_000;

const SUBSCORES: {
	key: keyof HookResult["subscores"];
	label: string;
	hint: string;
}[] = [
	{
		key: "curiosity",
		label: "Curiosity",
		hint: "Opens a question the viewer needs answered",
	},
	{
		key: "clarity",
		label: "Clarity",
		hint: "Instantly clear what the video is about",
	},
	{
		key: "payoff",
		label: "Payoff promise",
		hint: "Promises a concrete, believable payoff",
	},
	{ key: "pacing", label: "Pacing", hint: "No wasted words" },
	{
		key: "titleMatch",
		label: "Title-hook match",
		hint: "Delivers on the title's promise right away (needs a title)",
	},
];

export function HookMode({
	intent,
	reference,
}: {
	intent: ToolIntent | null;
	reference: ReferenceTask;
}) {
	const [script, setScript] = useState("");
	const [title, setTitle] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (modeForIntent(intent) === "hook" && intent?.prefill)
			setScript(intent.prefill.slice(0, SCRIPT_MAX));
	}, [intent?.id]);

	const score = useAsyncTask(() =>
		ai.generate("hookScore", {
			script: script.trim(),
			title: title.trim() || undefined,
			referenceHook: reference.data?.text,
			referenceTitle: reference.data?.title,
		}),
	);

	const seconds = spokenSeconds(script);
	const result = score.data;

	return (
		<>
			<Section
				title="Score my hook"
				icon={Gauge}
				description="Paste your script or just its first 30–60 seconds. The AI rates the opening and writes 3 stronger versions."
			>
				<Field label="Planned title" htmlFor="hook-title" hint="Optional">
					<Input
						id="hook-title"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="e.g. I tried every budget camera so you don't have to"
						maxLength={200}
					/>
				</Field>
				<Field
					label="Script or opening"
					htmlFor="hook-script"
					trailing={
						script.trim() ? (
							<span className="ovq-num text-muted-foreground text-[11px]">
								~{seconds} s spoken
							</span>
						) : null
					}
					hint={
						seconds > 90
							? "Long script: the first minute is what gets scored."
							: undefined
					}
				>
					<Textarea
						id="hook-script"
						value={script}
						onChange={(e) => setScript(e.target.value)}
						maxLength={SCRIPT_MAX}
						placeholder="What would you normally say in the first 30 seconds?"
						className="max-h-72 min-h-28"
					/>
				</Field>
				<ReferencePicker reference={reference} />
				<AiSetupNotice />
				<Button
					onClick={() => void score.run()}
					disabled={!script.trim() || score.loading}
				>
					<Sparkles /> {result ? "Score again" : "Score my hook"}
				</Button>
				{score.error ? (
					<ErrorNotice error={score.error} onRetry={() => void score.run()} />
				) : null}
			</Section>

			{score.loading ? <LoadingBlock label="Reading your opening…" /> : null}

			{result && !score.loading ? <HookResultView result={result} /> : null}
		</>
	);
}

function HookResultView({ result }: { result: HookResult }) {
	return (
		<>
			<Section>
				<ScoreGauge score={result.score} label="Hook score" />
				{result.verdict ? (
					<p className="text-center text-xs leading-relaxed">
						{result.verdict}
					</p>
				) : null}
				<div className="flex flex-col gap-1.5">
					{SUBSCORES.map((s) => (
						<ScoreBar
							key={s.key}
							label={s.label}
							hint={s.hint}
							score={result.subscores[s.key]}
						/>
					))}
				</div>
			</Section>

			{result.works.length || result.fixes.length ? (
				<Section>
					{result.works.length ? (
						<div className="flex flex-col gap-1.5">
							<h3 className="text-xs font-semibold">What works</h3>
							<ul className="flex flex-col gap-1">
								{result.works.map((w) => (
									<li key={w} className="flex gap-1.5 text-xs leading-relaxed">
										<Check
											className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
											aria-hidden
										/>
										{w}
									</li>
								))}
							</ul>
						</div>
					) : null}
					{result.fixes.length ? (
						<div className="flex flex-col gap-1.5">
							<h3 className="text-xs font-semibold">What to fix</h3>
							<ul className="flex flex-col gap-1">
								{result.fixes.map((f) => (
									<li key={f} className="flex gap-1.5 text-xs leading-relaxed">
										<Wrench
											className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
											aria-hidden
										/>
										{f}
									</li>
								))}
							</ul>
						</div>
					) : null}
				</Section>
			) : null}

			{result.rewrites.length ? (
				<div className="flex flex-col gap-2">
					<div className="text-muted-foreground text-[11px]">
						Stronger openings
					</div>
					{result.rewrites.map((r, i) => (
						<article
							key={i}
							className="bg-card ring-foreground/7 flex flex-col gap-2 rounded-xl p-3 shadow-xs ring-1"
						>
							<div className="flex items-center justify-between gap-2">
								<Badge tone="brand">{r.style}</Badge>
								<CopyButton text={r.opening} label="Copy" size={11} />
							</div>
							<p className="text-xs leading-relaxed whitespace-pre-wrap">
								{r.opening}
							</p>
							{r.why ? (
								<p className="text-muted-foreground text-[11px] leading-relaxed">
									{r.why}
								</p>
							) : null}
						</article>
					))}
				</div>
			) : null}
		</>
	);
}
