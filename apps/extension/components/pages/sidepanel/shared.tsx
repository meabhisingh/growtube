/** Pieces shared by several side-panel tools. */
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import { Settings, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { ext } from "@/lib/client";

import { useAiStatus } from "../status";
import { Notice } from "../ui/feedback";

export { useAiStatus } from "../status";

/** Scrollable body of a tool. */
export function ToolScroll({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div className="h-full overflow-y-auto overscroll-contain">
			<div className={cn("flex flex-col gap-3 p-3 pb-8", className)}>
				{children}
			</div>
		</div>
	);
}

/** Shown above AI features while no provider is ready. */
export function AiSetupNotice({ className }: { className?: string }) {
	const { data } = useAiStatus();
	if (!data || data.ready) return null;
	return (
		<Notice
			tone="warning"
			icon={Sparkles}
			title="Connect an AI provider to use this"
			className={className}
			actions={
				<Button size="xs" onClick={() => void ext.openOptions("ai")}>
					<Settings /> Set up AI
				</Button>
			}
		>
			{data.problem ??
				"GrowTube works with your own OpenAI-compatible key or a free local model (Ollama, LM Studio). No limits, no credits."}
		</Notice>
	);
}
