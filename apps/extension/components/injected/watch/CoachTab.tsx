/**
 * AI Coach tab: preset prompts + free chat about the video in focus, streamed
 * from the user's own AI provider. No limits. Conversations are saved to the
 * side panel's history so they can be continued there.
 */
import { computeUploadsPerWeek } from "@open-vidiq/shared/metrics";
import {
	ArrowUp,
	PanelRight,
	RotateCcw,
	Settings,
	Sparkles,
	Square,
} from "lucide-react";
import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { Markdown } from "@/components/common/Markdown";
import {
	buildPresetPrompt,
	COACH_PRESETS,
	type CoachPresetId,
	presetLabel,
} from "@/lib/ai/coach";
import type { CoachContext, UiChatMessage } from "@/lib/ai/types";
import { useAiChat } from "@/lib/ai/use-ai-chat";
import { ai, ext, yt } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import {
	aiConversations,
	aiProvider,
	myChannel,
	newId,
	withConversation,
} from "@/lib/settings";
import { transcriptToText } from "@/lib/youtube/transcript";
import type { ChannelVideo, Transcript } from "@/lib/youtube/types";

import { errorMessage, useAsync } from "../common/async";
import { Note, Skeleton } from "../common/ui";
import { buildCoachContext, type CoachInputs } from "./coach-context";
import type { WatchData } from "./data";

async function saveConversation(
	id: string,
	title: string,
	messages: UiChatMessage[],
	context: CoachContext | null,
): Promise<void> {
	if (!messages.some((m) => m.role === "assistant" && m.content.trim())) return;
	const list = await aiConversations.getValue();
	const now = Date.now();
	const existing = list.find((c) => c.id === id);
	const entry = {
		id,
		title,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		messages,
		context,
	};
	await aiConversations.setValue(withConversation(list, entry));
}

