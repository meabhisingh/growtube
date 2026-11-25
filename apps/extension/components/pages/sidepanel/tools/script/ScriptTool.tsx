/**
 * Script tool: hook score, retention outline, and chapters + description
 * from a transcript. All three modes stay mounted so switching keeps drafts.
 *
 * Intents: `view` "hook" | "outline" | "chapters" picks the mode (also via
 * the tool aliases "hook", "outline", "chapters"); a `videoId` without a view
 * opens "chapters" for that video; `prefill` fills the hook script / outline
 * topic / chapters video link of the targeted mode.
 */
import { Gauge, ListOrdered, ListTree } from "lucide-react";
import { useEffect, useState } from "react";

import { Segmented } from "../../../ui/controls";
import type { ToolProps } from "../../nav";
import { ToolScroll } from "../../shared";
import { ChaptersMode } from "./ChaptersMode";
import { HookMode } from "./HookMode";
import { OutlineMode } from "./OutlineMode";
import { modeForIntent, type ScriptMode, useReferenceHook } from "./shared";

const MODES = [
	{ value: "hook", label: "Hook", icon: Gauge, title: "Score my hook" },
	{
		value: "outline",
		label: "Outline",
		icon: ListTree,
		title: "Write an outline",
	},
	{
		value: "chapters",
		label: "Chapters",
		icon: ListOrdered,
		title: "Chapters & description",
	},
] as const;

export function ScriptTool({ intent, active }: ToolProps) {
	const [mode, setMode] = useState<ScriptMode>(
		() => modeForIntent(intent) ?? "hook",
	);
	// Shared by Hook and Outline: the active video's opening as a reference.
	const reference = useReferenceHook();

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		const m = modeForIntent(intent);
		if (m) setMode(m);
	}, [intent?.id]);

	return (
		<ToolScroll>
			<Segmented<ScriptMode>
				value={mode}
				onChange={setMode}
				options={MODES}
				ariaLabel="Script tool mode"
				className="self-stretch [&>button]:flex-1"
			/>
			<div className={mode === "hook" ? "flex flex-col gap-3" : "hidden"}>
				<HookMode intent={intent} reference={reference} />
			</div>
			<div className={mode === "outline" ? "flex flex-col gap-3" : "hidden"}>
				<OutlineMode intent={intent} reference={reference} />
			</div>
			<div className={mode === "chapters" ? "flex flex-col gap-3" : "hidden"}>
				<ChaptersMode intent={intent} active={active && mode === "chapters"} />
			</div>
		</ToolScroll>
	);
}
