/**
 * Canvas helpers for the Thumbnails tool (extension page only). Everything
 * runs locally: images are read from object/data URLs or from i.ytimg.com,
 * which answers with `Access-Control-Allow-Origin: *`, so `crossOrigin =
 * "anonymous"` keeps the canvas readable.
 */
import { extractVideoId } from "@growtube/shared/youtube";

export function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		if (/^https?:/i.test(src)) {
			img.crossOrigin = "anonymous";
			img.referrerPolicy = "no-referrer";
		}
		img.decoding = "async";
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error("Couldn't load this image."));
		img.src = src;
	});
}

/** Draws `img` center-cropped ("cover") into a w x h canvas. */
export function drawCover(
	img: CanvasImageSource & { width: number; height: number },
	w: number,
	h: number,
): CanvasRenderingContext2D {
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) throw new Error("Canvas isn't available.");
	const iw =
		(img as HTMLImageElement).naturalWidth || (img as { width: number }).width;
	const ih =
		(img as HTMLImageElement).naturalHeight ||
		(img as { height: number }).height;
	const scale = Math.max(w / iw, h / ih);
	const sw = w / scale;
	const sh = h / scale;
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = "high";
	ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, w, h);
	return ctx;
}

/**
 * 16:9 JPEG data URL, at most 1280x720 (what YouTube shows), small enough
 * for runtime messaging (~150-400 KB).
 */
export async function toPreviewJpeg(src: string): Promise<string> {
	const img = await loadImage(src);
	const w = Math.min(1280, Math.max(16, img.naturalWidth));
	const h = Math.round((w * 9) / 16);
	const canvas = drawCover(img, w, h).canvas;
	let url = canvas.toDataURL("image/jpeg", 0.86);
	if (url.length > 1_500_000) url = canvas.toDataURL("image/jpeg", 0.7);
	return url;
}

/** Square 96x96 JPEG data URL for a channel avatar. */
export async function toAvatarJpeg(file: File): Promise<string> {
	const src = URL.createObjectURL(file);
	try {
		const img = await loadImage(src);
		return drawCover(img, 96, 96).canvas.toDataURL("image/jpeg", 0.85);
	} finally {
		URL.revokeObjectURL(src);
	}
}

/** Thumbnail candidates for a video id, best first (hq720/maxres may 404). */
export function videoThumbUrls(videoId: string): string[] {
	const base = `https://i.ytimg.com/vi/${videoId}`;
	return [
		`${base}/maxresdefault.jpg`,
		`${base}/hq720.jpg`,
		`${base}/mqdefault.jpg`,
	];
}

/** Video id from a URL, a youtu.be link or a bare 11-char id. */
export function parseVideoRef(input: string): string | null {
	const text = input.trim();
	if (/^[\w-]{11}$/.test(text)) return text;
	return extractVideoId(text);
}

/**
 * Loads the first thumbnail that exists. YouTube answers a missing
 * maxresdefault with a 120x90 grey placeholder, which is skipped too.
 */
export async function loadVideoThumb(
	videoId: string,
): Promise<{ img: HTMLImageElement; url: string }> {
	let lastError: unknown = null;
	for (const url of videoThumbUrls(videoId)) {
		try {
			const img = await loadImage(url);
			if (img.naturalWidth > 200) return { img, url };
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError instanceof Error
		? lastError
		: new Error("No thumbnail found for this video.");
}
