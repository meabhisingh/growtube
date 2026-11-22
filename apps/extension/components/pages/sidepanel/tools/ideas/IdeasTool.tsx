/**
 * Daily Ideas: AI video ideas from My channel's recent and best-performing
 * uploads plus competitor outliers (dailyIdeas generator), each with a
 * thumbnail concept (thumbnailConcepts generator). Save ideas to
 * settings.savedIdeas and manage them in the Saved tab.
 */
import { formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Checkbox } from "@growtube/ui/components/checkbox";
import { Input } from "@growtube/ui/components/input";
import { cn } from "@growtube/ui/lib/utils";
import {
	Bookmark,
	BookmarkCheck,
	Gauge,
	Image,
	Lightbulb,
	MessagesSquare,
	Plus,
	RefreshCw,
	Sparkles,
	Trash2,
	Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CopyButton } from "@/components/common";
import type { CoachContext } from "@/lib/ai/types";
import { ai } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	competitors,
	myChannel,
	newId,
	type SavedIdea,
	savedIdeas,
} from "@/lib/settings";

import {
	coachChannel,
	loadChannelOverview,
	loadCompetitorOutliers,
} from "../../../data";
import { useAsyncTask, useLocalPref } from "../../../hooks";
import {
	type DailyIdea,
	dailyIdeasState,
	type ThumbnailConcept,
	updateDailyIdeas,
} from "../../../storage";
import { Badge } from "../../../ui/badges";
import {
	Field,
	IconButton,
	NativeSelect,
	Segmented,
} from "../../../ui/controls";
import {
	EmptyState,
	ErrorNotice,
	LoadingBlock,
	Notice,
	Spinner,
} from "../../../ui/feedback";
import { Eyebrow, Section } from "../../../ui/layout";
import { toast } from "../../../ui/toast";
import { createQueue, normalizeKey } from "../../../utils";
import { type ToolProps, usePanel } from "../../nav";
import { AiSetupNotice, ToolScroll } from "../../shared";

const conceptQueue = createQueue(2);

type Stage = "channel" | "competitors" | "writing" | null;

export function IdeasTool({ intent }: ToolProps) {
	const [tab, setTab] = useLocalPref<"today" | "saved">("ideas.tab", "today");
	const [saved] = useStorageItem(savedIdeas);

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent?.view === "saved") setTab("saved");
		else if (intent?.view === "today") setTab("today");
	}, [intent?.id]);

	return (
		<ToolScroll>
			<Segmented<"today" | "saved">
				value={tab}
				onChange={setTab}
				options={[
					{ value: "today", label: "Today's ideas", icon: Lightbulb },
					{
						value: "saved",
						label: `Saved${saved.length ? ` (${saved.length})` : ""}`,
						icon: Bookmark,
					},
				]}
				className="self-start"
			/>
			{tab === "today" ? <TodayIdeas /> : <SavedIdeasList />}
		</ToolScroll>
	);
}

// ---------------------------------------------------------------------------

