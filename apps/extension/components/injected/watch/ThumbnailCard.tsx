/**
 * The playing video's thumbnail, large, with a download button.
 *
 * i.ytimg.com answers with `Access-Control-Allow-Origin: *`, so the content
 * script can fetch the image as a blob and save it with a temporary
 * <a download> link: no extra permission needed. Not every video has every
 * size (maxresdefault is missing on many older or low-res uploads; YouTube
 * then serves a 120x90 placeholder with a 404), so we walk down the sizes.
 */
import { thumbnailUrl } from "@growtube/shared/youtube";
import { Download, Images } from "lucide-react";
import { useEffect, useState } from "react";

import { ext } from "@/lib/client";
import type { VideoDetails } from "@/lib/youtube/types";

import { errorMessage } from "../common/async";
import { slugify } from "../common/download";
import { Card, Note } from "../common/ui";

type Quality = "maxresdefault" | "sddefault" | "hqdefault";

const QUALITIES: readonly { id: Quality; label: string }[] = [
	{ id: "maxresdefault", label: "1280×720" },
	{ id: "sddefault", label: "640×480" },
	{ id: "hqdefault", label: "480×360" },
];

/** Placeholder YouTube returns (with a 404) for a size that doesn't exist. */
const PLACEHOLDER_WIDTH = 120;

async function fetchThumbnail(
	videoId: string,
	quality: Quality,
): Promise<Blob | null> {
	const res = await fetch(thumbnailUrl(videoId, quality), {
		credentials: "omit",
	});
	if (!res.ok) return null;
	return res.blob();
}

/** First size that exists, best first. */
async function bestThumbnail(
	videoId: string,
): Promise<{ quality: Quality; blob: Blob } | null> {
	for (const { id } of QUALITIES) {
		const blob = await fetchThumbnail(videoId, id).catch(() => null);
		if (blob) return { quality: id, blob };
	}
	return null;
}

function saveBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.rel = "noopener";
	a.style.display = "none";
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ThumbnailCard({ details }: { details: VideoDetails }) {
	const { videoId, title } = details;
	// Best size this video has; null until probed (the <img> shows hqdefault,
	// which always exists, until then).
	const [best, setBest] = useState<Quality | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Probe with an <img>: cheap, cached by the browser, and the placeholder
	// is easy to spot by its width.
	useEffect(() => {
		let cancelled = false;
		const probe = (i: number) => {
			const q = QUALITIES[i];
			if (!q) return;
			const img = new Image();
			img.onload = () => {
				if (cancelled) return;
				if (img.naturalWidth > PLACEHOLDER_WIDTH) setBest(q.id);
				else probe(i + 1);
			};
			img.onerror = () => !cancelled && probe(i + 1);
			img.src = thumbnailUrl(videoId, q.id);
		};
		probe(0);
		return () => {
			cancelled = true;
		};
	}, [videoId]);

	const download = async () => {
		setBusy(true);
		setError(null);
		try {
			const found = best
				? await fetchThumbnail(videoId, best).then((blob) =>
						blob ? { quality: best, blob } : bestThumbnail(videoId),
					)
				: await bestThumbnail(videoId);
			if (!found) throw new Error("YouTube didn't return a thumbnail.");
			saveBlob(found.blob, `${slugify(title)}-${videoId}-thumbnail.jpg`);
		} catch (e) {
			setError(`Couldn't download the thumbnail. ${errorMessage(e)}`);
		} finally {
			setBusy(false);
		}
	};

	const openSimilar = () => {
		setError(null);
		// Must run in the click handler: opening the side panel needs the gesture.
		ext
			.openSidePanel({
				videoId,
				channelId: details.channelId || undefined,
				tool: "thumbnails",
				prefill: title,
			})
			.catch((e: unknown) => setError(errorMessage(e)));
	};

	const size = QUALITIES.find((q) => q.id === best)?.label;

	return (
		<Card
			title="Thumbnail"
			actions={
				size ? <span className="ovq-small ovq-muted">{size}</span> : undefined
			}
		>
			<img
				className="ovq-thumb-large"
				src={thumbnailUrl(videoId, best ?? "hqdefault")}
				alt={`Thumbnail of “${title}”`}
				loading="lazy"
			/>
			<div className="ovq-thumb-actions">
				<button
					type="button"
					className="ovq-btn primary small"
					onClick={() => void download()}
					disabled={busy}
				>
					<Download size={14} aria-hidden="true" />
					{busy ? "Downloading…" : "Download"}
				</button>
				<button type="button" className="ovq-btn small" onClick={openSimilar}>
					<Images size={14} aria-hidden="true" />
					See similar
				</button>
			</div>
			{error && <Note tone="error">{error}</Note>}
		</Card>
	);
}
