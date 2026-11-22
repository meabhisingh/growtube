// Builds every GrowTube logo asset from the brand master
// (assets/brand/logo-source.png, a lossless copy of the owner's artwork):
//   public/icon/{16,32,48,96,128}.png      extension icons
//   store/images/store-icon-128.png        Chrome Web Store icon (96px art, 16px padding)
//   components/common/logo-data.ts         inlined image for <Logo>
//   ../web/public/favicon-{16,32}.png, apple-touch-icon.png,
//   icon-{192,512}.png, logo.png (linked from apps/web/index.html)
// Run with `pnpm --filter extension icons` (or `node scripts/generate-icons.mjs`).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..", "..");
const MASTER = join(appRoot, "assets", "brand", "logo-source.png");
const ICON_DIR = join(appRoot, "public", "icon");
const STORE_ICON = join(appRoot, "store", "images", "store-icon-128.png");
const LOGO_DATA = join(appRoot, "components", "common", "logo-data.ts");
const WEB_PUBLIC = join(appRoot, "..", "web", "public");

/** Transparent margin around the trimmed artwork, per side, as a fraction of the canvas. */
const MARGIN = 0.05;
/**
 * The master's edges carry a faint alpha haze (1-8) and its body sits at
 * alpha 250-254. Levels on alpha drop the haze and make the body opaque,
 * keeping the anti-aliased edge in between.
 */
const ALPHA_LO = 8;
const ALPHA_HI = 248;
/**
 * Chrome Web Store icon: 128x128 with the artwork in the middle 96x96 and
 * 16px of transparent padding per side (developer.chrome.com/docs/webstore/images).
 */
const STORE_SIZE = 128;
const STORE_ART = 96;
/** <Logo> is drawn at up to 36px, so the inlined image is 2x that. */
const INLINE_SIZE = 72;
/** Logo size inside the 180px opaque apple-touch-icon. */
const TOUCH_SIZE = 180;
const TOUCH_INNER = 148;

const PNG = { compressionLevel: 9, adaptiveFiltering: true, palette: false };

/** Trimmed, cleaned master centred on a square transparent canvas (raw RGBA). */
async function loadSquareMaster() {
	const { data, info } = await sharp(MASTER)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	const { width, height } = info;
	let x0 = width;
	let y0 = height;
	let x1 = -1;
	let y1 = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const k = (y * width + x) * 4;
			const a = Math.round(
				((data[k + 3] - ALPHA_LO) * 255) / (ALPHA_HI - ALPHA_LO),
			);
			if (a <= 0) {
				data.fill(0, k, k + 4);
				continue;
			}
			data[k + 3] = Math.min(255, a);
			if (x < x0) x0 = x;
			if (x > x1) x1 = x;
			if (y < y0) y0 = y;
			if (y > y1) y1 = y;
		}
	}
	if (x1 < 0) throw new Error(`${MASTER} has no visible pixels`);
	const w = x1 - x0 + 1;
	const h = y1 - y0 + 1;
	const side = Math.ceil(Math.max(w, h) / (1 - 2 * MARGIN));
	const left = Math.floor((side - w) / 2);
	const top = Math.floor((side - h) / 2);
	const square = await sharp(data, { raw: { width, height, channels: 4 } })
		.extract({ left: x0, top: y0, width: w, height: h })
		.extend({
			left,
			right: side - w - left,
			top,
			bottom: side - h - top,
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.raw()
		.toBuffer();
	return { data: square, side };
}

const master = await loadSquareMaster();

/**
 * Master resized to `size` square. 16 and 32 get a light sharpen so the G
 * still reads; stronger settings leave grey specks along the edges.
 */
function scaled(size) {
	const img = sharp(master.data, {
		raw: { width: master.side, height: master.side, channels: 4 },
	}).resize(size, size, { kernel: sharp.kernel.lanczos3 });
	return size <= 32 ? img.sharpen({ sigma: 0.5, m1: 0.4, m2: 0.8 }) : img;
}

function write(file, buf) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, buf);
	const rel = relative(repoRoot, file).replaceAll("\\", "/");
	console.log(`${rel.padEnd(46)} ${buf.length.toLocaleString("en-US")} B`);
}

const png = (size) => scaled(size).png(PNG).toBuffer();

// Extension icons.
for (const size of [16, 32, 48, 96, 128]) {
	write(join(ICON_DIR, `${size}.png`), await png(size));
}

// Store icon: the square master already has MARGIN around the artwork, so
// scale it until the artwork itself is STORE_ART wide, then pad to 128.
{
	const inner = Math.round(STORE_ART / (1 - 2 * MARGIN));
	const pad = Math.floor((STORE_SIZE - inner) / 2);
	write(
		STORE_ICON,
		await sharp(await png(inner))
			.extend({
				left: pad,
				right: STORE_SIZE - inner - pad,
				top: pad,
				bottom: STORE_SIZE - inner - pad,
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.png(PNG)
			.toBuffer(),
	);
}

// <Logo> renders in shadow DOM on youtube.com, where chrome-extension://
// URLs would need web_accessible_resources, so the image is inlined.
const inline = await sharp(await png(INLINE_SIZE))
	.webp({ quality: 90, alphaQuality: 100, effort: 6, smartSubsample: true })
	.toBuffer();
write(
	LOGO_DATA,
	Buffer.from(`// Generated by scripts/generate-icons.mjs from assets/brand/logo-source.png. Do not edit.

/** Pixel size of LOGO_DATA_URI (2x the largest <Logo> size). */
export const LOGO_DATA_SIZE = ${INLINE_SIZE};

/** GrowTube logo as an inlined WebP (${inline.length} bytes). */
export const LOGO_DATA_URI =
	"data:image/webp;base64,${inline.toString("base64")}";
`),
);

// Web app.
write(join(WEB_PUBLIC, "favicon-16.png"), await png(16));
write(join(WEB_PUBLIC, "favicon-32.png"), await png(32));
write(join(WEB_PUBLIC, "icon-192.png"), await png(192));
write(join(WEB_PUBLIC, "icon-512.png"), await png(512));
// Header mark, loaded on every page: a 256-colour palette is a quarter of
// the truecolor size and looks the same at the 28px it is shown at.
write(
	join(WEB_PUBLIC, "logo.png"),
	await scaled(256)
		.png({ compressionLevel: 9, palette: true, quality: 95, effort: 10 })
		.toBuffer(),
);
const inset = Math.floor((TOUCH_SIZE - TOUCH_INNER) / 2);
write(
	join(WEB_PUBLIC, "apple-touch-icon.png"),
	await sharp(await png(TOUCH_INNER))
		.extend({
			left: inset,
			right: TOUCH_SIZE - TOUCH_INNER - inset,
			top: inset,
			bottom: TOUCH_SIZE - TOUCH_INNER - inset,
			background: "#ffffff",
		})
		.flatten({ background: "#ffffff" })
		.png(PNG)
		.toBuffer(),
);
