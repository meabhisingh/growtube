/**
 * Content planner: idea cards that move Idea -> Scripting -> Filming ->
 * Editing -> Published. Data lives in `plannerIdeas` (chrome.storage.local)
 * only; nothing here talks to the network. Works in any context.
 *
 *   import { addPlannerIdea } from "@/lib/planner";
 *   const r = await addPlannerIdea({ title: "…", source: "comments", notes: "…" });
 *   // r.status: "added" | "duplicate" | "full"
 */
import {
	newId,
	type PlannerColor,
	type PlannerIdea,
	type PlannerSource,
	type PlannerStage,
	plannerIdeas,
} from "./settings";

export type {
	PlannerColor,
	PlannerIdea,
	PlannerSource,
	PlannerStage,
} from "./settings";

/** Hard cap on stored cards (keeps chrome.storage.local small and fast). */
export const PLANNER_MAX_IDEAS = 500;

const MAX_TITLE = 200;
const MAX_NOTES = 5000;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 40;

export const PLANNER_STAGES: readonly { id: PlannerStage; label: string }[] = [
	{ id: "idea", label: "Idea" },
	{ id: "scripting", label: "Scripting" },
	{ id: "filming", label: "Filming" },
	{ id: "editing", label: "Editing" },
	{ id: "published", label: "Published" },
];

export const PLANNER_SOURCES: Record<PlannerSource, string> = {
	manual: "Manual",
	"daily-ideas": "Daily Ideas",
	trends: "Trends",
	keywords: "Keywords",
	coach: "AI Coach",
	comments: "Comments",
};

export const PLANNER_COLORS: readonly PlannerColor[] = [
	"neutral",
	"brand",
	"sky",
	"violet",
	"emerald",
	"amber",
	"red",
];

const STAGE_IDS = new Set<string>(PLANNER_STAGES.map((s) => s.id));
const COLOR_IDS = new Set<string>(PLANNER_COLORS);

export function stageLabel(stage: PlannerStage): string {
	return PLANNER_STAGES.find((s) => s.id === stage)?.label ?? stage;
}

export function stageIndex(stage: PlannerStage): number {
	return PLANNER_STAGES.findIndex((s) => s.id === stage);
}

/** The stage before/after `stage` (null at either end). */
export function adjacentStage(
	stage: PlannerStage,
	dir: -1 | 1,
): PlannerStage | null {
	return PLANNER_STAGES[stageIndex(stage) + dir]?.id ?? null;
}

