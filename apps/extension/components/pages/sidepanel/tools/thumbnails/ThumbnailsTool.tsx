/**
 * Thumbnails: (a) similar thumbnails for a query, (b) preview your own
 * thumbnail in mock YouTube layouts next to real results, and live in the
 * real feed of a YouTube tab, (c) a local thumbnail checker, (d) AI
 * generator. The views stay mounted so switching keeps their state; the
 * image, title and competitor search are shared by Preview and Check, and a
 * generated image can be sent straight to the preview.
 */
import { ImageUp, LayoutGrid, ScanEye, Wand2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useLocalPref } from "../../../hooks";
import { Segmented } from "../../../ui/controls";
import type { ToolProps } from "../../nav";
import { ToolScroll } from "../../shared";
import { EMPTY_DRAFT, type PreviewDraft, useCompetitorSearch } from "./common";
import { SimilarThumbnails } from "./SimilarThumbnails";
import { ThumbnailChecker } from "./ThumbnailChecker";
import { ThumbnailGenerator } from "./ThumbnailGenerator";
import { ThumbnailPreview } from "./ThumbnailPreview";

type View = "similar" | "preview" | "check" | "generate";

export function ThumbnailsTool({ intent }: ToolProps) {
	const [view, setView] = useLocalPref<View>("thumbnails.view", "similar");
	/** Image shown in the preview (object URL or data URL), kept in memory only */
	const [previewImage, setPreviewImage] = useState<string | null>(null);
	const [draft, setDraft] = useState<PreviewDraft>(EMPTY_DRAFT);
	const competitors = useCompetitorSearch();
	/** Object URL we created (revoked when replaced or on unmount) */
	const objectUrl = useRef<string | null>(null);
	const [similarIntent, setSimilarIntent] = useState<{
		id: number;
		query: string;
	} | null>(null);
	const [generateIntent, setGenerateIntent] = useState<{
		id: number;
		prompt: string;
	} | null>(null);

	const setImage = useCallback((url: string | null, owned = false) => {
		if (objectUrl.current && objectUrl.current !== url)
			URL.revokeObjectURL(objectUrl.current);
		objectUrl.current = owned ? url : null;
		setPreviewImage(url);
	}, []);
	const setImageFile = useCallback(
		(file: File | null | undefined) => {
			if (file === null) return setImage(null);
			if (!file?.type.startsWith("image/")) return;
			setImage(URL.createObjectURL(file), true);
		},
		[setImage],
	);
	useEffect(
		() => () => {
			if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		},
		[],
	);

	// Paste an image anywhere in the panel while Preview or Check is open.
	useEffect(() => {
		if (view !== "preview" && view !== "check") return;
		const onPaste = (e: ClipboardEvent) => {
			const file = [...(e.clipboardData?.files ?? [])].find((f) =>
				f.type.startsWith("image/"),
			);
			if (!file) return;
			e.preventDefault();
			setImageFile(file);
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [view, setImageFile]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent || !(intent.view || intent.prefill)) return;
		const target: View =
			intent.view === "preview" ||
			intent.view === "generate" ||
			intent.view === "check"
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
					{ value: "check", label: "Check", icon: ScanEye },
					{ value: "generate", label: "AI generator", icon: Wand2 },
				]}
				className="max-w-full flex-wrap self-start"
				ariaLabel="Thumbnail tools"
			/>
			<div hidden={view !== "similar"}>
				<SimilarThumbnails intent={similarIntent} />
			</div>
			<div hidden={view !== "preview"}>
				<ThumbnailPreview
					image={previewImage}
					onImageFile={setImageFile}
					draft={draft}
					onDraftChange={setDraft}
					competitors={competitors}
				/>
			</div>
			<div hidden={view !== "check"}>
				<ThumbnailChecker
					image={previewImage}
					onImageFile={setImageFile}
					title={draft.title}
					competitors={competitors}
				/>
			</div>
			<div hidden={view !== "generate"}>
				<ThumbnailGenerator
					intent={generateIntent}
					onPreview={(url) => {
						setImage(url);
						setView("preview");
					}}
				/>
			</div>
		</ToolScroll>
	);
}
