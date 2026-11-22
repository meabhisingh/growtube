/**
 * Non-React helpers for the extension pages: error mapping, tab navigation,
 * a concurrency queue and video metric shortcuts.
 */
import {
	computeOutlierScore,
	computeVph,
	hoursSince,
} from "@growtube/shared/metrics";
import { extractVideoId } from "@growtube/shared/youtube";
import { browser } from "wxt/browser";

import { BackgroundError } from "@/lib/messaging";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ErrorAction =
	| "ai-settings"
	| "server-settings"
	| "sign-in"
	| "reload"
	| null;

export type ErrorInfo = {
	message: string;
	code: string | null;
	/** Suggested fix the UI can offer as a button */
	action: ErrorAction;
};

const AI_SETUP_CODES = new Set([
	"NOT_CONFIGURED",
	"AUTH",
	"MODEL",
	"PARAMS",
	"TIMEOUT",
	"OLLAMA_ORIGIN",
	"NO_IMAGE_SUPPORT",
]);

/** Maps anything thrown by `@/lib/client` (or the AI port) to UI copy + fix. */
export function describeError(error: unknown): ErrorInfo {
	const code =
		error instanceof BackgroundError
			? (error.code ?? null)
			: typeof (error as { code?: unknown })?.code === "string"
				? ((error as { code: string }).code ?? null)
				: null;
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Something went wrong.";
	const mentionsServer = /growtube server|server url/i.test(message);
	let action: ErrorAction = null;
	if (code === "CONTEXT_INVALIDATED") action = "reload";
	else if (code === "AUTH_REQUIRED") action = "sign-in";
	else if (code && AI_SETUP_CODES.has(code)) action = "ai-settings";
	else if (code === "PERMISSION")
		action = mentionsServer ? "server-settings" : "ai-settings";
	else if (mentionsServer) action = "server-settings";
	return { message: message || "Something went wrong.", code, action };
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

async function currentWindowId(): Promise<number | undefined> {
	try {
		return (await browser.windows.getCurrent()).id;
	} catch {
		return undefined;
	}
}

/** Opens a URL in a new tab next to the active one. */
export async function openInNewTab(url: string, active = true): Promise<void> {
	const windowId = await currentWindowId();
	const [current] = await browser.tabs.query({ active: true, windowId });
	await browser.tabs.create({
		url,
		active,
		windowId,
		index: current ? current.index + 1 : undefined,
	});
}

/**
 * Link click handler: ctrl/cmd/middle click opens in the background, a plain
 * click opens in a new foreground tab.
 */
export function openLink(
	url: string,
	e?: { ctrlKey?: boolean; metaKey?: boolean; button?: number },
): void {
	const background = !!(e?.ctrlKey || e?.metaKey || e?.button === 1);
	void openInNewTab(url, !background);
}

export function watchUrl(videoId: string, seconds?: number): string {
	const t = seconds != null && seconds > 0 ? `&t=${Math.floor(seconds)}s` : "";
	return `https://www.youtube.com/watch?v=${videoId}${t}`;
}

/**
 * Opens `videoId` at `seconds`: reuses a tab of this window that already
 * shows the video (preferring the active one), otherwise opens a new tab.
 */
export async function openVideoAt(
	videoId: string,
	seconds?: number,
): Promise<void> {
	const url = watchUrl(videoId, seconds);
	const windowId = await currentWindowId();
	const tabs = await browser.tabs.query({
		windowId,
		url: ["*://*.youtube.com/*"],
	});
	const matching = tabs.filter(
		(t) => t.url && extractVideoId(t.url) === videoId,
	);
	const target = matching.find((t) => t.active) ?? matching[0];
	if (target?.id != null) {
		await browser.tabs.update(target.id, { url, active: true });
		return;
	}
	await openInNewTab(url, true);
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

/** `queue(fn)` runs at most `concurrency` fns at once, FIFO. */
export function createQueue(concurrency: number) {
	let active = 0;
	const waiting: (() => void)[] = [];
	const next = () => {
		if (active >= concurrency) return;
		const start = waiting.shift();
		if (start) start();
	};
	return function queue<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			waiting.push(() => {
				active++;
				fn()
					.then(resolve, reject)
					.finally(() => {
						active--;
						next();
					});
			});
			next();
		});
	};
}

// ---------------------------------------------------------------------------
// Metrics shortcuts
// ---------------------------------------------------------------------------

/** Lifetime views/hour, null when the publish date is unknown. */
export function vphOf(
	views: number | null | undefined,
	publishedAt: string | null | undefined,
): number | null {
	if (views == null || !publishedAt) return null;
	return computeVph(views, publishedAt);
}

export function outlierOf(
	views: number | null | undefined,
	baseline: number | null | undefined,
): number | null {
	if (views == null) return null;
	return computeOutlierScore(views, baseline);
}

export function ageHoursOf(
	publishedAt: string | null | undefined,
): number | null {
	if (!publishedAt) return null;
	const h = hoursSince(publishedAt);
	return Number.isFinite(h) ? h : null;
}

/** "0:00 text" lines from transcript segments (prompt-friendly). */
export function segmentsToText(
	segments: { start: number; dur: number; text: string }[],
	opts: { maxChars?: number; fromSec?: number; toSec?: number } = {},
): string {
	const lines: string[] = [];
	let total = 0;
	for (const seg of segments) {
		if (opts.fromSec != null && seg.start + seg.dur < opts.fromSec) continue;
		if (opts.toSec != null && seg.start > opts.toSec) break;
		const line = `${formatClock(seg.start)} ${seg.text}`;
		total += line.length + 1;
		if (opts.maxChars && total > opts.maxChars) break;
		lines.push(line);
	}
	return lines.join("\n");
}

/** 83 -> "1:23", 3723 -> "1:02:03" */
export function formatClock(totalSeconds: number): string {
	const s = Math.max(0, Math.floor(totalSeconds));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = String(s % 60).padStart(2, "0");
	return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

/** 14 -> "2 PM" */
export function formatHour(hour: number): string {
	const h = ((hour % 24) + 24) % 24;
	const suffix = h < 12 ? "AM" : "PM";
	const twelve = h % 12 === 0 ? 12 : h % 12;
	return `${twelve} ${suffix}`;
}

/** Normalized key for de-duplicating keywords / titles. */
export function normalizeKey(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function clamp(value: number, min = 0, max = 1): number {
	return Math.min(max, Math.max(min, value));
}
