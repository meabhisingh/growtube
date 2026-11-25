/**
 * Local thumbnail checker: plain canvas statistics, no AI, nothing uploaded.
 *
 * - brightness / contrast: mean and standard deviation of luma (320x180)
 * - colorfulness: Hasler & Süsstrunk (2003) on the opponent channels, plus
 *   mean HSV saturation
 * - clutter: share of strong Sobel edges at 320x180
 * - mobile readability: rendered at 168x94 (YouTube's smallest list size),
 *   split into 12 px cells; the busiest cells are where text and small
 *   details live, and their local luma spread (p10..p90) estimates whether
 *   they stay legible
 * - faces: the Shape Detection API's FaceDetector, only when the browser has it
 * - stand-out: CIE76 distance (Lab) between this thumbnail's average color
 *   and the competitors' average colors
 *
 * Thresholds are heuristics tuned on typical YouTube thumbnails; the
 * checklist says "estimate" where it is one.
 */
import { drawCover, loadImage } from "./image-utils";

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export type ImageStats = {
	/** 0..1 mean luma */
	brightness: number;
	/** 0..1 luma standard deviation (RMS contrast) */
	contrast: number;
	/** Hasler-Süsstrunk colorfulness (0 ≈ grey, >60 very colorful) */
	colorfulness: number;
	/** 0..1 mean HSV saturation */
	saturation: number;
	/** 0..1 share of strong-edge pixels */
	edgeDensity: number;
	/** 0..1 local contrast of detailed regions at 168x94; null = no fine detail */
	mobileLegibility: number | null;
	/** 0..1 share of 168x94 cells that are fine detail */
	mobileDetailShare: number;
	average: Rgb;
	averageLab: Lab;
};

export type FaceStats = { count: number; largestArea: number };

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export type CheckItem = {
	id: string;
	label: string;
	status: CheckStatus;
	/** Short measured value, e.g. "62%" */
	value: string;
	/** What it means / what to change */
	tip: string;
};

export type CheckReport = {
	score: number;
	items: CheckItem[];
	stats: ImageStats;
};

type ImageLike = CanvasImageSource & { width: number; height: number };

/** Typed-array read without `noUncheckedIndexedAccess` noise (indices are in range). */
const px = (a: ArrayLike<number>, i: number): number => a[i] as number;

// ---------------------------------------------------------------------------
// Pixel statistics
// ---------------------------------------------------------------------------

function luma(data: Uint8ClampedArray): Float32Array {
	const out = new Float32Array(data.length / 4);
	for (let i = 0, p = 0; i < data.length; i += 4, p++)
		out[p] =
			0.2126 * px(data, i) +
			0.7152 * px(data, i + 1) +
			0.0722 * px(data, i + 2);
	return out;
}

/** Sobel gradient magnitude (0..~1440) per pixel; borders are 0. */
function sobel(y: Float32Array, w: number, h: number): Float32Array {
	const out = new Float32Array(w * h);
	for (let r = 1; r < h - 1; r++) {
		for (let c = 1; c < w - 1; c++) {
			const i = r * w + c;
			const tl = px(y, i - w - 1);
			const t = px(y, i - w);
			const tr = px(y, i - w + 1);
			const l = px(y, i - 1);
			const rr = px(y, i + 1);
			const bl = px(y, i + w - 1);
			const b = px(y, i + w);
			const br = px(y, i + w + 1);
			const gx = tr + 2 * rr + br - tl - 2 * l - bl;
			const gy = bl + 2 * b + br - tl - 2 * t - tr;
			out[i] = Math.sqrt(gx * gx + gy * gy);
		}
	}
	return out;
}

/** Gradient above which a pixel counts as a "strong" edge. */
const EDGE = 160;

