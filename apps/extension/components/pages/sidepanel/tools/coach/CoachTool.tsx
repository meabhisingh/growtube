/**
 * AI Coach: streaming chat with saved conversations, a context selector
 * (current tab / my channel / pinned / none), suggested prompts, copy,
 * regenerate and stop. Unlimited: no counters, no quotas.
 */
import { formatCompact } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Textarea } from "@growtube/ui/components/textarea";
import { cn } from "@growtube/ui/lib/utils";
import {
	ArrowUp,
	Clapperboard,
	History,
	MonitorPlay,
	Pin,
	Plus,
	RefreshCw,
	Settings,
	Square,
	UserRound,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CopyButton, Logo, Markdown } from "@/components/common";
import {
	buildPresetPrompt,
	COACH_PRESETS,
	type CoachPresetId,
	presetLabel,
} from "@/lib/ai/prompts";
import type { CoachContext, UiChatMessage } from "@/lib/ai/types";
import { useAiChat } from "@/lib/ai/use-ai-chat";
import { ext, yt } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	type AiConversation,
	aiConversations,
	newId,
	withConversation,
} from "@/lib/settings";

import { IconButton, Segmented } from "../../../ui/controls";
import { Notice, Spinner } from "../../../ui/feedback";
import { describeError, segmentsToText } from "../../../utils";
import type { ToolProps } from "../../nav";
import { AiSetupNotice } from "../../shared";
import { ConversationList } from "./ConversationList";
import {
	type CoachContextState,
	type ContextMode,
	labelOfContext,
	useCoachContext,
} from "./useCoachContext";

const GENERIC_PROMPTS = [
	"Give me 5 video ideas for my niche",
	"How do I write titles that get clicks without clickbait?",
	"What makes a thumbnail stand out in search?",
	"Build me a simple 30-day upload plan",
];

function titleFrom(messages: UiChatMessage[]): string {
	const first = messages.find((m) => m.role === "user")?.content ?? "New chat";
	const line = first.split("\n")[0]?.trim() ?? "New chat";
	return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New chat";
}

type Suggestion = { label: string; preset?: CoachPresetId; text?: string };

/**
 * Prefills that match a preset label ("Analyze the hook", "Why did this video
 * do poorly?") run as that preset, so they get the transcript and the full
 * preset prompt.
 */
function suggestionFromText(text: string): Suggestion {
	const t = text.trim().toLowerCase();
	const preset =
		COACH_PRESETS.find((p) => p.label.toLowerCase() === t)?.id ??
		(/^why did this video do (well|poorly)\??$/.test(t)
			? ("why-performance" as const)
			: undefined);
	return preset ? { label: text, preset } : { label: text, text };
}

function suggestionsFor(state: CoachContextState): Suggestion[] {
	const ctx = state.context;
	const hasVideo = !!ctx?.video;
	const hasChannel = !!(ctx?.channel || ctx?.myChannel);
	const presets: Suggestion[] = COACH_PRESETS.filter((p) =>
		p.needs.every((n) =>
			n === "video" ? hasVideo : n === "channel" ? hasChannel : hasVideo,
		),
	).map((p) => ({ label: presetLabel(p.id, ctx), preset: p.id }));
	const generic = GENERIC_PROMPTS.map((text) => ({ label: text, text }));
	return [...presets, ...generic].slice(0, 6);
}

