/**
 * The GrowTube optimizer panel injected into YouTube Studio's details
 * editor (video edit page and the upload dialog's Details step).
 */
import { findControversialKeywords } from "@growtube/shared/controversial";
import { computeSeoScore } from "@growtube/shared/seo";
import {
	ChevronDown,
	ChevronUp,
	MessageCircle,
	PanelRight,
	PictureInPicture2,
	Rows3,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { copyText, Logo } from "@/components/common";
import type { CoachContext } from "@/lib/ai/types";
import { BackgroundError, ext } from "@/lib/client";
import { useBackground, useStorageItem } from "@/lib/hooks";
import { myChannel } from "@/lib/settings";

import { AiTools } from "./AiTools";
import { Checklist, ControversialList } from "./Checklist";
import {
	type PanelMode,
	saveKeyword,
	studioKeywords,
	studioPanelPrefs,
} from "./prefs";
import { Counters, KeywordField, ScoreSummary } from "./ScoreSection";
import type { PanelHostState, Placement } from "./store";
import {
	addTags,
	removeAllTags,
	StudioFields,
	type StudioTarget,
	writeEditable,
} from "./studio-dom";
import { TagRanks } from "./TagRanks";
import { fitTags, sanitizeDescription, sanitizeTitle } from "./text";
import {
	Btn,
	cx,
	Notice,
	type NoticeKind,
	Section,
	Spinner,
	scoreTone,
} from "./ui";
import { useDebounced, useStudioFields } from "./use-studio-fields";

const EMPTY_TAGS: string[] = [];
const GIVE_UP_MS = 10_000;

const SECTION_DEFAULTS: Record<string, boolean> = {
	checklist: true,
	controversial: true,
	ai: true,
	ranks: false,
};

type PanelNotice = {
	kind: NoticeKind;
	text: string;
	undo?: () => Promise<void>;
	showMore?: boolean;
};

export type StudioPanelProps = PanelHostState & {
	target: StudioTarget;
	host: Element;
};

const PLACEMENT_LABEL: Record<Placement, string> = {
	docked: "Dock in Studio's side column",
	floating: "Float over the page",
	inline: "Show above the form",
};

function placementToMode(p: Placement): PanelMode {
	return p === "docked" ? "docked" : "floating";
}

export function StudioPanel({
	target,
	placement,
	altPlacement,
	dark,
	host,
}: StudioPanelProps) {
	const [prefs, setPrefs] = useStorageItem(studioPanelPrefs);
	const fields = useMemo(() => new StudioFields(target), [target]);
	const { snapshot, refresh } = useStudioFields(fields, { host });
	const videoId = target.videoId;
	const memoryKey = `studio:${videoId ?? target.kind}`;

	// ---- fields --------------------------------------------------------------
	const found = {
		title: snapshot.title != null,
		description: snapshot.description != null,
		tags: snapshot.tags != null,
	};
	const anyFound = found.title || found.description || found.tags;
	const title = snapshot.title ?? "";
	const description = snapshot.description ?? "";
	const tags = snapshot.tags ?? EMPTY_TAGS;

	const [gaveUp, setGaveUp] = useState(false);
	useEffect(() => {
		if (anyFound) {
			setGaveUp(false);
			return;
		}
		const t = setTimeout(() => setGaveUp(true), GIVE_UP_MS);
		return () => clearTimeout(t);
	}, [anyFound]);

	// ---- target keyword (remembered per video) -------------------------------
	const [keywordInput, setKeywordInput] = useState("");
	const keywordTouched = useRef(false);
	useEffect(() => {
		keywordTouched.current = false;
		setKeywordInput("");
		if (!videoId) return;
		let alive = true;
		studioKeywords
			.getValue()
			.then((all) => {
				if (alive && !keywordTouched.current)
					setKeywordInput(all[videoId]?.keyword ?? "");
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [videoId]);
	const savedKeyword = useDebounced(keywordInput, 600);
	useEffect(() => {
		if (videoId && keywordTouched.current)
			void saveKeyword(videoId, savedKeyword).catch(() => {});
	}, [videoId, savedKeyword]);
	const onKeywordChange = (value: string) => {
		keywordTouched.current = true;
		setKeywordInput(value);
	};
	const keyword = keywordInput.trim() || tags[0]?.trim() || "";

	const suggestQuery = useDebounced(keyword, 400);
	const suggest = useBackground(
		"yt.getSearchSuggestions",
		suggestQuery ? { query: suggestQuery } : null,
		[suggestQuery],
	);
	const suggestions = useMemo(
		() =>
			(suggest.data ?? [])
				.filter((s) => s.toLowerCase() !== suggestQuery.toLowerCase())
				.slice(0, 8),
		[suggest.data, suggestQuery],
	);

	// ---- public video data (duration, Short?, visibility) ---------------------
	// Nothing from Studio reaches the server, not even the edited video's id.
	const details = useBackground(
		"yt.getVideoDetails",
		videoId ? { videoId, level: "basic", crowdsource: false } : null,
		[videoId],
	);
	const [channel] = useStorageItem(myChannel);

	// ---- score & warnings (debounced) ----------------------------------------
	const source = useMemo(
		() => ({ title, description, tags, keyword }),
		[title, description, tags, keyword],
	);
	const live = useDebounced(source, 200);
	const seo = useMemo(
		() =>
			computeSeoScore({
				title: live.title,
				description: live.description,
				tags: live.tags,
				targetKeyword: live.keyword || null,
				durationSec: details.data?.durationSec ?? null,
				isShort: details.data?.isShort ?? null,
			}),
		[live, details.data],
	);
	const controversial = useMemo(
		() => findControversialKeywords(live.title, live.description, live.tags),
		[live],
	);

	// ---- notices + apply -----------------------------------------------------
	const [notice, setNotice] = useState<PanelNotice | null>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const show = useCallback((n: PanelNotice | null) => {
		if (noticeTimer.current) clearTimeout(noticeTimer.current);
		setNotice(n);
		if (n && (n.kind === "ok" || n.kind === "info") && !n.undo) {
			noticeTimer.current = setTimeout(() => setNotice(null), 6_000);
		}
	}, []);
	useEffect(
		() => () => {
			if (noticeTimer.current) clearTimeout(noticeTimer.current);
		},
		[],
	);

	const saveHint =
		target.kind === "upload"
			? "Studio saves upload drafts on its own; nothing is published until you finish the upload."
			: "Review the change, then click Save in Studio.";

	const writeField = useCallback(
		async (which: "title" | "description", raw: string) => {
			const text =
				which === "title" ? sanitizeTitle(raw) : sanitizeDescription(raw);
			const label = which === "title" ? "Title" : "Description";
			const el = which === "title" ? fields.title() : fields.description();
			if (!el) {
				await copyText(text);
				show({
					kind: "error",
					text: `Couldn't find Studio's ${label.toLowerCase()} field. The text is copied: paste it into the ${label} box.`,
				});
				return;
			}
			const result = await writeEditable(el, text);
			refresh();
			if (result.ok) {
				show({
					kind: "ok",
					text: `${label} updated. ${saveHint}`,
					undo: async () => {
						const field =
							which === "title" ? fields.title() : fields.description();
						if (field) await writeEditable(field, result.previous);
						refresh();
						show({ kind: "info", text: `${label} restored.` });
					},
				});
			} else {
				await copyText(text);
				show({
					kind: "warn",
					text: `Studio didn't take the change automatically. The ${label.toLowerCase()} is copied: click the ${label} box, select all (Ctrl+A) and paste.`,
				});
			}
		},
		[fields, refresh, show, saveHint],
	);

	const onApplyTitle = useCallback(
		(t: string) => writeField("title", t),
		[writeField],
	);
	const onApplyDescription = useCallback(
		(t: string) => writeField("description", t),
		[writeField],
	);

	const onAddTags = useCallback(
		async (list: string[], mode: "add" | "replace") => {
			const before = fields.readTags();
			if (before == null || !fields.tagInput()) {
				await copyText(list.join(", "));
				show({
					kind: "warn",
					text: "Studio's Tags box isn't visible. The tags are copied: open \"Show more\" in Studio and paste them into Tags.",
					showMore: true,
				});
				return;
			}
			const lowerBefore = new Set(before.map((t) => t.toLowerCase()));
			let toAdd: string[];
			if (mode === "replace") {
				const cleared = await removeAllTags(fields);
				if (!cleared) {
					await copyText(list.join(", "));
					show({
						kind: "warn",
						text: "Couldn't remove the current tags automatically. The new tags are copied: clear Studio's Tags box (the x button) and paste.",
					});
					refresh();
					return;
				}
				toAdd = fitTags(list);
			} else {
				toAdd = fitTags([...before, ...list]).filter(
					(t) => !lowerBefore.has(t.toLowerCase()),
				);
			}
			const result = await addTags(fields, toAdd);
			refresh();
			const restore = async () => {
				await removeAllTags(fields);
				await addTags(fields, before);
				refresh();
				show({ kind: "info", text: "Tags restored." });
			};
			if (result.failed.length) {
				await copyText(result.failed.join(", "));
				show({
					kind: "warn",
					text: `${result.added.length ? `Added ${result.added.length}. ` : ""}${result.failed.length} tag${result.failed.length === 1 ? "" : "s"} couldn't be added automatically and ${result.failed.length === 1 ? "is" : "are"} copied: click Studio's Tags box and paste.`,
					undo: result.added.length || mode === "replace" ? restore : undefined,
				});
			} else if (result.added.length) {
				show({
					kind: "ok",
					text: `${mode === "replace" ? "Replaced tags" : `Added ${result.added.length} tag${result.added.length === 1 ? "" : "s"}`}. ${saveHint}`,
					undo: restore,
				});
			} else {
				show({ kind: "info", text: "Those tags are already there." });
			}
		},
		[fields, refresh, show, saveHint],
	);

	const clickShowMore = () => {
		const btn = fields.showMoreButton();
		if (btn) {
			btn.click();
			fields.reset();
			setTimeout(refresh, 400);
			setTimeout(refresh, 1200);
			if (notice?.showMore) show(null);
		} else {
			show({
				kind: "warn",
				text: "Couldn't find Studio's \"Show more\" button. Scroll down the Details form and click it.",
			});
		}
	};

	// ---- context for the coach / AI -------------------------------------------
	const video = useMemo<NonNullable<CoachContext["video"]>>(
		() => ({
			videoId: videoId ?? undefined,
			title,
			description,
			keywords: tags,
			durationSec: details.data?.durationSec ?? null,
			isShort: details.data?.isShort,
			category: details.data?.category ?? null,
			channelTitle: details.data?.channelTitle ?? channel?.title,
		}),
		[videoId, title, description, tags, details.data, channel],
	);
	const coachChannel = useMemo<CoachContext["channel"]>(
		() =>
			channel
				? {
						channelId: channel.channelId,
						title: channel.title,
						handle: channel.handle,
					}
				: undefined,
		[channel],
	);
	const tagRanks = useRef<Record<string, number | null>>({});
	const onRanks = useCallback((r: Record<string, number | null>) => {
		tagRanks.current = r;
	}, []);

	const openCoach = () => {
		void ext
			.openSidePanel({
				videoId: videoId ?? undefined,
				tool: "coach",
				prefill:
					"How can I improve this video's title, description and tags so it gets found in search?",
				coach: {
					page: "studio",
					video,
					stats: { seoScore: seo.score, tagRanks: tagRanks.current },
					myChannel: channel
						? { title: channel.title, handle: channel.handle }
						: undefined,
				},
			})
			.catch((error: unknown) =>
				show({
					kind: "error",
					text:
						error instanceof Error
							? error.message
							: "Couldn't open the side panel.",
				}),
			);
	};

	const visibilityNote = useMemo(() => {
		if (details.data?.isUnlisted)
			return "Unlisted videos don't appear in YouTube search, so ranks show as >40.";
		if (
			details.error instanceof BackgroundError &&
			details.error.code === "NOT_FOUND"
		)
			return "YouTube can't see this video publicly yet (private, scheduled or processing), so it won't rank until it's public.";
		return null;
	}, [details.data, details.error]);

	// ---- layout ---------------------------------------------------------------
	const sectionOpen = (id: string) =>
		prefs.sections[id] ?? SECTION_DEFAULTS[id] ?? true;
	const toggleSection = (id: string, open: boolean) =>
		void setPrefs((p) => ({ ...p, sections: { ...p.sections, [id]: open } }));
	const collapsed = prefs.collapsed;
	const setCollapsed = (value: boolean) =>
		void setPrefs((p) => ({ ...p, collapsed: value }));
	const switchPlacement = () => {
		if (altPlacement)
			void setPrefs((p) => ({ ...p, mode: placementToMode(altPlacement) }));
	};

	const tone = scoreTone(seo.score);
	const rootClass = cx(
		"ovq-root",
		dark && "ovq-dark",
		`ovq-placement-${placement}`,
		collapsed && "ovq-collapsed",
	);

	if (placement === "floating" && collapsed) {
		return (
			<div className={rootClass}>
				<button
					type="button"
					className="ovq-fab"
					onClick={() => setCollapsed(false)}
					title="Open the GrowTube optimizer"
				>
					<Logo size={20} />
					{anyFound ? (
						<span className={cx("ovq-fab-score", `ovq-tone-${tone}`)}>
							{seo.score}
						</span>
					) : (
						<span className="ovq-fab-score">SEO</span>
					)}
				</button>
			</div>
		);
	}

	const PlacementIcon =
		altPlacement === "docked"
			? PanelRight
			: altPlacement === "inline"
				? Rows3
				: PictureInPicture2;

	return (
		<div className={rootClass}>
			<aside className="ovq-panel" aria-label="GrowTube optimizer">
				<header className="ovq-header">
					<button
						type="button"
						className="ovq-header-main"
						onClick={() => setCollapsed(!collapsed)}
						aria-expanded={!collapsed}
						title={collapsed ? "Expand" : "Collapse"}
					>
						<Logo size={20} />
						<span className="ovq-brand">GrowTube</span>
						<span className="ovq-header-sub">SEO</span>
						{anyFound ? (
							<span className={cx("ovq-score-pill", `ovq-tone-${tone}`)}>
								{seo.score}
							</span>
						) : null}
					</button>
					<div className="ovq-header-actions">
						{altPlacement ? (
							<button
								type="button"
								className="ovq-icon-btn"
								onClick={switchPlacement}
								title={PLACEMENT_LABEL[altPlacement]}
								aria-label={PLACEMENT_LABEL[altPlacement]}
							>
								<PlacementIcon size={15} />
							</button>
						) : null}
						<button
							type="button"
							className="ovq-icon-btn"
							onClick={() => setCollapsed(!collapsed)}
							title={collapsed ? "Expand" : "Collapse"}
							aria-label={collapsed ? "Expand panel" : "Collapse panel"}
						>
							{collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
						</button>
					</div>
				</header>

				{collapsed ? null : (
					<div className="ovq-body">
						{notice ? (
							<Notice
								kind={notice.kind}
								action={
									<div className="ovq-notice-buttons">
										{notice.showMore ? (
											<Btn small onClick={clickShowMore}>
												Show more
											</Btn>
										) : null}
										{notice.undo ? (
											<Btn
												small
												onClick={() => {
													const undo = notice.undo;
													show(null);
													void undo?.();
												}}
											>
												Undo
											</Btn>
										) : null}
										<Btn small variant="ghost" onClick={() => show(null)}>
											Dismiss
										</Btn>
									</div>
								}
							>
								{notice.text}
							</Notice>
						) : null}

						{!anyFound ? (
							gaveUp ? (
								<Notice
									kind="error"
									action={
										<Btn
											small
											onClick={() => {
												fields.reset();
												refresh();
												setGaveUp(false);
											}}
										>
											Retry
										</Btn>
									}
								>
									Couldn't find the editor fields (title, description, tags).
									Studio may have changed its layout or is still loading. Your
									video isn't affected.
								</Notice>
							) : (
								<div className="ovq-empty-row">
									<Spinner />
									<span>Looking for Studio's editor fields…</span>
								</div>
							)
						) : (
							<>
								<ScoreSummary seo={seo} found={found} />
								<Counters
									title={title}
									description={description}
									tags={tags}
									found={found}
								/>
								{!found.tags ? (
									<Notice
										kind="info"
										action={
											<Btn small onClick={clickShowMore}>
												Show more
											</Btn>
										}
									>
										Tags are hidden. Open "Show more" in Studio to score and
										edit them.
									</Notice>
								) : null}
								{!found.title || !found.description ? (
									<Notice kind="warn">
										Couldn't find the {!found.title ? "title" : "description"}{" "}
										field; that part of the score is incomplete.
									</Notice>
								) : null}
								<KeywordField
									value={keywordInput}
									placeholder={tags[0] ?? ""}
									onChange={onKeywordChange}
									suggestions={suggestions}
									loadingSuggestions={suggest.loading && !suggestions.length}
									tags={tags}
									tagsAvailable={found.tags}
									onAddTag={(t) => void onAddTags([t], "add")}
								/>

								<Section
									id="checklist"
									title="SEO checklist"
									badge={`${seo.checks.filter((c) => c.passed).length}/${seo.checks.length}`}
									open={sectionOpen("checklist")}
									onToggle={toggleSection}
								>
									<Checklist checks={seo.checks} />
								</Section>

								<Section
									id="controversial"
									title="Controversial keywords"
									badge={
										controversial.length ? (
											<span className="ovq-badge-warn">
												{controversial.length}
											</span>
										) : (
											"0"
										)
									}
									open={sectionOpen("controversial")}
									onToggle={toggleSection}
								>
									<ControversialList
										matches={controversial}
										fields={{
											title: live.title,
											description: live.description,
											tags: live.tags,
										}}
									/>
								</Section>

								<Section
									id="ai"
									title="AI assistant"
									open={sectionOpen("ai")}
									onToggle={toggleSection}
								>
									<AiTools
										memoryKey={memoryKey}
										videoId={videoId}
										title={title}
										description={description}
										tags={tags}
										keyword={keyword}
										suggestions={suggestions}
										video={video}
										channel={coachChannel}
										canApply={found}
										onApplyTitle={onApplyTitle}
										onApplyDescription={onApplyDescription}
										onAddTags={onAddTags}
									/>
								</Section>

								<Section
									id="ranks"
									title="Tag rankings"
									open={sectionOpen("ranks")}
									onToggle={toggleSection}
								>
									<TagRanks
										memoryKey={memoryKey}
										videoId={videoId}
										tags={tags}
										keyword={keyword}
										visibilityNote={visibilityNote}
										onRanks={onRanks}
									/>
								</Section>
							</>
						)}

						<footer className="ovq-footer">
							<Btn
								small
								variant="ghost"
								icon={<MessageCircle size={13} />}
								onClick={openCoach}
							>
								Ask the AI Coach
							</Btn>
							<span className="ovq-muted ovq-small">
								{target.kind === "upload"
									? "Free and unlimited."
									: "Never saves for you: click Save in Studio."}
							</span>
						</footer>
					</div>
				)}
			</aside>
		</div>
	);
}