function srgbToLinear(v: number): number {
	const c = v / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rgbToLab([r, g, b]: Rgb): Lab {
	const R = srgbToLinear(r);
	const G = srgbToLinear(g);
	const B = srgbToLinear(b);
	const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
	const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
	const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
	const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
	const fx = f(x);
	const fy = f(y);
	const fz = f(z);
	return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function deltaE([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
	return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** Average color (sRGB mean) of an image, center-cropped to 16:9. */
export function averageColor(img: ImageLike): Rgb {
	const { data } = drawCover(img, 64, 36).getImageData(0, 0, 64, 36);
	let r = 0;
	let g = 0;
	let b = 0;
	const n = data.length / 4;
	for (let i = 0; i < data.length; i += 4) {
		r += px(data, i);
		g += px(data, i + 1);
		b += px(data, i + 2);
	}
	return [r / n, g / n, b / n];
}

function percentile(sorted: number[], p: number): number {
	if (!sorted.length) return 0;
	const i = Math.min(
		sorted.length - 1,
		Math.max(0, Math.round(p * (sorted.length - 1))),
	);
	return px(sorted, i);
}

export function analyzeImage(img: ImageLike): ImageStats {
	// ---- 320x180: global statistics ----
	const W = 320;
	const H = 180;
	const { data } = drawCover(img, W, H).getImageData(0, 0, W, H);
	const n = W * H;
	const y = luma(data);
	let sumY = 0;
	let sumY2 = 0;
	let sumSat = 0;
	let sumRg = 0;
	let sumRg2 = 0;
	let sumYb = 0;
	let sumYb2 = 0;
	let sumR = 0;
	let sumG = 0;
	let sumB = 0;
	for (let i = 0, p = 0; i < data.length; i += 4, p++) {
		const r = px(data, i);
		const g = px(data, i + 1);
		const b = px(data, i + 2);
		sumR += r;
		sumG += g;
		sumB += b;
		sumY += px(y, p);
		sumY2 += px(y, p) * px(y, p);
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		sumSat += max === 0 ? 0 : (max - min) / max;
		const rg = r - g;
		const yb = 0.5 * (r + g) - b;
		sumRg += rg;
		sumRg2 += rg * rg;
		sumYb += yb;
		sumYb2 += yb * yb;
	}
	const meanY = sumY / n;
	const stdY = Math.sqrt(Math.max(0, sumY2 / n - meanY * meanY));
	const mRg = sumRg / n;
	const mYb = sumYb / n;
	const sRg = Math.sqrt(Math.max(0, sumRg2 / n - mRg * mRg));
	const sYb = Math.sqrt(Math.max(0, sumYb2 / n - mYb * mYb));
	const colorfulness = Math.hypot(sRg, sYb) + 0.3 * Math.hypot(mRg, mYb);

	const grad = sobel(y, W, H);
	let strong = 0;
	for (let r = 1; r < H - 1; r++)
		for (let c = 1; c < W - 1; c++) if (px(grad, r * W + c) > EDGE) strong++;
	const edgeDensity = strong / ((W - 2) * (H - 2));

	// ---- 168x94: mobile readability ----
	const w = 168;
	const h = 94;
	const small = drawCover(img, w, h).getImageData(0, 0, w, h).data;
	const ys = luma(small);
	const gs = sobel(ys, w, h);
	const CELL = 12;
	const cells: { edges: number; spread: number }[] = [];
	for (let cy = 0; cy + CELL <= h; cy += CELL) {
		for (let cx = 0; cx + CELL <= w; cx += CELL) {
			let edges = 0;
			const values: number[] = [];
			for (let r = cy; r < cy + CELL; r++) {
				for (let c = cx; c < cx + CELL; c++) {
					const i = r * w + c;
					values.push(px(ys, i));
					if (px(gs, i) > EDGE) edges++;
				}
			}
			values.sort((a, b) => a - b);
			cells.push({
				edges: edges / (CELL * CELL),
				spread: (percentile(values, 0.9) - percentile(values, 0.1)) / 255,
			});
		}
	}
	// Text-like cells: many strong edges in a small area.
	const detailed = cells.filter((c) => c.edges >= 0.18);
	let mobileLegibility: number | null = null;
	if (detailed.length) {
		const spreads = detailed.map((c) => c.spread).sort((a, b) => a - b);
		mobileLegibility = percentile(spreads, 0.5);
	}

	const average: Rgb = [sumR / n, sumG / n, sumB / n];
	return {
		brightness: meanY / 255,
		contrast: stdY / 255,
		colorfulness,
		saturation: sumSat / n,
		edgeDensity,
		mobileLegibility,
		mobileDetailShare: cells.length ? detailed.length / cells.length : 0,
		average,
		averageLab: rgbToLab(average),
	};
}

// ---------------------------------------------------------------------------
// Faces (optional browser API)
// ---------------------------------------------------------------------------

type FaceDetectorCtor = new (opts?: {
	fastMode?: boolean;
	maxDetectedFaces?: number;
}) => {
	detect: (
		image: ImageBitmapSource,
	) => Promise<{ boundingBox: DOMRectReadOnly }[]>;
};

export function hasFaceDetector(): boolean {
	return (
		typeof (globalThis as { FaceDetector?: unknown }).FaceDetector ===
		"function"
	);
}

/** null when the browser has no FaceDetector (or it fails). */
export async function detectFaces(img: ImageLike): Promise<FaceStats | null> {
	const Ctor = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector;
	if (typeof Ctor !== "function") return null;
	try {
		const W = 640;
		const H = 360;
		const canvas = drawCover(img, W, H).canvas;
		const faces = await new Ctor({
			fastMode: true,
			maxDetectedFaces: 10,
		}).detect(canvas);
		let largest = 0;
		for (const f of faces)
			largest = Math.max(
				largest,
				(f.boundingBox.width * f.boundingBox.height) / (W * H),
			);
		return { count: faces.length, largestArea: largest };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Piecewise-linear map through [x, y] points (clamped at both ends). */
function curve(x: number, points: [number, number][]): number {
	let [x0, y0] = points[0] ?? [0, 0];
	if (x <= x0) return y0;
	for (const [x1, y1] of points.slice(1)) {
		if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
		x0 = x1;
		y0 = y1;
	}
	return y0;
}

function statusOf(sub: number): CheckStatus {
	return sub >= 0.75 ? "pass" : sub >= 0.45 ? "warn" : "fail";
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

const HUES = [
	[15, "red"],
	[45, "orange"],
	[70, "yellow"],
	[160, "green"],
	[200, "cyan"],
	[255, "blue"],
	[290, "purple"],
	[335, "pink"],
	[360, "red"],
] as const;

/** "warm orange", "dark blue", "grey"… for tips. */
export function colorName([r, g, b]: Rgb): string {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const l = (max + min) / 510;
	const s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
	if (s < 0.15)
		return l < 0.25 ? "near-black" : l > 0.8 ? "near-white" : "grey";
	let h = 0;
	const d = max - min;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	h = (h * 60 + 360) % 360;
	const name = HUES.find(([limit]) => h < limit)?.[1] ?? "red";
	return l < 0.3 ? `dark ${name}` : l > 0.7 ? `light ${name}` : name;
}

/** Hue opposite the competitors' average, as a suggestion. */
function contrastingSuggestion(avg: Rgb): string {
	const name = colorName(avg);
	if (/grey|black|white/.test(name))
		return "a saturated accent color (yellow, red or cyan)";
	const [r, g, b] = avg;
	const opposite: Rgb = [255 - r, 255 - g, 255 - b];
	return `${colorName(opposite).replace(/^(dark|light) /, "")} tones`;
}

export function buildReport(
	stats: ImageStats,
	opts: {
		faces: FaceStats | null;
		faceDetector: boolean;
		competitors: Rgb[] | null;
	},
): CheckReport {
	const items: (CheckItem & { weight: number; sub: number })[] = [];
	const add = (
		weight: number,
		sub: number,
		item: Omit<CheckItem, "status"> & { status?: CheckStatus },
	) =>
		items.push({ weight, sub, status: item.status ?? statusOf(sub), ...item });

	// Brightness
	const b = stats.brightness;
	const bSub = curve(b, [
		[0.08, 0],
		[0.2, 0.35],
		[0.32, 0.85],
		[0.4, 1],
		[0.7, 1],
		[0.82, 0.6],
		[0.95, 0.15],
	]);
	add(15, bSub, {
		id: "brightness",
		label: "Brightness",
		value: pct(b),
		tip:
			b < 0.32
				? "Quite dark: it sinks into YouTube's dark theme. Lift the exposure or light the subject so it pops."
				: b > 0.78
					? "Very bright: it washes out on YouTube's white background. Add a darker area or a stronger subject."
					: "Well exposed for both light and dark themes.",
	});

	// Contrast
	const c = stats.contrast;
	const cSub = curve(c, [
		[0.05, 0],
		[0.12, 0.45],
		[0.18, 0.8],
		[0.22, 1],
	]);
	add(20, cSub, {
		id: "contrast",
		label: "Contrast",
		value: pct(c),
		tip:
			c < 0.18
				? "Flat: subject and background have similar brightness. Darken the background or add a rim light / outline around the subject."
				: "Strong tonal contrast: the subject separates from the background.",
	});

	// Colorfulness
	const m = stats.colorfulness;
	const mSub = curve(m, [
		[8, 0.1],
		[20, 0.45],
		[35, 0.8],
		[50, 1],
	]);
	add(15, mSub, {
		id: "color",
		label: "Colorfulness",
		value: `${Math.round(m)} · sat ${pct(stats.saturation)}`,
		tip:
			m < 35
				? "Muted colors get skipped in a busy feed. Push saturation on the subject or add one bold accent color."
				: m > 110
					? "Very saturated: fine for attention, but keep skin tones natural."
					: "Vivid enough to catch the eye in the feed.",
	});

	// Clutter
	const e = stats.edgeDensity;
	const eSub = curve(e, [
		[0.1, 1],
		[0.16, 0.8],
		[0.22, 0.5],
		[0.32, 0.15],
	]);
	add(15, eSub, {
		id: "clutter",
		label: "Clutter (estimate)",
		value: `${pct(e)} edges`,
		tip:
			e > 0.16
				? "Busy: lots of small details compete for attention. Blur or simplify the background and keep one focal point and 3 words or fewer."
				: "Clean composition with a clear focal point.",
	});

	// Mobile readability
	if (stats.mobileLegibility == null) {
		add(0, 1, {
			id: "mobile",
			label: "Readable at mobile size",
			status: "pass",
			value: "no small text",
			tip: "No fine detail or small text found at 168x94, so nothing gets lost on phones.",
		});
	} else {
		const l = stats.mobileLegibility;
		let lSub = curve(l, [
			[0.2, 0.1],
			[0.35, 0.45],
			[0.5, 0.8],
			[0.6, 1],
		]);
		if (stats.mobileDetailShare > 0.45) lSub = Math.min(lSub, 0.5);
		add(20, lSub, {
			id: "mobile",
			label: "Readable at mobile size (estimate)",
			value: `${pct(l)} local contrast`,
			tip:
				stats.mobileDetailShare > 0.45
					? "At 168x94 most of the image is fine detail, so text and faces blur together. Use fewer, larger elements."
					: l < 0.5
						? "Text or details lose contrast when small. Use thicker, bigger text with a dark outline or shadow, on a plain backdrop."
						: "Text and details keep their contrast at phone size.",
		});
	}

	// Faces
	if (!opts.faceDetector || !opts.faces) {
		add(0, 1, {
			id: "faces",
			label: "Faces",
			status: "skip",
			value: "not checked",
			tip: "This browser has no built-in face detector (Chrome's Shape Detection API), so this check is skipped.",
		});
	} else {
		const { count, largestArea } = opts.faces;
		const fSub =
			count === 0
				? 0.55
				: largestArea >= 0.04
					? 1
					: largestArea >= 0.015
						? 0.7
						: 0.5;
		add(10, fSub, {
			id: "faces",
			label: "Faces",
			value:
				count === 0
					? "none"
					: `${count} · largest ${pct(largestArea)} of frame`,
			tip:
				count === 0
					? "No face found. A clear, expressive face often lifts clicks, if it fits your niche."
					: largestArea < 0.04
						? "The face is small: on phones it becomes a few pixels. Crop in so the face fills at least ~1/6 of the height."
						: count > 3
							? "Several faces: make one the clear focus."
							: "A clear face that reads at small sizes.",
		});
	}

	// Stand-out vs competitors
	if (opts.competitors?.length) {
		const rgbs = opts.competitors;
		const labs = rgbs.map(rgbToLab);
		const meanOf = (list: number[][]) =>
			[0, 1, 2].map(
				(k) => list.reduce((s, x) => s + px(x, k), 0) / list.length,
			) as [number, number, number];
		const mean: Lab = meanOf(labs);
		const meanRgb: Rgb = meanOf(rgbs);
		const dMean = deltaE(stats.averageLab, mean);
		const dNearest = Math.min(...labs.map((x) => deltaE(stats.averageLab, x)));
		const d = 0.7 * dMean + 0.3 * dNearest;
		const sSub = curve(d, [
			[4, 0.15],
			[10, 0.45],
			[18, 0.8],
			[26, 1],
		]);
		const theirs = colorName(meanRgb);
		const mine = colorName(stats.average);
		add(15, sSub, {
			id: "standout",
			label: "Stands out from competitors",
			value: `ΔE ${Math.round(dMean)} vs ${opts.competitors.length}`,
			tip:
				d < 18
					? `Competitors average ${theirs} and yours is ${mine}: it blends in. Try ${contrastingSuggestion(meanRgb)}${mean[0] > 55 ? " or a darker frame" : mean[0] < 35 ? " or a brighter frame" : ""}.`
					: `Yours (${mine}) differs clearly from the competitors' average (${theirs}).`,
		});
	} else {
		add(0, 1, {
			id: "standout",
			label: "Stands out from competitors",
			status: "skip",
			value: "no comparison",
			tip: "Search competitors (your title or topic) to compare colors with today's real results.",
		});
	}

	const weighted = items.filter((i) => i.weight > 0);
	const total = weighted.reduce((s, i) => s + i.weight, 0);
	const score = total
		? Math.round(
				(weighted.reduce((s, i) => s + i.weight * i.sub, 0) / total) * 100,
			)
		: 0;
	return {
		score,
		stats,
		items: items.map(({ weight: _w, sub: _s, ...item }) => item),
	};
}

/** Average colors of the competitors' thumbnails (failed loads skipped). */
export async function competitorColors(urls: string[]): Promise<Rgb[]> {
	const results = await Promise.allSettled(
		urls.map(async (url) => averageColor(await loadImage(url))),
	);
	return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}
