/**
 * Content planner: idea cards on a board (Idea -> Scripting -> Filming ->
 * Editing -> Published) and a calendar list sorted by target date with
 * overdue highlighting. Cards come from "Save to planner" buttons in other
 * tools (`addPlannerIdea` in @/lib/planner) or are added here. Everything
 * stays in chrome.storage.local; export/import is JSON, plus CSV export.
 *
 * Moving cards: the arrow buttons on every card (keyboard accessible), or
 * native HTML drag and drop between columns.
 */
import { formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { Textarea } from "@growtube/ui/components/textarea";
import { cn } from "@growtube/ui/lib/utils";
import {
	ArrowLeft,
	CalendarDays,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Download,
	ExternalLink,
	FileSpreadsheet,
	KanbanSquare,
	Pencil,
	Plus,
	Search,
	Trash2,
	Upload,
} from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";

import { useStorageItem } from "@/lib/hooks";
import {
	addPlannerIdea,
	adjacentStage,
	cleanTags,
	daysUntil,
	formatTargetDate,
	importPlannerJson,
	isOverdue,
	PLANNER_COLORS,
	PLANNER_MAX_IDEAS,
	PLANNER_SOURCES,
	PLANNER_STAGES,
	type PlannerColor,
	type PlannerIdea,
	type PlannerStage,
	parseVideoId,
	plannerToCsv,
	plannerToJson,
	removePlannerIdea,
	restorePlannerIdea,
	stageLabel,
	todayKey,
	updatePlannerIdea,
} from "@/lib/planner";
import { plannerIdeas } from "@/lib/settings";

import { useLocalPref } from "../../../hooks";
import { Badge, type Tone } from "../../../ui/badges";
import {
	Field,
	IconButton,
	NativeSelect,
	Segmented,
} from "../../../ui/controls";
import { EmptyState, LoadingBlock, Notice } from "../../../ui/feedback";
import { Eyebrow } from "../../../ui/layout";
import { toast } from "../../../ui/toast";
import { openLink, watchUrl } from "../../../utils";
import type { ToolProps } from "../../nav";
import { ToolScroll } from "../../shared";

type View = "board" | "calendar";

const STRIPE: Record<PlannerColor, string> = {
	neutral: "bg-muted-foreground/35",
	brand: "bg-brand",
	sky: "bg-sky-500",
	violet: "bg-violet-500",
	emerald: "bg-emerald-500",
	amber: "bg-amber-500",
	red: "bg-red-500",
};

const STAGE_TONE: Record<PlannerStage, Tone> = {
	idea: "neutral",
	scripting: "sky",
	filming: "violet",
	editing: "amber",
	published: "emerald",
};

const DRAG_TYPE = "application/x-growtube-planner-id";

function downloadFile(name: string, text: string, type: string) {
	const url = URL.createObjectURL(new Blob([text], { type }));
	const a = document.createElement("a");
	a.href = url;
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

async function moveIdea(idea: PlannerIdea, stage: PlannerStage) {
	if (idea.stage === stage) return;
	await updatePlannerIdea(idea.id, { stage });
	toast(`Moved to ${stageLabel(stage)}`);
}

async function deleteIdea(idea: PlannerIdea) {
	const removed = await removePlannerIdea(idea.id);
	if (!removed) return;
	toast("Card deleted", {
		action: {
			label: "Undo",
			onClick: () => void restorePlannerIdea(removed),
		},
	});
}

export function PlannerTool({ intent }: ToolProps) {
	const [list, , loading] = useStorageItem(plannerIdeas);
	const [view, setView] = useLocalPref<View>("planner.view", "board");
	const [editingId, setEditingId] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [query, setQuery] = useState("");
	const titleRef = useRef<HTMLInputElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent) return;
		if (intent.view === "board" || intent.view === "calendar")
			setView(intent.view);
		if (intent.prefill) {
			setEditingId(null);
			setTitle(intent.prefill);
			setTimeout(() => titleRef.current?.focus(), 0);
		}
	}, [intent?.id]);

	const editing = editingId ? list.find((i) => i.id === editingId) : null;

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return list;
		return list.filter((i) =>
			[i.title, i.notes, i.targetKeyword ?? "", ...i.tags]
				.join(" ")
				.toLowerCase()
				.includes(q),
		);
	}, [list, query]);

	const add = async () => {
		const t = title.trim();
		if (!t) return;
		const r = await addPlannerIdea({ title: t, source: "manual" });
		if (r.status === "added") {
			setTitle("");
			toast("Added to Idea", { tone: "success" });
		} else if (r.status === "duplicate") {
			toast("Already in your planner");
		} else if (r.status === "full") {
			toast(
				`The planner holds up to ${PLANNER_MAX_IDEAS} cards. Delete some first.`,
				{ tone: "error" },
			);
		}
	};

	const onImport = async (file: File | undefined) => {
		if (!file) return;
		try {
			if (file.size > 5_000_000) throw new Error("That file is too large.");
			const r = await importPlannerJson(await file.text());
			toast(
				`Imported: ${r.added} new, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped` : ""}`,
				{ tone: r.added || r.updated ? "success" : "info" },
			);
		} catch (e) {
			toast(e instanceof Error ? e.message : "Couldn't import that file.", {
				tone: "error",
			});
		} finally {
			if (fileRef.current) fileRef.current.value = "";
		}
	};

	if (loading) return <LoadingBlock className="h-full" />;

	if (editing) {
		return (
			<ToolScroll>
				<IdeaEditor
					key={editing.id}
					idea={editing}
					onClose={() => setEditingId(null)}
				/>
			</ToolScroll>
		);
	}

	const date = todayKey();

	return (
		<ToolScroll>
			<div className="flex flex-wrap items-center gap-1.5">
				<Segmented<View>
					value={view}
					onChange={setView}
					options={[
						{ value: "board", label: "Board", icon: KanbanSquare },
						{ value: "calendar", label: "Calendar", icon: CalendarDays },
					]}
					ariaLabel="Planner view"
				/>
				<div className="flex-1" />
				<IconButton
					label="Export JSON"
					icon={Download}
					disabled={!list.length}
					onClick={() =>
						downloadFile(
							`growtube-planner-${date}.json`,
							plannerToJson(list),
							"application/json",
						)
					}
				/>
				<IconButton
					label="Export CSV"
					icon={FileSpreadsheet}
					disabled={!list.length}
					onClick={() =>
						downloadFile(
							`growtube-planner-${date}.csv`,
							plannerToCsv(list),
							"text/csv;charset=utf-8",
						)
					}
				/>
				<IconButton
					label="Import JSON"
					icon={Upload}
					onClick={() => fileRef.current?.click()}
				/>
				<input
					ref={fileRef}
					type="file"
					accept="application/json,.json"
					className="hidden"
					aria-hidden
					tabIndex={-1}
					onChange={(e) => void onImport(e.target.files?.[0])}
				/>
			</div>

			<form
				className="flex gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					void add();
				}}
			>
				<Input
					ref={titleRef}
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="New video idea"
					aria-label="New video idea"
					maxLength={200}
				/>
				<Button type="submit" disabled={!title.trim()}>
					<Plus /> Add
				</Button>
			</form>

			{list.length >= PLANNER_MAX_IDEAS ? (
				<Notice tone="warning">
					The planner is full ({PLANNER_MAX_IDEAS} cards). Delete or export old
					cards to add new ones.
				</Notice>
			) : null}

			{list.length === 0 ? (
				<EmptyState icon={KanbanSquare} title="Plan your next videos">
					Add ideas here, or use "Save to planner" in Daily Ideas, Trends,
					Keyword Research and the AI Coach. Cards stay in this browser.
				</EmptyState>
			) : (
				<>
					<div className="flex items-center gap-2">
						<div className="relative min-w-0 flex-1">
							<Search
								className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
								aria-hidden
							/>
							<Input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Filter cards"
								aria-label="Filter planner cards"
								className="h-8 pl-8"
							/>
						</div>
						<span className="text-muted-foreground ovq-num shrink-0 text-[11px]">
							{list.length}/{PLANNER_MAX_IDEAS}
						</span>
					</div>
					{view === "board" ? (
						<Board list={filtered} onEdit={setEditingId} />
					) : (
						<CalendarList list={filtered} onEdit={setEditingId} />
					)}
				</>
			)}
		</ToolScroll>
	);
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function Board({
	list,
	onEdit,
}: {
	list: PlannerIdea[];
	onEdit: (id: string) => void;
}) {
	const [collapsed, setCollapsed] = useLocalPref<PlannerStage[]>(
		"planner.collapsed",
		["published"],
	);
	const [dropTarget, setDropTarget] = useState<PlannerStage | null>(null);
	const byStage = useMemo(() => {
		const m = new Map<PlannerStage, PlannerIdea[]>();
		for (const s of PLANNER_STAGES) m.set(s.id, []);
		for (const i of list) m.get(i.stage)?.push(i);
		// Soonest target date first, undated after, newest first.
		for (const cards of m.values())
			cards.sort(
				(a, b) =>
					(a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
					b.updatedAt.localeCompare(a.updatedAt),
			);
		return m;
	}, [list]);

	const onDrop = (stage: PlannerStage, e: DragEvent) => {
		e.preventDefault();
		setDropTarget(null);
		const id = e.dataTransfer.getData(DRAG_TYPE);
		const idea = list.find((i) => i.id === id);
		if (idea) void moveIdea(idea, stage);
	};

	return (
		<div className="flex flex-col gap-2.5">
			{PLANNER_STAGES.map((s) => {
				const cards = byStage.get(s.id) ?? [];
				const isCollapsed = collapsed.includes(s.id);
				return (
					<section
						key={s.id}
						aria-label={`${s.label} column`}
						onDragOver={(e) => {
							if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
							e.preventDefault();
							e.dataTransfer.dropEffect = "move";
							setDropTarget(s.id);
						}}
						onDragLeave={(e) => {
							if (!e.currentTarget.contains(e.relatedTarget as Node | null))
								setDropTarget((t) => (t === s.id ? null : t));
						}}
						onDrop={(e) => onDrop(s.id, e)}
						className={cn(
							"bg-surface flex flex-col gap-2 rounded-xl border p-2 transition-colors duration-150",
							dropTarget === s.id && "border-brand/60 bg-brand-soft",
						)}
					>
						<button
							type="button"
							aria-expanded={!isCollapsed}
							onClick={() =>
								setCollapsed(
									isCollapsed
										? collapsed.filter((c) => c !== s.id)
										: [...collapsed, s.id],
								)
							}
							className="hover:text-foreground focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-md px-1 text-left outline-none focus-visible:ring-2"
						>
							<ChevronDown
								className={cn(
									"text-muted-foreground size-3.5 transition-transform duration-200",
									isCollapsed && "-rotate-90",
								)}
								aria-hidden
							/>
							<Eyebrow className="text-foreground">{s.label}</Eyebrow>
							<Badge tone={STAGE_TONE[s.id]}>{cards.length}</Badge>
						</button>
						{isCollapsed ? null : cards.length === 0 ? (
							<div className="text-muted-foreground px-1 pb-1 text-[11px]">
								Nothing here yet. Move a card or drop it here.
							</div>
						) : (
							cards.map((idea) => (
								<PlannerCard key={idea.id} idea={idea} onEdit={onEdit} />
							))
						)}
					</section>
				);
			})}
		</div>
	);
}

function DateBadge({ idea }: { idea: PlannerIdea }) {
	if (!idea.targetDate) return null;
	const overdue = isOverdue(idea);
	const days = daysUntil(idea.targetDate);
	const when =
		idea.stage === "published"
			? formatTargetDate(idea.targetDate)
			: days === 0
				? "Today"
				: days === 1
					? "Tomorrow"
					: formatTargetDate(idea.targetDate);
	return (
		<Badge
			tone={
				overdue
					? "red"
					: days <= 2 && idea.stage !== "published"
						? "amber"
						: "neutral"
			}
			title={
				overdue
					? `Overdue by ${-days} day${days === -1 ? "" : "s"}`
					: `Target publish date: ${idea.targetDate}`
			}
		>
			<CalendarDays className="size-3" aria-hidden />
			{overdue ? `Overdue · ${when}` : when}
		</Badge>
	);
}

function CardMeta({ idea }: { idea: PlannerIdea }) {
	return (
		<div className="flex flex-wrap items-center gap-1">
			<DateBadge idea={idea} />
			{idea.targetKeyword ? (
				<Badge tone="brand" title="Target keyword">
					{idea.targetKeyword}
				</Badge>
			) : null}
			{idea.tags.slice(0, 4).map((t) => (
				<Badge key={t}>#{t}</Badge>
			))}
			{idea.source !== "manual" ? (
				<span className="text-muted-foreground text-[10px]">
					from {PLANNER_SOURCES[idea.source]}
				</span>
			) : null}
		</div>
	);
}

function PlannerCard({
	idea,
	onEdit,
}: {
	idea: PlannerIdea;
	onEdit: (id: string) => void;
}) {
	const prev = adjacentStage(idea.stage, -1);
	const next = adjacentStage(idea.stage, 1);
	const overdue = isOverdue(idea);
	return (
		<article
			draggable
			onDragStart={(e) => {
				e.dataTransfer.setData(DRAG_TYPE, idea.id);
				e.dataTransfer.effectAllowed = "move";
			}}
			className={cn(
				"bg-card ring-foreground/7 relative flex cursor-grab gap-2 overflow-hidden rounded-lg py-2 pr-1.5 pl-3 shadow-xs ring-1 active:cursor-grabbing",
				overdue && "ring-red-500/40",
			)}
		>
			<span
				className={cn("absolute inset-y-0 left-0 w-1", STRIPE[idea.color])}
				aria-hidden
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<button
					type="button"
					onClick={() => onEdit(idea.id)}
					className="hover:text-brand focus-visible:text-brand text-left text-xs leading-snug font-medium [overflow-wrap:anywhere] outline-none"
				>
					{idea.title}
				</button>
				{idea.notes ? (
					<p className="ovq-clamp-2 text-muted-foreground text-[11px] leading-relaxed whitespace-pre-line">
						{idea.notes}
					</p>
				) : null}
				<CardMeta idea={idea} />
			</div>
			<div className="flex shrink-0 flex-col items-center gap-0.5">
				<div className="flex">
					<IconButton
						label={prev ? `Move to ${stageLabel(prev)}` : "Already first"}
						icon={ChevronLeft}
						size="icon-xs"
						disabled={!prev}
						onClick={() => prev && void moveIdea(idea, prev)}
					/>
					<IconButton
						label={next ? `Move to ${stageLabel(next)}` : "Already published"}
						icon={ChevronRight}
						size="icon-xs"
						disabled={!next}
						onClick={() => next && void moveIdea(idea, next)}
					/>
				</div>
				<div className="flex">
					{idea.videoId ? (
						<IconButton
							label="Open the published video"
							icon={ExternalLink}
							size="icon-xs"
							onClick={(e) => openLink(watchUrl(idea.videoId as string), e)}
						/>
					) : null}
					<IconButton
						label="Edit"
						icon={Pencil}
						size="icon-xs"
						onClick={() => onEdit(idea.id)}
					/>
					<IconButton
						label="Delete"
						icon={Trash2}
						size="icon-xs"
						onClick={() => void deleteIdea(idea)}
					/>
				</div>
			</div>
		</article>
	);
}

// ---------------------------------------------------------------------------
// Calendar (list sorted by target date)
// ---------------------------------------------------------------------------

type Group = { id: string; label: string; cards: PlannerIdea[] };

function CalendarList({
	list,
	onEdit,
}: {
	list: PlannerIdea[];
	onEdit: (id: string) => void;
}) {
	const [showPublished, setShowPublished] = useLocalPref(
		"planner.calendarPublished",
		false,
	);
	const groups = useMemo<Group[]>(() => {
		const today = todayKey();
		const sorted = [...list]
			.filter((i) => showPublished || i.stage !== "published")
			.sort(
				(a, b) =>
					(a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") ||
					a.createdAt.localeCompare(b.createdAt),
			);
		const g: Group[] = [
			{ id: "overdue", label: "Overdue", cards: [] },
			{ id: "week", label: "Next 7 days", cards: [] },
			{ id: "later", label: "Later", cards: [] },
			{ id: "past", label: "Published", cards: [] },
			{ id: "none", label: "No target date", cards: [] },
		];
		const at = (id: string) => g.find((x) => x.id === id) as Group;
		for (const i of sorted) {
			if (!i.targetDate) at("none").cards.push(i);
			else if (isOverdue(i, today)) at("overdue").cards.push(i);
			else if (i.stage === "published" && i.targetDate < today)
				at("past").cards.push(i);
			else if (daysUntil(i.targetDate, today) <= 7) at("week").cards.push(i);
			else at("later").cards.push(i);
		}
		return g.filter((x) => x.cards.length);
	}, [list, showPublished]);

	return (
		<div className="flex flex-col gap-3">
			<label className="text-muted-foreground flex items-center gap-2 self-start text-[11px]">
				<input
					type="checkbox"
					checked={showPublished}
					onChange={(e) => setShowPublished(e.target.checked)}
					className="accent-brand"
				/>
				Show published
			</label>
			{groups.length === 0 ? (
				<div className="text-muted-foreground py-4 text-center text-xs">
					No cards to show.
				</div>
			) : null}
			{groups.map((g) => (
				<div key={g.id} className="flex flex-col gap-1.5">
					<Eyebrow
						className={
							g.id === "overdue" ? "text-red-600 dark:text-red-400" : undefined
						}
					>
						{g.label} ({g.cards.length})
					</Eyebrow>
					<ul className="flex flex-col gap-1">
						{g.cards.map((i) => (
							<li key={i.id}>
								<button
									type="button"
									onClick={() => onEdit(i.id)}
									className={cn(
										"bg-card ring-foreground/7 hover:ring-brand/40 focus-visible:ring-ring/60 relative flex w-full items-center gap-2 overflow-hidden rounded-lg py-2 pr-2 pl-3 text-left shadow-xs ring-1 outline-none focus-visible:ring-2",
										g.id === "overdue" && "ring-red-500/40",
									)}
								>
									<span
										className={cn(
											"absolute inset-y-0 left-0 w-1",
											STRIPE[i.color],
										)}
										aria-hidden
									/>
									<span className="ovq-num text-muted-foreground w-20 shrink-0 text-[11px]">
										{i.targetDate ? formatTargetDate(i.targetDate) : "—"}
									</span>
									<span className="min-w-0 flex-1 truncate text-xs font-medium">
										{i.title}
									</span>
									<Badge tone={STAGE_TONE[i.stage]}>
										{stageLabel(i.stage)}
									</Badge>
								</button>
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function IdeaEditor({
	idea,
	onClose,
}: {
	idea: PlannerIdea;
	onClose: () => void;
}) {
	const [draft, setDraft] = useState(() => ({
		title: idea.title,
		notes: idea.notes,
		stage: idea.stage,
		targetKeyword: idea.targetKeyword ?? "",
		targetDate: idea.targetDate ?? "",
		tags: idea.tags.join(", "),
		color: idea.color,
		video: idea.videoId ?? "",
	}));
	const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) =>
		setDraft((d) => ({ ...d, [k]: v }));
	const videoId = draft.video.trim() ? parseVideoId(draft.video) : null;
	const videoInvalid = !!draft.video.trim() && !videoId;

	const save = async () => {
		if (!draft.title.trim() || videoInvalid) return;
		await updatePlannerIdea(idea.id, {
			title: draft.title,
			notes: draft.notes,
			stage: draft.stage,
			targetKeyword: draft.targetKeyword.trim() || null,
			targetDate: draft.targetDate || null,
			tags: cleanTags(draft.tags),
			color: draft.color,
			videoId,
		});
		toast("Saved", { tone: "success" });
		onClose();
	};

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<div className="flex items-center gap-1.5">
				<Button type="button" size="xs" variant="ghost" onClick={onClose}>
					<ArrowLeft /> Planner
				</Button>
				<div className="flex-1" />
				<span className="text-muted-foreground text-[10px]">
					Created {formatRelative(idea.createdAt)} · updated{" "}
					{formatRelative(idea.updatedAt)}
				</span>
			</div>
			<Field label="Title" htmlFor="planner-title">
				<Input
					id="planner-title"
					value={draft.title}
					onChange={(e) => set("title", e.target.value)}
					maxLength={200}
					required
				/>
			</Field>
			<Field label="Notes" htmlFor="planner-notes">
				<Textarea
					id="planner-notes"
					value={draft.notes}
					onChange={(e) => set("notes", e.target.value)}
					maxLength={5000}
					rows={5}
					placeholder="Hook, outline, script notes, links…"
				/>
			</Field>
			<div className="grid grid-cols-2 gap-2">
				<Field label="Stage" htmlFor="planner-stage">
					<NativeSelect
						id="planner-stage"
						value={draft.stage}
						onChange={(e) => set("stage", e.target.value as PlannerStage)}
					>
						{PLANNER_STAGES.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</NativeSelect>
				</Field>
				<Field label="Target publish date" htmlFor="planner-date">
					<Input
						id="planner-date"
						type="date"
						value={draft.targetDate}
						onChange={(e) => set("targetDate", e.target.value)}
						className="h-8"
					/>
				</Field>
			</div>
			<Field label="Target keyword (optional)" htmlFor="planner-keyword">
				<Input
					id="planner-keyword"
					value={draft.targetKeyword}
					onChange={(e) => set("targetKeyword", e.target.value)}
					maxLength={120}
				/>
			</Field>
			<Field
				label="Tags"
				htmlFor="planner-tags"
				hint="Comma separated, up to 12."
			>
				<Input
					id="planner-tags"
					value={draft.tags}
					onChange={(e) => set("tags", e.target.value)}
					placeholder="series, collab, evergreen"
				/>
			</Field>
			<fieldset className="flex flex-col gap-1.5">
				<legend className="mb-1.5 text-xs font-medium">Color</legend>
				<div className="flex flex-wrap gap-1.5">
					{PLANNER_COLORS.map((c) => (
						<button
							key={c}
							type="button"
							aria-label={`Color ${c}`}
							aria-pressed={draft.color === c}
							onClick={() => set("color", c)}
							className={cn(
								"focus-visible:ring-ring/60 size-6 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-transparent outline-none focus-visible:ring-2",
								STRIPE[c],
								draft.color === c && "ring-foreground/60",
							)}
						/>
					))}
				</div>
			</fieldset>
			<Field
				label="Published video (optional)"
				htmlFor="planner-video"
				hint={
					videoInvalid
						? "Paste a YouTube link or an 11-character video id."
						: "Link the video once it's live."
				}
			>
				<Input
					id="planner-video"
					value={draft.video}
					onChange={(e) => set("video", e.target.value)}
					placeholder="https://youtu.be/…"
					aria-invalid={videoInvalid || undefined}
				/>
			</Field>
			<div className="text-muted-foreground text-[11px]">
				Source: {PLANNER_SOURCES[idea.source]}
			</div>
			<div className="flex items-center gap-1.5">
				<Button type="submit" disabled={!draft.title.trim() || videoInvalid}>
					Save
				</Button>
				<Button type="button" variant="ghost" onClick={onClose}>
					Cancel
				</Button>
				<div className="flex-1" />
				{videoId ? (
					<Button
						type="button"
						size="xs"
						variant="ghost"
						onClick={(e) => openLink(watchUrl(videoId), e)}
					>
						<ExternalLink /> Open video
					</Button>
				) : null}
				<Button
					type="button"
					size="xs"
					variant="ghost"
					onClick={() => {
						onClose();
						void deleteIdea(idea);
					}}
				>
					<Trash2 /> Delete
				</Button>
			</div>
		</form>
	);
}