function TodayIdeas() {
	const { navigate } = usePanel();
	const [mine] = useStorageItem(myChannel);
	const [comps] = useStorageItem(competitors);
	const [state, , stateLoading] = useStorageItem(dailyIdeasState);
	const [niche, setNiche] = useState("");
	const [count, setCount] = useState("5");
	const [stage, setStage] = useState<Stage>(null);

	// Restore the last niche once, when the stored state first loads.
	const nicheRestored = useRef(false);
	useEffect(() => {
		if (stateLoading || nicheRestored.current) return;
		nicheRestored.current = true;
		if (state?.niche) setNiche(state.niche);
	}, [stateLoading, state?.niche]);

	const generate = useAsyncTask(async () => {
		let channel: CoachContext["channel"];
		let recentVideos: CoachContext["recentVideos"];
		if (mine) {
			setStage("channel");
			const o = await loadChannelOverview(mine.channelId);
			channel = coachChannel(o.channel, {
				baselineLong: o.baselineLong,
				uploadsPerWeek: o.uploadsPerWeek,
			});
			const newest = o.videos.slice(0, 12);
			const best = [...o.videos]
				.filter((v) => v.outlier != null)
				.sort((a, b) => (b.outlier ?? 0) - (a.outlier ?? 0))
				.slice(0, 6);
			const seen = new Set<string>();
			recentVideos = [...newest, ...best]
				.filter((v) => !seen.has(v.videoId) && seen.add(v.videoId))
				.map((v) => ({
					title: v.title,
					views: v.views,
					publishedAt: v.publishedAt,
					isShort: v.isShort,
				}));
		}
		let trending: { title: string; views?: number | null }[] | undefined;
		if (comps.length) {
			setStage("competitors");
			const { videos } = await loadCompetitorOutliers(comps.slice(0, 12), {
				maxAgeDays: 45,
				limit: 15,
				minOutlier: 1.2,
			});
			trending = videos.map((v) => ({
				title: `${v.title} (${v.channelTitle}, ${v.outlier?.toFixed(1)}x its usual views)`,
				views: v.views,
			}));
		}
		if (!channel && !niche.trim() && !trending?.length) {
			throw new Error(
				"Set your channel (Competitors tab) or describe your niche, so the ideas fit you.",
			);
		}
		setStage("writing");
		const out = await ai.generate("dailyIdeas", {
			channel,
			recentVideos,
			niche: niche.trim() || undefined,
			count: Number(count),
			trending,
			date: new Date().toDateString(),
		});
		await updateDailyIdeas(() => ({
			generatedAt: Date.now(),
			channelId: mine?.channelId ?? null,
			niche: niche.trim(),
			ideas: out.ideas,
			concepts: {},
		}));
		return out;
	});

	useEffect(() => {
		if (!generate.loading) setStage(null);
	}, [generate.loading]);

	const ideas = state?.ideas ?? [];
	const stale =
		state &&
		new Date(state.generatedAt).toDateString() !== new Date().toDateString();

	return (
		<>
			<Section
				title="Fresh ideas for today"
				icon={Sparkles}
				description={
					mine
						? `Based on ${mine.title}'s recent and best uploads${comps.length ? ` and outliers from ${comps.length} competitor${comps.length === 1 ? "" : "s"}` : ""}.`
						: "Set your channel in Competitors for ideas that fit it, or describe your niche."
				}
			>
				<AiSetupNotice />
				<Field label="Niche / focus (optional)" htmlFor="ideas-niche">
					<Input
						id="ideas-niche"
						value={niche}
						onChange={(e) => setNiche(e.target.value)}
						placeholder="e.g. budget travel in Southeast Asia"
					/>
				</Field>
				<div className="flex items-center gap-2">
					<NativeSelect
						value={count}
						onChange={(e) => setCount(e.target.value)}
						aria-label="Number of ideas"
					>
						{[3, 5, 8, 10].map((n) => (
							<option key={n} value={n}>
								{n} ideas
							</option>
						))}
					</NativeSelect>
					<Button
						onClick={() => void generate.run()}
						disabled={generate.loading}
						className="flex-1"
					>
						{generate.loading ? (
							<Spinner className="text-current" />
						) : ideas.length ? (
							<RefreshCw />
						) : (
							<Sparkles />
						)}
						{ideas.length ? "Regenerate" : "Generate ideas"}
					</Button>
				</div>
				{!mine ? (
					<Button
						size="xs"
						variant="outline"
						className="self-start"
						onClick={() => navigate("competitors")}
					>
						Set my channel
					</Button>
				) : null}
				{generate.error ? (
					<ErrorNotice
						error={generate.error}
						onRetry={() => void generate.run()}
					/>
				) : null}
			</Section>

			{generate.loading ? (
				<LoadingBlock
					label={
						stage === "channel"
							? "Reading your channel…"
							: stage === "competitors"
								? "Checking competitor outliers…"
								: "Writing ideas…"
					}
				/>
			) : null}

			{!stateLoading &&
			!generate.loading &&
			ideas.length === 0 &&
			!generate.error ? (
				<EmptyState icon={Lightbulb} title="No ideas yet">
					Generate as many batches as you like. Ideas are based on what already
					works on your channel and what's breaking out for competitors.
				</EmptyState>
			) : null}

			{ideas.length > 0 && !generate.loading ? (
				<div className="flex flex-col gap-2">
					{state ? (
						<div className="text-muted-foreground text-[11px]">
							Generated {formatRelative(state.generatedAt)}
							{stale ? " · regenerate for today's batch" : ""}
						</div>
					) : null}
					{ideas.map((idea) => (
						<IdeaCard
							key={idea.title}
							idea={idea}
							channelId={state?.channelId ?? null}
						/>
					))}
				</div>
			) : null}
		</>
	);
}