export function CoachTool({ intent, active }: ToolProps) {
	const [conversations, setConversations] = useStorageItem(aiConversations);
	const coach = useCoachContext();
	const chat = useAiChat({ context: coach.context });
	const [activeId, setActiveId] = useState<string | null>(null);
	const activeIdRef = useRef<string | null>(null);
	const [view, setView] = useState<"chat" | "history">("chat");
	const [draft, setDraft] = useState("");
	const [preparing, setPreparing] = useState(false);
	const [pendingSend, setPendingSend] = useState<Suggestion | null>(null);
	const contextRef = useRef<CoachContext | null>(null);
	contextRef.current = coach.context;
	const inputRef = useRef<HTMLTextAreaElement | null>(null);
	const scrollRef = useRef<HTMLDivElement | null>(null);
	const stickToBottom = useRef(true);

	const activeConversation = conversations.find((c) => c.id === activeId);

	// ---- persistence -------------------------------------------------------
	const persist = useCallback(
		(messages: UiChatMessage[]) => {
			if (!messages.some((m) => m.role === "user")) return;
			let id = activeIdRef.current;
			if (!id) {
				id = newId();
				activeIdRef.current = id;
				setActiveId(id);
			}
			const convId = id;
			const now = Date.now();
			void setConversations((prev) => {
				const existing = prev.find((c) => c.id === convId);
				const conv: AiConversation = existing
					? { ...existing, messages, updatedAt: now }
					: {
							id: convId,
							title: titleFrom(messages),
							createdAt: now,
							updatedAt: now,
							messages,
							context: contextRef.current,
						};
				return withConversation(prev, conv);
			});
		},
		[setConversations],
	);

	// Save when a reply finishes (or fails / is stopped).
	const prevStatus = useRef(chat.status);
	useEffect(() => {
		if (prevStatus.current === "streaming" && chat.status !== "streaming")
			persist(chat.messages);
		prevStatus.current = chat.status;
	}, [chat.status, chat.messages, persist]);

	const switchTo = useCallback(
		(conv: AiConversation | null) => {
			if (chat.status === "streaming") {
				chat.stop();
				persist(chat.messages);
			}
			prevStatus.current = "idle";
			activeIdRef.current = conv?.id ?? null;
			setActiveId(conv?.id ?? null);
			if (conv) {
				chat.setMessages(conv.messages);
				if (conv.context)
					coach.pin({
						kind: "context",
						context: conv.context,
						label: labelOfContext(conv.context),
					});
			} else {
				chat.reset();
				if (coach.mode === "pinned") coach.setMode("tab");
			}
			setView("chat");
			stickToBottom.current = true;
		},
		[chat, coach, persist],
	);

	// ---- sending -----------------------------------------------------------
	const send = useCallback(
		async (s: Suggestion) => {
			let text = s.text ?? "";
			let context = contextRef.current;
			if (s.preset) {
				text = buildPresetPrompt(s.preset, context);
				const needsTranscript = s.preset === "hook" || s.preset === "summarize";
				const videoId = context?.video?.videoId;
				if (needsTranscript && videoId && !context?.transcriptExcerpt) {
					setPreparing(true);
					try {
						const t = await yt.getTranscript(videoId);
						if (t?.segments.length) {
							const excerpt =
								s.preset === "hook"
									? segmentsToText(t.segments, { toSec: 60 })
									: segmentsToText(t.segments, { maxChars: 12_000 });
							context = { ...context, transcriptExcerpt: excerpt };
							text = buildPresetPrompt(s.preset, context);
						}
					} catch {
						// No transcript: the preset prompt handles that case.
					} finally {
						setPreparing(false);
					}
				}
			}
			if (!text.trim()) return;
			stickToBottom.current = true;
			void chat.send(text, { context });
		},
		[chat],
	);

	const submitDraft = () => {
		const text = draft.trim();
		if (!text || chat.status === "streaming" || preparing) return;
		setDraft("");
		void send({ label: text, text });
	};

	// Deferred send (intent autoSubmit): wait for the context to load.
	useEffect(() => {
		if (!pendingSend || coach.loading) return;
		const s = pendingSend;
		setPendingSend(null);
		void send(s);
	}, [pendingSend, coach.loading, send]);

	// ---- intents -----------------------------------------------------------
	// biome-ignore lint/correctness/useExhaustiveDependencies: run once per intent
	useEffect(() => {
		// A bare "open the coach" keeps the current conversation.
		if (
			!intent ||
			!(intent.prefill || intent.coach || intent.videoId || intent.channelId)
		)
			return;
		switchTo(null);
		if (intent.coach) {
			coach.pin({
				kind: "context",
				context: intent.coach,
				label: labelOfContext(intent.coach),
			});
		} else if (intent.videoId) {
			coach.pin({ kind: "video", videoId: intent.videoId });
		} else if (intent.channelId) {
			coach.pin({ kind: "channel", channelId: intent.channelId });
		}
		if (intent.prefill) {
			if (intent.autoSubmit) setPendingSend(suggestionFromText(intent.prefill));
			else {
				setDraft(intent.prefill);
				requestAnimationFrame(() => inputRef.current?.focus());
			}
		}
	}, [intent?.id]);

	useEffect(() => {
		if (active && view === "chat")
			requestAnimationFrame(() => inputRef.current?.focus());
	}, [active, view]);

	// ---- auto-scroll -------------------------------------------------------
	const lastContent = chat.messages.at(-1)?.content.length ?? 0;
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new content
	useEffect(() => {
		const el = scrollRef.current;
		if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
	}, [chat.messages.length, lastContent]);

	const onScroll = () => {
		const el = scrollRef.current;
		if (!el) return;
		stickToBottom.current =
			el.scrollHeight - el.scrollTop - el.clientHeight < 80;
	};

	const suggestions = useMemo(() => suggestionsFor(coach), [coach]);
	const streaming = chat.status === "streaming";
	const lastAssistant = [...chat.messages]
		.reverse()
		.find((m) => m.role === "assistant");

	if (view === "history") {
		return (
			<div className="flex h-full flex-col">
				<div className="flex items-center gap-2 border-b px-3 py-1.5">
					<span className="text-xs font-medium">Conversations</span>
					<div className="flex-1" />
					<IconButton
						label="Back to chat"
						icon={X}
						onClick={() => setView("chat")}
					/>
				</div>
				<div className="min-h-0 flex-1">
					<ConversationList
						conversations={conversations}
						activeId={activeId}
						onOpen={(c) => switchTo(c)}
						onNew={() => switchTo(null)}
						onRename={(id, title) =>
							void setConversations((prev) =>
								prev.map((c) => (c.id === id ? { ...c, title } : c)),
							)
						}
						onDelete={(id) => {
							void setConversations((prev) => prev.filter((c) => c.id !== id));
							if (id === activeId) switchTo(null);
						}}
						onClearAll={() => {
							void setConversations([]);
							switchTo(null);
						}}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex h-full flex-col">
			{/* Top bar: history, title, new chat */}
			<div className="flex items-center gap-1 border-b px-2 py-1.5">
				<IconButton
					label="Conversations"
					icon={History}
					onClick={() => setView("history")}
				/>
				<div className="min-w-0 flex-1 truncate px-1 text-xs font-medium">
					{activeConversation?.title ?? "New conversation"}
				</div>
				<IconButton
					label="New chat"
					icon={Plus}
					onClick={() => switchTo(null)}
				/>
			</div>

			<ContextBar coach={coach} />

			{/* Messages */}
			<div
				ref={scrollRef}
				onScroll={onScroll}
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
			>
				{chat.messages.length === 0 ? (
					<div className="flex flex-col gap-4 p-4">
						<div className="flex flex-col items-center gap-2 pt-4 text-center">
							<Logo size={36} />
							<div className="text-sm font-semibold">
								What do you want to grow today?
							</div>
							<p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
								Ask about the video or channel in focus, your strategy, titles,
								hooks or thumbnails. As many questions as you like.
							</p>
						</div>
						<AiSetupNotice />
						<div className="flex flex-col gap-1.5">
							{suggestions.map((s) => (
								<button
									key={s.label}
									type="button"
									disabled={coach.loading || preparing}
									onClick={() => void send(s)}
									className="bg-surface hover:border-brand/40 hover:bg-brand-soft focus-visible:ring-ring/50 rounded-xl border px-3 py-2 text-left text-xs shadow-xs transition duration-150 ease-out outline-none focus-visible:ring-3 disabled:opacity-50 motion-safe:active:scale-[0.99]"
								>
									{s.label}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-4 p-3">
						{chat.messages.map((m) => (
							<ChatMessage
								key={m.id}
								message={m}
								streaming={streaming && m.id === chat.messages.at(-1)?.id}
								canRegenerate={
									!streaming &&
									m.id === lastAssistant?.id &&
									m.role === "assistant"
								}
								errorCode={m.id === lastAssistant?.id ? chat.errorCode : null}
								onRegenerate={() => {
									stickToBottom.current = true;
									chat.retry();
								}}
							/>
						))}
					</div>
				)}
			</div>

			{/* Composer */}
			<div className="bg-surface border-t p-2">
				{preparing || pendingSend ? (
					<div className="text-muted-foreground flex items-center gap-1.5 px-1 pb-1.5 text-[11px]">
						<Spinner className="size-3" />
						{preparing ? "Reading the transcript…" : "Loading context…"}
					</div>
				) : null}
				<div className="flex items-end gap-1.5">
					<Textarea
						ref={inputRef}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (
								e.key === "Enter" &&
								!e.shiftKey &&
								!e.nativeEvent.isComposing
							) {
								e.preventDefault();
								submitDraft();
							}
						}}
						rows={1}
						placeholder="Ask the coach…  (Shift+Enter for a new line)"
						aria-label="Message the coach"
						className="bg-background max-h-40 min-h-9 py-2"
					/>
					{streaming ? (
						<IconButton
							label="Stop"
							icon={Square}
							variant="outline"
							size="icon"
							onClick={() => chat.stop()}
							side="top"
						/>
					) : (
						<IconButton
							label="Send"
							icon={ArrowUp}
							variant="default"
							size="icon"
							disabled={!draft.trim() || preparing}
							onClick={submitDraft}
							side="top"
						/>
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------

const MODE_OPTIONS = [
	{ value: "tab", label: "This tab", icon: MonitorPlay },
	{ value: "mine", label: "My channel", icon: UserRound },
	{ value: "none", label: "None" },
] as const;

function ContextBar({ coach }: { coach: CoachContextState }) {
	const options =
		coach.mode === "pinned" || coach.pinned
			? [
					...MODE_OPTIONS,
					{ value: "pinned" as const, label: "Pinned", icon: Pin },
				]
			: MODE_OPTIONS;
	const ctx = coach.context;
	return (
		<div className="bg-surface flex flex-col gap-1.5 border-b px-3 py-2">
			<div className="flex items-center gap-2">
				<span className="text-muted-foreground text-[11px]">Context</span>
				<Segmented<ContextMode>
					size="xs"
					value={coach.mode}
					onChange={coach.setMode}
					options={options}
					ariaLabel="Coach context"
				/>
			</div>
			<div className="flex min-h-5 items-center gap-1.5 text-[11px]">
				{coach.loading ? (
					<>
						<Spinner className="size-3" />
						<span className="text-muted-foreground">Loading context…</span>
					</>
				) : coach.error ? (
					<span className="truncate text-red-600 dark:text-red-400">
						Couldn't load: {describeError(coach.error).message}
					</span>
				) : coach.emptyReason ? (
					<span className="text-muted-foreground">{coach.emptyReason}</span>
				) : ctx ? (
					<>
						{ctx.video ? (
							<Clapperboard
								className="text-brand size-3.5 shrink-0"
								aria-hidden
							/>
						) : (
							<UserRound className="text-brand size-3.5 shrink-0" aria-hidden />
						)}
						<span
							className="truncate font-medium"
							title={coach.label ?? undefined}
						>
							{coach.label ?? labelOfContext(ctx)}
						</span>
						{ctx.video?.views != null ? (
							<span className="text-muted-foreground shrink-0">
								· {formatCompact(ctx.video.views)} views
							</span>
						) : ctx.channel?.subscribers != null ? (
							<span className="text-muted-foreground shrink-0">
								· {formatCompact(ctx.channel.subscribers)} subs
							</span>
						) : null}
					</>
				) : (
					<span className="text-muted-foreground">
						General chat, no video or channel attached.
					</span>
				)}
			</div>
		</div>
	);
}

const SETUP_CODES = new Set([
	"NOT_CONFIGURED",
	"PERMISSION",
	"AUTH",
	"MODEL",
	"PARAMS",
	"TIMEOUT",
	"OLLAMA_ORIGIN",
]);

function ChatMessage({
	message,
	streaming,
	canRegenerate,
	onRegenerate,
	errorCode,
}: {
	message: UiChatMessage;
	streaming: boolean;
	canRegenerate: boolean;
	onRegenerate: () => void;
	errorCode?: string | null;
}) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="bg-muted max-w-[88%] rounded-xl rounded-br-[4px] px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">
					{message.content}
				</div>
			</div>
		);
	}
	const needsSetup = message.error
		? errorCode
			? SETUP_CODES.has(errorCode)
			: /settings|api key|model|permission|origin/i.test(message.error)
		: false;
	return (
		<div className="group flex gap-2">
			<div className="pt-0.5">
				<Logo size={20} />
			</div>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				{message.content ? (
					<div className={cn("text-xs", streaming && "ovq-caret")}>
						<Markdown
							content={message.content}
							fontSize={12.5}
							className="ovq-md"
						/>
					</div>
				) : streaming ? (
					<div
						className="flex h-5 items-center gap-1"
						role="status"
						aria-label="Thinking"
					>
						{[0, 1, 2].map((i) => (
							<span
								key={i}
								className="bg-muted-foreground size-1.5 animate-bounce rounded-full"
								style={{ animationDelay: `${i * 120}ms` }}
							/>
						))}
					</div>
				) : null}
				{message.error ? (
					<Notice
						tone="error"
						title="The coach couldn't answer"
						actions={
							<>
								{needsSetup ? (
									<Button
										size="xs"
										variant="outline"
										onClick={() => void ext.openOptions("ai")}
									>
										<Settings /> AI settings
									</Button>
								) : null}
								{canRegenerate ? (
									<Button size="xs" variant="ghost" onClick={onRegenerate}>
										<RefreshCw /> Try again
									</Button>
								) : null}
							</>
						}
					>
						{message.error}
					</Notice>
				) : null}
				{!streaming && message.content ? (
					<div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
						<CopyButton
							text={message.content}
							title="Copy answer"
							size={12}
							style={{ padding: 4, border: "none" }}
						/>
						{canRegenerate && !message.error ? (
							<IconButton
								label="Regenerate"
								icon={RefreshCw}
								size="icon-xs"
								onClick={onRegenerate}
							/>
						) : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