function normalizeTitleKey(title: string): string {
	return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Same idea already planned? (case/space-insensitive title match) */
export function findPlannerIdeaByTitle(
	list: readonly PlannerIdea[],
	title: string,
): PlannerIdea | undefined {
	const key = normalizeTitleKey(title);
	return key ? list.find((i) => normalizeTitleKey(i.title) === key) : undefined;
}

export function cleanTags(tags: unknown): string[] {
	const raw = Array.isArray(tags)
		? tags
		: typeof tags === "string"
			? tags.split(",")
			: [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const t of raw) {
		if (typeof t !== "string") continue;
		const v = t.trim().replace(/^#/, "").slice(0, MAX_TAG_LENGTH);
		const k = v.toLowerCase();
		if (!v || seen.has(k)) continue;
		seen.add(k);
		out.push(v);
		if (out.length >= MAX_TAGS) break;
	}
	return out;
}

/** "YYYY-MM-DD" or null. */
export function cleanDate(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
	if (!m) return null;
	const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/** Video id from an id or any YouTube watch/shorts/youtu.be URL. */
export function parseVideoId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const v = value.trim();
	if (/^[\w-]{11}$/.test(v)) return v;
	const m =
		/(?:v=|\/shorts\/|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/.exec(v) ??
		null;
	return m?.[1] ?? null;
}

function cleanText(value: unknown, max: number): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanIso(value: unknown, fallback: string): string {
	if (typeof value === "string" || typeof value === "number") {
		const t = new Date(value).getTime();
		if (Number.isFinite(t)) return new Date(t).toISOString();
	}
	return fallback;
}

/**
 * Validates/fills an untrusted value (import, older versions). null when it
 * has no usable title.
 */
export function normalizePlannerIdea(value: unknown): PlannerIdea | null {
	if (!value || typeof value !== "object") return null;
	const v = value as Record<string, unknown>;
	const title = cleanText(v.title, MAX_TITLE);
	if (!title) return null;
	const now = new Date().toISOString();
	const createdAt = cleanIso(v.createdAt, now);
	const source = (
		typeof v.source === "string" && v.source in PLANNER_SOURCES
			? v.source
			: "manual"
	) as PlannerSource;
	return {
		id: typeof v.id === "string" && /^[\w-]{1,64}$/.test(v.id) ? v.id : newId(),
		title,
		notes: cleanText(v.notes, MAX_NOTES),
		source,
		stage: (typeof v.stage === "string" && STAGE_IDS.has(v.stage)
			? v.stage
			: "idea") as PlannerStage,
		targetKeyword: cleanText(v.targetKeyword, 120) || null,
		targetDate: cleanDate(v.targetDate),
		tags: cleanTags(v.tags),
		color: (typeof v.color === "string" && COLOR_IDS.has(v.color)
			? v.color
			: "neutral") as PlannerColor,
		createdAt,
		updatedAt: cleanIso(v.updatedAt, createdAt),
		videoId: parseVideoId(v.videoId),
		sourceRef: cleanText(v.sourceRef, 200) || null,
	};
}

let writeChain: Promise<unknown> = Promise.resolve();

/**
 * Serialized read-modify-write of the planner (several buttons may save at
 * once). Every writer goes through this; the result is capped.
 */
export function updatePlanner<T = void>(
	fn: (list: PlannerIdea[]) => { list: PlannerIdea[]; result: T },
): Promise<T> {
	const next = writeChain.then(async () => {
		const current = await plannerIdeas.getValue();
		const { list, result } = fn(Array.isArray(current) ? current : []);
		if (list !== current)
			await plannerIdeas.setValue(list.slice(0, PLANNER_MAX_IDEAS));
		return result;
	});
	writeChain = next.catch(() => {});
	return next;
}

export type NewPlannerIdea = {
	title: string;
	notes?: string;
	source?: PlannerSource;
	stage?: PlannerStage;
	targetKeyword?: string | null;
	targetDate?: string | null;
	tags?: string[];
	color?: PlannerColor;
	videoId?: string | null;
	sourceRef?: string | null;
};

export type AddPlannerResult =
	| { status: "added"; idea: PlannerIdea }
	/** A card with the same title exists; nothing was changed */
	| { status: "duplicate"; idea: PlannerIdea }
	/** PLANNER_MAX_IDEAS reached; nothing was changed */
	| { status: "full" }
	| { status: "invalid" };

/**
 * Adds an idea card (newest first). Reusable by any feature (Daily Ideas,
 * Trends, Keywords, AI Coach, Comment insights…). Never drops existing cards.
 */
export function addPlannerIdea(
	input: NewPlannerIdea,
): Promise<AddPlannerResult> {
	return updatePlanner<AddPlannerResult>((list) => {
		const now = new Date().toISOString();
		const idea = normalizePlannerIdea({
			...input,
			id: newId(),
			createdAt: now,
			updatedAt: now,
		});
		if (!idea) return { list, result: { status: "invalid" } };
		const existing = findPlannerIdeaByTitle(list, idea.title);
		if (existing)
			return { list, result: { status: "duplicate", idea: existing } };
		if (list.length >= PLANNER_MAX_IDEAS)
			return { list, result: { status: "full" } };
		return { list: [idea, ...list], result: { status: "added", idea } };
	});
}

/** Applies `patch` and bumps `updatedAt`. Returns the updated card. */
export function updatePlannerIdea(
	id: string,
	patch: Partial<Omit<PlannerIdea, "id" | "createdAt" | "updatedAt">>,
): Promise<PlannerIdea | null> {
	return updatePlanner<PlannerIdea | null>((list) => {
		const current = list.find((i) => i.id === id);
		if (!current) return { list, result: null };
		const next = normalizePlannerIdea({
			...current,
			...patch,
			id,
			createdAt: current.createdAt,
			updatedAt: new Date().toISOString(),
		});
		if (!next) return { list, result: null };
		return {
			list: list.map((i) => (i.id === id ? next : i)),
			result: next,
		};
	});
}

export function removePlannerIdea(id: string): Promise<PlannerIdea | null> {
	return updatePlanner<PlannerIdea | null>((list) => {
		const current = list.find((i) => i.id === id) ?? null;
		return {
			list: current ? list.filter((i) => i.id !== id) : list,
			result: current,
		};
	});
}

/** Puts a removed card back (undo), if there's room. */
export function restorePlannerIdea(idea: PlannerIdea): Promise<boolean> {
	return updatePlanner<boolean>((list) => {
		if (list.some((i) => i.id === idea.id) || list.length >= PLANNER_MAX_IDEAS)
			return { list, result: false };
		return { list: [idea, ...list], result: true };
	});
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Today's local date as "YYYY-MM-DD". */
export function todayKey(now: Date = new Date()): string {
	const p = (n: number) => String(n).padStart(2, "0");
	return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Past its target date and not published yet. */
export function isOverdue(idea: PlannerIdea, today = todayKey()): boolean {
	return (
		idea.stage !== "published" && !!idea.targetDate && idea.targetDate < today
	);
}

/** "YYYY-MM-DD" -> "Mon, Dec 2" (local). */
export function formatTargetDate(date: string): string {
	const [y, m, d] = date.split("-").map(Number);
	const dt = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
	return dt.toLocaleDateString(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		year: dt.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
	});
}

/** Whole days from today to `date` (negative = past). */
export function daysUntil(date: string, today = todayKey()): number {
	const parse = (s: string) => {
		const [y, m, d] = s.split("-").map(Number);
		return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
	};
	return Math.round((parse(date) - parse(today)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export const PLANNER_EXPORT_APP = "growtube-planner";

export function plannerToJson(list: readonly PlannerIdea[]): string {
	return JSON.stringify(
		{
			app: PLANNER_EXPORT_APP,
			version: 1,
			exportedAt: new Date().toISOString(),
			ideas: list,
		},
		null,
		2,
	);
}

const CSV_COLUMNS = [
	"title",
	"stage",
	"targetDate",
	"targetKeyword",
	"tags",
	"source",
	"color",
	"videoId",
	"notes",
	"createdAt",
	"updatedAt",
	"id",
] as const;

function csvCell(value: string): string {
	// Neutralize spreadsheet formulas (CSV injection), then quote.
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return `"${safe.replace(/"/g, '""')}"`;
}

export function plannerToCsv(list: readonly PlannerIdea[]): string {
	const rows = list.map((i) =>
		CSV_COLUMNS.map((c) => {
			const v = i[c];
			return csvCell(Array.isArray(v) ? v.join(", ") : (v ?? "").toString());
		}).join(","),
	);
	// BOM so Excel opens UTF-8 correctly.
	return `﻿${[CSV_COLUMNS.join(","), ...rows].join("\r\n")}\r\n`;
}

export type PlannerImportResult = {
	added: number;
	updated: number;
	skipped: number;
};

/**
 * Parses a planner JSON export (or a bare array of cards) and merges it:
 * new ids are added, existing ids are replaced when the imported card is
 * newer. Never exceeds PLANNER_MAX_IDEAS (extra cards are skipped).
 * Throws an Error with a user-presentable message for unreadable files.
 */
export function importPlannerJson(text: string): Promise<PlannerImportResult> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("That file isn't valid JSON.");
	}
	const raw = Array.isArray(parsed)
		? parsed
		: parsed &&
				typeof parsed === "object" &&
				Array.isArray((parsed as { ideas?: unknown }).ideas)
			? (parsed as { ideas: unknown[] }).ideas
			: null;
	if (!raw) throw new Error("No planner cards found in that file.");
	const incoming = raw.map(normalizePlannerIdea);
	return updatePlanner<PlannerImportResult>((list) => {
		const byId = new Map(list.map((i) => [i.id, i]));
		let added = 0;
		let updated = 0;
		let skipped = 0;
		const fresh: PlannerIdea[] = [];
		for (const idea of incoming) {
			if (!idea) {
				skipped++;
				continue;
			}
			const current = byId.get(idea.id);
			if (current) {
				if (idea.updatedAt > current.updatedAt) {
					byId.set(idea.id, idea);
					updated++;
				} else skipped++;
				continue;
			}
			if (list.length + fresh.length >= PLANNER_MAX_IDEAS) {
				skipped++;
				continue;
			}
			byId.set(idea.id, idea);
			fresh.push(idea);
			added++;
		}
		const merged = [...fresh, ...list.map((i) => byId.get(i.id) ?? i)];
		return {
			list: added || updated ? merged : list,
			result: { added, updated, skipped },
		};
	});
}