function ideaDescription(
	idea: DailyIdea,
	concept: ThumbnailConcept | null | undefined,
) {
	return [
		`Hook: ${idea.hook}`,
		`Why it works: ${idea.why}`,
		concept
			? `Thumbnail: ${concept.headline ? `"${concept.headline}" ` : ""}${concept.visual}`
			: null,
		idea.keywords.length ? `Keywords: ${idea.keywords.join(", ")}` : null,
	]
		.filter(Boolean)
		.join("\n");
}

function IdeaCard({
	idea,
	channelId,
}: {
	idea: DailyIdea;
	channelId: string | null;
}) {
	const { navigate } = usePanel();
	const [state] = useStorageItem(dailyIdeasState);
	const [saved, setSaved] = useStorageItem(savedIdeas);
	const savedEntry = saved.find(
		(s) => normalizeKey(s.title) === normalizeKey(idea.title),
	);
	const concept = state?.concepts[idea.title];
	const [tried, setTried] = useState(false);
	const [loadingConcept, setLoadingConcept] = useState(false);
	const requested = useRef(false);

	const loadConcept = useCallback(() => {
		requested.current = true;
		setTried(true);
		setLoadingConcept(true);
		conceptQueue(() =>
			ai.generate("thumbnailConcepts", {
				title: idea.title,
				topic: idea.hook,
				count: 1,
			}),
		)
			.then((out) => {
				const c = out.concepts[0] ?? null;
				return updateDailyIdeas((s) =>
					s ? { ...s, concepts: { ...s.concepts, [idea.title]: c } } : s,
				);
			})
			.catch(() => {
				// Shown as "Couldn't create a concept" with a retry button.
			})
			.finally(() => setLoadingConcept(false));
	}, [idea.title, idea.hook]);

	// Every idea gets a thumbnail concept (generated once, then stored).
	useEffect(() => {
		if (concept === undefined && !requested.current) loadConcept();
	}, [concept, loadConcept]);

	const toggleSave = () => {
		if (savedEntry) {
			void setSaved((prev) => prev.filter((s) => s.id !== savedEntry.id));
			toast("Removed from saved ideas");
		} else {
			const entry: SavedIdea = {
				id: newId(),
				title: idea.title,
				description: ideaDescription(idea, concept),
				source: "daily-ideas",
				createdAt: Date.now(),
				channelId: channelId ?? undefined,
				tags: idea.keywords,
			};
			void setSaved((prev) => [entry, ...prev]);
			toast("Saved", { tone: "success" });
		}
	};

	return (
		<article className="bg-card ring-foreground/7 flex flex-col gap-2.5 rounded-xl p-3 shadow-xs ring-1">
			<div className="flex items-start gap-2">
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Badge
						tone={idea.format === "short" ? "violet" : "sky"}
						className="self-start"
					>
						{idea.format === "short" ? "Short" : "Long-form"}
					</Badge>
					<h3 className="text-[13px] leading-snug font-semibold">
						{idea.title}
					</h3>
				</div>
				<IconButton
					label={savedEntry ? "Unsave" : "Save idea"}
					icon={savedEntry ? BookmarkCheck : Bookmark}
					onClick={toggleSave}
					className={savedEntry ? "text-brand" : undefined}
				/>
			</div>
			<div className="border-brand/60 border-l-2 pl-2 text-xs leading-relaxed italic">
				“{idea.hook}”
			</div>
			<div className="flex flex-col gap-0.5">
				<Eyebrow>Why it works</Eyebrow>
				<p className="text-muted-foreground text-xs leading-relaxed">
					{idea.why}
				</p>
			</div>

			<div className="bg-surface-2 flex flex-col gap-1.5 rounded-lg p-2.5">
				<Eyebrow>Thumbnail concept</Eyebrow>
				{concept ? (
					<ConceptView concept={concept} />
				) : loadingConcept ? (
					<div className="text-muted-foreground flex items-center gap-1.5 text-xs">
						<Spinner className="size-3" /> Sketching a thumbnail…
					</div>
				) : tried || concept === null ? (
					<div className="text-muted-foreground flex items-center gap-2 text-xs">
						Couldn't create a concept.
						<Button size="xs" variant="ghost" onClick={loadConcept}>
							<RefreshCw /> Retry
						</Button>
					</div>
				) : null}
			</div>

			{idea.keywords.length ? (
				<div className="flex flex-wrap gap-1">
					{idea.keywords.map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => navigate("keywords", { prefill: k })}
							className="bg-surface text-muted-foreground hover:border-brand/40 hover:text-brand focus-visible:ring-ring/50 rounded-lg border px-1.5 py-0.5 text-[11px] transition-colors duration-150 outline-none focus-visible:ring-2"
							title="Research this keyword"
						>
							{k}
						</button>
					))}
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-1">
				<CopyButton
					text={() => `${idea.title}\n${ideaDescription(idea, concept)}`}
					label="Copy"
					size={11}
				/>
				<Button
					size="xs"
					variant="ghost"
					onClick={() => navigate("optimize", { prefill: idea.title })}
				>
					<Gauge /> Optimize
				</Button>
				{concept ? (
					<Button
						size="xs"
						variant="ghost"
						onClick={() =>
							navigate("thumbnails", {
								view: "generate",
								prefill: concept.imagePrompt,
							})
						}
					>
						<Wand2 /> Generate thumbnail
					</Button>
				) : null}
				<Button
					size="xs"
					variant="ghost"
					onClick={() =>
						navigate("coach", {
							prefill: `Help me plan this video: "${idea.title}". Hook: ${idea.hook}`,
							autoSubmit: true,
						})
					}
				>
					<MessagesSquare /> Plan with coach
				</Button>
			</div>
		</article>
	);
}