export function CoachTab({
	w,
	tagRanks,
}: {
	w: WatchData;
	tagRanks: Record<string, number | null> | null;
}) {
	const d = w.details.data;
	const status = useAsync(() => ai.status(), []);
	const reloadStatus = status.reload;
	// Re-check when the provider is configured in the options page.
	useEffect(() => aiProvider.watch(() => reloadStatus()), [reloadStatus]);

	const [mine] = useStorageItem(myChannel);
	const extras = useRef<{
		transcript?: Promise<Transcript | null>;
		recent?: Promise<ChannelVideo[]>;
	}>({});
	const conversationId = useRef(newId());
	const labels = useRef(new Map<string, string>());
	const lastContext = useRef<CoachContext | null>(null);
	const titleRef = useRef("");

	const chat = useAiChat({
		onFinish: (messages) => {
			void saveConversation(
				conversationId.current,
				titleRef.current || d?.title || "AI Coach",
				messages,
				lastContext.current,
			).catch(() => {});
		},
	});
	const [draft, setDraft] = useState("");
	const [preparing, setPreparing] = useState(false);
	const [uiError, setUiError] = useState<string | null>(null);
	const busy = chat.status === "streaming" || preparing;

	const listRef = useRef<HTMLDivElement>(null);
	const stickToBottom = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scroll on every message update
	useLayoutEffect(() => {
		const el = listRef.current;
		if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
	}, [chat.messages]);

	const baseInputs = useCallback(
		(): CoachInputs | null =>
			d
				? {
						details: d,
						metrics: w.metrics,
						channel: w.channel.data ?? null,
						tagRanks,
						myChannel: mine,
					}
				: null,
		[d, w.metrics, w.channel.data, tagRanks, mine],
	);

	const ask = async (text: string, preset?: CoachPresetId) => {
		const base = baseInputs();
		if (!base || busy) return;
		setUiError(null);
		setPreparing(true);
		try {
			const videoId = base.details.videoId;
			const channelId = base.details.channelId;
			// A failed lookup is forgotten so the next question tries again.
			extras.current.transcript ??= yt.getTranscript(videoId).catch(() => {
				extras.current.transcript = undefined;
				return null;
			});
			extras.current.recent ??= channelId
				? yt
						.getChannelVideos(channelId, {
							tab: base.details.isShort ? "shorts" : "videos",
							limit: 15,
						})
						.catch(() => [])
				: Promise.resolve([]);
			const [transcript, recent] = await Promise.all([
				extras.current.transcript,
				extras.current.recent,
			]);
			const excerpt = transcript
				? transcriptToText(
						transcript.segments,
						preset === "hook" ? { toSec: 60 } : { maxChars: 9_000 },
					)
				: null;
			const ctx = buildCoachContext({
				...base,
				recentVideos: recent,
				transcriptExcerpt: excerpt,
				uploadsPerWeek: computeUploadsPerWeek(
					recent.map((v) => v.publishedAt).filter((p): p is string => !!p),
				),
			});
			lastContext.current = ctx;
			const prompt = preset ? buildPresetPrompt(preset, ctx) : text.trim();
			if (!prompt) return;
			const shown = preset ? presetLabel(preset, ctx) : prompt;
			if (preset) labels.current.set(prompt, shown);
			if (!titleRef.current) {
				titleRef.current = `${base.details.title.slice(0, 60)}: ${shown.slice(0, 60)}`;
			}
			stickToBottom.current = true;
			void chat.send(prompt, { context: ctx });
		} catch (e) {
			setUiError(errorMessage(e));
		} finally {
			setPreparing(false);
		}
	};

	const submit = () => {
		const text = draft.trim();
		if (!text || busy) return;
		setDraft("");
		void ask(text);
	};

	const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
			e.preventDefault();
			submit();
		}
	};

	const newChat = () => {
		chat.reset();
		conversationId.current = newId();
		titleRef.current = "";
		labels.current.clear();
		setUiError(null);
	};

	const openInSidePanel = () => {
		setUiError(null);
		const base = baseInputs();
		const coach =
			lastContext.current ?? (base ? buildCoachContext(base) : undefined);
		// No await before this call: the side panel needs the click's user gesture.
		ext
			.openSidePanel({
				videoId: d?.videoId,
				channelId: d?.channelId || undefined,
				tool: "coach",
				coach,
				prefill: draft.trim() || undefined,
			})
			.catch((e: unknown) => setUiError(errorMessage(e)));
	};

	if (status.loading && !status.data) {
		return (
			<div style={{ display: "grid", gap: 8 }}>
				<Skeleton height={28} />
				<Skeleton height={28} width="80%" />
				<Skeleton height={44} />
			</div>
		);
	}

	const notReady = status.data && !status.data.ready;
	if (notReady || status.error) {
		return (
			<div className="ovq-cta">
				<div
					style={{
						display: "flex",
						gap: 8,
						alignItems: "center",
						fontWeight: 600,
					}}
				>
					<Sparkles
						size={16}
						aria-hidden="true"
						style={{ color: "var(--ovq-accent)" }}
					/>
					Connect your AI to use the Coach
				</div>
				<div className="ovq-small ovq-muted">
					{status.data?.problem ??
						(status.error ? errorMessage(status.error) : null) ??
						"Add an AI provider in Settings."}{" "}
					Use your own key (OpenAI, OpenRouter, Groq, Gemini…) or a free local
					model with Ollama or LM Studio. No limits.
				</div>
				<div style={{ display: "flex", gap: 8 }}>
					<button
						type="button"
						className="ovq-btn primary small"
						onClick={() => void ext.openOptions("ai")}
					>
						<Settings size={13} aria-hidden="true" /> Open AI settings
					</button>
					<button
						type="button"
						className="ovq-btn small"
						onClick={reloadStatus}
					>
						Check again
					</button>
				</div>
			</div>
		);
	}

	const needsSettings =
		chat.errorCode === "NOT_CONFIGURED" || chat.errorCode === "PERMISSION";

	return (
		<div className="ovq-coach">
			<div className="ovq-prompts">
				{COACH_PRESETS.map((p) => (
					<button
						key={p.id}
						type="button"
						className="ovq-prompt"
						disabled={!d || busy}
						onClick={() => void ask("", p.id)}
					>
						{presetLabel(
							p.id,
							lastContext.current ?? {
								stats: { outlierScore: w.metrics?.outlierScore },
							},
						)}
					</button>
				))}
			</div>

			{chat.messages.length > 0 && (
				<div
					ref={listRef}
					className="ovq-messages"
					aria-live="polite"
					onScroll={(e) => {
						const el = e.currentTarget;
						stickToBottom.current =
							el.scrollHeight - el.scrollTop - el.clientHeight < 40;
					}}
				>
					{chat.messages.map((m) =>
						m.role === "user" ? (
							<div key={m.id} className="ovq-msg user">
								{labels.current.get(m.content) ?? m.content}
							</div>
						) : (
							<div key={m.id} className="ovq-msg assistant">
								{m.content ? (
									<Markdown content={m.content} fontSize={13} />
								) : m.error ? null : (
									<span
										className="ovq-typing"
										role="status"
										aria-label="Thinking"
									>
										<span />
										<span />
										<span />
									</span>
								)}
								{m.error && (
									<div
										className="ovq-small"
										style={{ color: "var(--ovq-danger)" }}
									>
										{m.error}
									</div>
								)}
							</div>
						),
					)}
				</div>
			)}

			{chat.status === "error" && chat.error && (
				<Note tone="error">
					{chat.error}{" "}
					<button type="button" className="ovq-link-btn" onClick={chat.retry}>
						Retry
					</button>
					{needsSettings && (
						<>
							{" · "}
							<button
								type="button"
								className="ovq-link-btn"
								onClick={() => void ext.openOptions("ai")}
							>
								Open AI settings
							</button>
						</>
					)}
				</Note>
			)}
			{uiError && <Note tone="error">{uiError}</Note>}

			<div className="ovq-composer">
				<label htmlFor="ovq-coach-input" className="ovq-sr-only">
					Ask the AI Coach
				</label>
				<textarea
					id="ovq-coach-input"
					rows={1}
					value={draft}
					placeholder={
						chat.messages.length
							? "Ask a follow-up…"
							: "Ask anything about this video or your channel…"
					}
					onChange={(e) => {
						setDraft(e.target.value);
						const el = e.target;
						el.style.height = "auto";
						el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
					}}
					onKeyDown={onKeyDown}
				/>
				{busy ? (
					<button
						type="button"
						className="ovq-icon-btn ovq-send"
						onClick={chat.stop}
						disabled={preparing && chat.status !== "streaming"}
						aria-label="Stop"
						title="Stop"
					>
						<Square size={13} fill="currentColor" aria-hidden="true" />
					</button>
				) : (
					<button
						type="button"
						className="ovq-icon-btn ovq-send"
						onClick={submit}
						disabled={!draft.trim() || !d}
						aria-label="Send"
						title="Send (Enter)"
					>
						<ArrowUp size={16} aria-hidden="true" />
					</button>
				)}
			</div>

			<div className="ovq-coach-footer">
				<button
					type="button"
					className="ovq-btn small ghost"
					onClick={newChat}
					disabled={!chat.messages.length || busy}
				>
					<RotateCcw size={13} aria-hidden="true" /> New chat
				</button>
				<button
					type="button"
					className="ovq-btn small"
					onClick={openInSidePanel}
				>
					<PanelRight size={13} aria-hidden="true" /> Open in side panel
				</button>
			</div>
			{status.data && (
				<div className="ovq-small ovq-muted">
					{status.data.providerLabel} · {status.data.model}
				</div>
			)}
		</div>
	);
}
