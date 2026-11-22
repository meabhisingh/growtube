/**
 * Thumbnails: (a) similar thumbnails for a query, (b) preview your own
 * thumbnail in mock YouTube layouts next to real results, (c) AI generator.
 * The three views stay mounted so switching keeps their state; a generated
 * image can be sent straight to the preview.
 */
import { ImageUp, LayoutGrid, Wand2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useLocalPref } from "../../../hooks";
import { Segmented } from "../../../ui/controls";
import type { ToolProps } from "../../nav";
import { ToolScroll } from "../../shared";
import { SimilarThumbnails } from "./SimilarThumbnails";
import { ThumbnailGenerator } from "./ThumbnailGenerator";
import { ThumbnailPreview } from "./ThumbnailPreview";

type View = "similar" | "preview" | "generate";

export function ThumbnailsTool({ intent }: ToolProps) {
	const [view, setView] = useLocalPref<View>("thumbnails.view", "similar");
	/** Image shown in the preview (object URL or data URL), kept in memory only */
	const [previewImage, setPreviewImage] = useState<string | null>(null);
	const [similarIntent, setSimilarIntent] = useState<{
		id: number;
		query: string;
	} | null>(null);
	const [generateIntent, setGenerateIntent] = useState<{
		id: number;
		prompt: string;
	} | null>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent || !(intent.view || intent.prefill)) return;
		const target: View =
			intent.view === "preview" || intent.view === "generate"
				? intent.view
				: "similar";
		setView(target);
		if (intent.prefill) {
			if (target === "generate")
				setGenerateIntent({ id: intent.id, prompt: intent.prefill });
			else if (target === "similar")
				setSimilarIntent({ id: intent.id, query: intent.prefill });
		}
	}, [intent?.id]);

	return (
		<ToolScroll>
			<Segmented<View>
				value={view}
				onChange={setView}
				options={[
					{ value: "similar", label: "Similar", icon: LayoutGrid },
					{ value: "preview", label: "Preview", icon: ImageUp },
					{ value: "generate", label: "AI generator", icon: Wand2 },
				]}
				className="self-start"
				ariaLabel="Thumbnail tools"
			/>
			<div hidden={view !== "similar"}>
				<SimilarThumbnails intent={similarIntent} />
			</div>
			<div hidden={view !== "preview"}>
				<ThumbnailPreview
					image={previewImage}
					onImageChange={setPreviewImage}
				/>
			</div>
			<div hidden={view !== "generate"}>
				<ThumbnailGenerator
					intent={generateIntent}
					onPreview={(url) => {
						setPreviewImage(url);
						setView("preview");
					}}
				/>
			</div>
		</ToolScroll>
	);
}