function ConceptView({ concept }: { concept: ThumbnailConcept }) {
	return (
		<div className="flex flex-col gap-1.5 text-xs">
			{concept.headline ? (
				<div className="text-sm font-black tracking-tight uppercase">
					{concept.headline}
				</div>
			) : null}
			<p className="leading-relaxed">{concept.visual}</p>
			<p className="text-muted-foreground leading-relaxed">
				{concept.composition}
				{concept.emotion ? ` · Emotion: ${concept.emotion}` : ""}
			</p>
			{concept.colors.length ? (
				<div className="flex items-center gap-1">
					{concept.colors.slice(0, 6).map((c) => (
						<span
							key={c}
							className="ring-foreground/15 h-3 w-6 rounded-full ring-1"
							style={{ background: c }}
							title={c}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------

function SavedIdeasList() {
	const { navigate } = usePanel();
	const [saved, setSaved, loading] = useStorageItem(savedIdeas);
	const [title, setTitle] = useState("");
	const [showDone, setShowDone] = useState(true);
	const list = useMemo(
		() =>
			[...saved]
				.filter((s) => showDone || !s.done)
				.sort(
					(a, b) =>
						Number(!!a.done) - Number(!!b.done) || b.createdAt - a.createdAt,
				),
		[saved, showDone],
	);

	const add = () => {
		const t = title.trim();
		if (!t) return;
		void setSaved((prev) => [
			{ id: newId(), title: t, source: "manual", createdAt: Date.now() },
			...prev,
		]);
		setTitle("");
	};

	if (loading) return <LoadingBlock />;

	return (
		<>
			<form
				className="flex gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					add();
				}}
			>
				<Input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="Jot down an idea"
					aria-label="New idea"
				/>
				<Button type="submit" disabled={!title.trim()}>
					<Plus /> Add
				</Button>
			</form>
			{saved.length === 0 ? (
				<EmptyState icon={Bookmark} title="No saved ideas">
					Save ideas from Daily Ideas (or jot them down above). They stay in
					this browser.
				</EmptyState>
			) : (
				<>
					<div className="text-muted-foreground flex items-center gap-2 text-[11px]">
						<Checkbox
							checked={showDone}
							onCheckedChange={(v) => setShowDone(!!v)}
							aria-label="Show done ideas"
						/>
						<span aria-hidden>
							Show done ({saved.filter((s) => s.done).length})
						</span>
					</div>
					<div className="flex flex-col gap-1.5">
						{list.map((idea) => (
							<div
								key={idea.id}
								className={cn(
									"group bg-card ring-foreground/7 flex items-start gap-2.5 rounded-xl p-2.5 shadow-xs ring-1 transition-opacity duration-150",
									idea.done && "opacity-60",
								)}
							>
								<Checkbox
									checked={!!idea.done}
									onCheckedChange={(v) =>
										void setSaved((prev) =>
											prev.map((s) =>
												s.id === idea.id ? { ...s, done: !!v } : s,
											),
										)
									}
									aria-label={idea.done ? "Mark as not done" : "Mark as done"}
									className="mt-0.5"
								/>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<span
										className={cn(
											"text-xs leading-snug font-medium",
											idea.done && "line-through",
										)}
									>
										{idea.title}
									</span>
									{idea.description ? (
										<p className="ovq-clamp-3 text-muted-foreground text-[11px] leading-relaxed whitespace-pre-line">
											{idea.description}
										</p>
									) : null}
									<div className="text-muted-foreground flex items-center gap-1.5 text-[10px]">
										<Badge>{idea.source.replace(/-/g, " ")}</Badge>
										{formatRelative(idea.createdAt)}
									</div>
								</div>
								<div className="flex shrink-0 flex-col items-center gap-0.5">
									<CopyButton
										text={[idea.title, idea.description]
											.filter(Boolean)
											.join("\n")}
										size={11}
										style={{ padding: 4, border: "none" }}
									/>
									<IconButton
										label="Optimize title & tags"
										icon={Gauge}
										size="icon-xs"
										onClick={() =>
											navigate("optimize", { prefill: idea.title })
										}
									/>
									<IconButton
										label="Thumbnail ideas"
										icon={Image}
										size="icon-xs"
										onClick={() =>
											navigate("thumbnails", {
												view: "similar",
												prefill: idea.title,
											})
										}
									/>
									<IconButton
										label="Delete"
										icon={Trash2}
										size="icon-xs"
										onClick={() => {
											void setSaved((prev) =>
												prev.filter((s) => s.id !== idea.id),
											);
											toast("Idea deleted", {
												action: {
													label: "Undo",
													onClick: () =>
														void setSaved((prev) => [idea, ...prev]),
												},
											});
										}}
									/>
								</div>
							</div>
						))}
					</div>
					{list.length === 0 ? (
						<Notice>All your ideas are done. Nice work!</Notice>
					) : null}
				</>
			)}
		</>
	);
}
