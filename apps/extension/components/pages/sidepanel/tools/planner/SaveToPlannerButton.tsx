/**
 * Small "Save to planner" button for side-panel tools. Adds the idea with
 * `addPlannerIdea`; once the title is in the planner it shows a check and a
 * click opens the Planner instead.
 *
 *   <SaveToPlannerButton idea={{ title, notes, source: "trends" }} />
 */
import { Button } from "@growtube/ui/components/button";
import { KanbanSquare, SquareCheckBig } from "lucide-react";

import { useStorageItem } from "@/lib/hooks";
import {
	addPlannerIdea,
	findPlannerIdeaByTitle,
	type NewPlannerIdea,
	PLANNER_MAX_IDEAS,
} from "@/lib/planner";
import { plannerIdeas } from "@/lib/settings";

import { IconButton } from "../../../ui/controls";
import { toast } from "../../../ui/toast";
import { usePanel } from "../../nav";

export function SaveToPlannerButton({
	idea,
	variant = "icon",
	className,
}: {
	idea: NewPlannerIdea;
	/** "icon": icon-only with tooltip; "button": small ghost button with text */
	variant?: "icon" | "button";
	className?: string;
}) {
	const { navigate } = usePanel();
	const [list] = useStorageItem(plannerIdeas);
	const saved = !!findPlannerIdeaByTitle(list, idea.title);

	const onClick = async () => {
		if (saved) {
			navigate("planner");
			return;
		}
		const r = await addPlannerIdea(idea);
		if (r.status === "added" || r.status === "duplicate") {
			toast(
				r.status === "added" ? "Saved to planner" : "Already in your planner",
				{
					tone: r.status === "added" ? "success" : "info",
					action: { label: "Open", onClick: () => navigate("planner") },
				},
			);
		} else if (r.status === "full") {
			toast(
				`The planner holds up to ${PLANNER_MAX_IDEAS} cards. Delete some first.`,
				{ tone: "error" },
			);
		}
	};

	const label = saved ? "In planner (open)" : "Save to planner";
	if (variant === "button") {
		return (
			<Button
				size="xs"
				variant="ghost"
				onClick={() => void onClick()}
				className={saved ? `text-brand ${className ?? ""}` : className}
			>
				{saved ? <SquareCheckBig /> : <KanbanSquare />}
				{saved ? "In planner" : "Save to planner"}
			</Button>
		);
	}
	return (
		<IconButton
			label={label}
			icon={saved ? SquareCheckBig : KanbanSquare}
			size="icon-xs"
			onClick={() => void onClick()}
			className={saved ? `text-brand ${className ?? ""}` : className}
		/>
	);
}
