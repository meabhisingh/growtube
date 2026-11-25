/** State and widgets shared by the Preview and Check views of the Thumbnails tool. */
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import { ImageUp, Trash2 } from "lucide-react";
import { type DragEvent, useRef, useState } from "react";

import { yt } from "@/lib/client";

import { useAsyncTask } from "../../../hooks";

/** What the user typed for their video (kept in memory only). */
export type PreviewDraft = {
	title: string;
	channelName: string;
	duration: string;
	/** 96x96 JPEG data URL, null = placeholder initial */
	avatar: string | null;
};

export const EMPTY_DRAFT: PreviewDraft = {
	title: "",
	channelName: "",
	duration: "12:34",
	avatar: null,
};

/** Real results for a topic/title: the mock grid's neighbours and the checker's comparison set. */
export function useCompetitorSearch() {
	return useAsyncTask((q: string) =>
		yt.search(q, { limit: 12, type: "video" }),
	);
}

export type CompetitorSearch = ReturnType<typeof useCompetitorSearch>;

/** Competitor thumbnails (long-form only), at most `max`. */
export function competitorThumbs(
	search: CompetitorSearch,
	max = 8,
): { videoId: string; title: string; thumbnail: string }[] {
	return (search.data?.results ?? [])
		.filter((r) => !r.isShort && r.thumbnail)
		.slice(0, max)
		.map((r) => ({
			videoId: r.videoId,
			title: r.title,
			thumbnail: r.thumbnail as string,
		}));
}

/** File picker + drop zone (paste is handled panel-wide by ThumbnailsTool). */
export function ImageDropZone({
	image,
	onImageFile,
	hint = "Drop, paste (Ctrl+V) or choose an image.",
}: {
	image: string | null;
	onImageFile: (file: File | null | undefined) => void;
	hint?: string;
}) {
	const [dragging, setDragging] = useState(false);
	const fileRef = useRef<HTMLInputElement | null>(null);
	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		onImageFile(e.dataTransfer.files[0]);
	};
	return (
		<>
			<input
				ref={fileRef}
				type="file"
				accept="image/*"
				className="hidden"
				onChange={(e) => {
					onImageFile(e.target.files?.[0]);
					e.target.value = "";
				}}
			/>
			<section
				aria-label="Thumbnail drop zone"
				onDragOver={(e) => {
					e.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={onDrop}
				className={cn(
					"flex items-center gap-3 rounded-lg border border-dashed p-2.5 transition-colors duration-150",
					dragging && "border-brand bg-brand-soft",
				)}
			>
				{image ? (
					<img
						src={image}
						alt=""
						className="aspect-video w-28 shrink-0 rounded-md object-cover"
					/>
				) : (
					<div className="bg-muted text-muted-foreground flex aspect-video w-28 shrink-0 items-center justify-center rounded-md">
						<ImageUp className="size-5" aria-hidden />
					</div>
				)}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<span className="text-muted-foreground text-[11px]">{hint}</span>
					<div className="flex gap-1.5">
						<Button size="xs" onClick={() => fileRef.current?.click()}>
							<ImageUp /> {image ? "Replace" : "Choose image"}
						</Button>
						{image ? (
							<Button
								size="xs"
								variant="ghost"
								onClick={() => onImageFile(null)}
							>
								<Trash2 /> Remove
							</Button>
						) : null}
					</div>
					<span className="text-muted-foreground text-[10px]">
						1280×720 (16:9) works best.
					</span>
				</div>
			</section>
		</>
	);
}
