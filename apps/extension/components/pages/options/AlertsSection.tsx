/** Options page: competitor outlier alerts (same settings as the Competitors tool). */
import { Button } from "@growtube/ui/components/button";
import { BellRing, PanelRightOpen } from "lucide-react";

import { useStorageItem } from "@/lib/hooks";
import { competitors } from "@/lib/settings";
import { openSidePanelFromPage } from "@/lib/sidepanel";

import { AlertSettingsForm } from "../alerts";
import { Section } from "../ui/layout";
import { toast } from "../ui/toast";

export function AlertsSection() {
	const [list] = useStorageItem(competitors);
	return (
		<Section
			id="alerts"
			title="Competitor alerts"
			icon={BellRing}
			description="A notification when a competitor's new video does far better than their usual. Checked in this browser about once an hour; nothing is sent to the GrowTube server."
		>
			<AlertSettingsForm idPrefix="opt-alerts" />
			<div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
				{list.length === 0
					? "Add competitors in the toolkit to get alerts."
					: `Watching ${list.length} competitor${list.length === 1 ? "" : "s"}.`}
				<Button
					size="xs"
					variant="outline"
					onClick={() =>
						void openSidePanelFromPage({ tool: "competitors" }).catch(() =>
							toast("Open a normal browser tab to use the side panel.", {
								tone: "error",
							}),
						)
					}
				>
					<PanelRightOpen /> Recent alerts
				</Button>
			</div>
		</Section>
	);
}
