/**
 * Client side of the "ai-chat" Port: a plain streaming helper and a React
 * hook. Works from extension pages and content scripts.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { newId } from "../settings";
import {
	AI_CHAT_PORT,
	type AiChatClientMessage,
	type AiChatServerMessage,
	type AiErrorCode,
	type ChatMessage,
	type CoachContext,
	type UiChatMessage,
} from "./types";

export class AiChatError extends Error {
	readonly code: AiErrorCode;
	constructor(message: string, code: AiErrorCode = "UNKNOWN") {
		super(message);
		this.name = "AiChatError";
		this.code = code;
	}
}

export type StreamHandle = {
	/** Resolves with the full text when done; rejects with AiChatError */
	done: Promise<string>;
	/** Stop streaming (the partial text is kept by the caller) */
	abort: () => void;
};

/**
 * Low-level: streams one assistant reply.
 *
 *   const { done, abort } = streamAiChat({ messages, context }, (delta, full) => render(full));
 */
export function streamAiChat(
	request: Omit<AiChatClientMessage, "type">,
	onDelta: (delta: string, full: string) => void,
): StreamHandle {
	let full = "";
	let settled = false;
	let port: ReturnType<typeof browser.runtime.connect> | null = null;
	let resolveFn: (text: string) => void = () => {};
	let rejectFn: (e: AiChatError) => void = () => {};
	const done = new Promise<string>((resolve, reject) => {
		resolveFn = resolve;
		rejectFn = reject;
	});
	const settle = (fn: () => void) => {
		if (settled) return;
		settled = true;
		fn();
	};
	try {
		port = browser.runtime.connect({ name: AI_CHAT_PORT });
		port.onMessage.addListener((raw: unknown) => {
			const msg = raw as AiChatServerMessage;
			if (msg.type === "delta") {
				full += msg.text;
				onDelta(msg.text, full);
			} else if (msg.type === "done") {
				settle(() => resolveFn(full));
			} else if (msg.type === "error") {
				settle(() => rejectFn(new AiChatError(msg.message, msg.code)));
			}
		});
		port.onDisconnect.addListener(() => {
			settle(() =>
				rejectFn(
					new AiChatError(
						"Lost connection to the extension. Reload the page and try again.",
						"NETWORK",
					),
				),
			);
		});
		port.postMessage({
			type: "start",
			...request,
		} satisfies AiChatClientMessage);
	} catch (error) {
		settle(() =>
			rejectFn(
				new AiChatError(
					error instanceof Error && /context invalidated/i.test(error.message)
						? "GrowTube was updated. Reload this page to keep using it."
						: String(error),
					"NETWORK",
				),
			),
		);
	}
	return {
		done,
		abort: () => {
			settle(() => resolveFn(full));
			try {
				port?.disconnect();
			} catch {
				// ignore
			}
		},
	};
}

export type AiChatStatus = "idle" | "streaming" | "error";

export type UseAiChatOptions = {
	/** Structured context for the coach system prompt (can change between sends) */
	context?: CoachContext | null;
	model?: string;
	temperature?: number;
	initialMessages?: UiChatMessage[];
	/** Called after each completed (or failed/stopped) reply with the full list */
	onFinish?: (messages: UiChatMessage[]) => void;
};

/**
 *   const chat = useAiChat({ context });
 *   chat.send("Analyze the hook");
 *   chat.messages // UiChatMessage[] (assistant message grows while streaming)
 *   chat.stop(); chat.reset();
 */
export function useAiChat(opts: UseAiChatOptions = {}) {
	const [messages, setMessagesState] = useState<UiChatMessage[]>(
		opts.initialMessages ?? [],
	);
	const [status, setStatus] = useState<AiChatStatus>("idle");
	const [error, setError] = useState<string | null>(null);
	const [errorCode, setErrorCode] = useState<AiErrorCode | null>(null);
	const messagesRef = useRef(messages);
	const handleRef = useRef<StreamHandle | null>(null);
	/**
	 * Context each user message was sent with (by message id), so retry()
	 * re-sends with the same video/transcript context, not the hook's default.
	 */
	const sentContexts = useRef(new Map<string, CoachContext | null>());
	const optsRef = useRef(opts);
	optsRef.current = opts;

	const setMessages = useCallback(
		(next: UiChatMessage[] | ((prev: UiChatMessage[]) => UiChatMessage[])) => {
			const resolved =
				typeof next === "function" ? next(messagesRef.current) : next;
			messagesRef.current = resolved;
			setMessagesState(resolved);
		},
		[],
	);

	useEffect(() => () => handleRef.current?.abort(), []);

	const send = useCallback(
		async (text: string, overrides: { context?: CoachContext | null } = {}) => {
			const content = text.trim();
			if (!content) return;
			handleRef.current?.abort();
			const user: UiChatMessage = {
				id: newId(),
				role: "user",
				content,
				createdAt: Date.now(),
			};
			const assistant: UiChatMessage = {
				id: newId(),
				role: "assistant",
				content: "",
				createdAt: Date.now(),
			};
			const history: ChatMessage[] = [...messagesRef.current, user]
				.filter((m) => !m.error && m.content.trim())
				.map((m) => ({ role: m.role, content: m.content }));
			setMessages((prev) => [...prev, user, assistant]);
			setStatus("streaming");
			setError(null);
			setErrorCode(null);

			const patchAssistant = (patch: Partial<UiChatMessage>) =>
				setMessages((prev) =>
					prev.map((m) => (m.id === assistant.id ? { ...m, ...patch } : m)),
				);

			const context =
				overrides.context !== undefined
					? overrides.context
					: (optsRef.current.context ?? null);
			sentContexts.current.set(user.id, context);
			const handle = streamAiChat(
				{
					messages: history,
					model: optsRef.current.model,
					temperature: optsRef.current.temperature,
					context: context ?? undefined,
				},
				(_delta, full) => patchAssistant({ content: full }),
			);
			handleRef.current = handle;
			try {
				const full = await handle.done;
				if (handleRef.current === handle) {
					patchAssistant({ content: full });
					setStatus("idle");
				}
			} catch (e) {
				const err = e instanceof AiChatError ? e : new AiChatError(String(e));
				if (handleRef.current === handle) {
					patchAssistant({ error: err.message });
					setError(err.message);
					setErrorCode(err.code);
					setStatus("error");
				}
			} finally {
				if (handleRef.current === handle) handleRef.current = null;
				optsRef.current.onFinish?.(messagesRef.current);
			}
		},
		[setMessages],
	);

	const stop = useCallback(() => {
		handleRef.current?.abort();
		handleRef.current = null;
		setStatus("idle");
	}, []);

	const reset = useCallback(() => {
		handleRef.current?.abort();
		handleRef.current = null;
		sentContexts.current.clear();
		setMessages([]);
		setStatus("idle");
		setError(null);
		setErrorCode(null);
	}, [setMessages]);

	/**
	 * Re-sends the last user message (e.g. after fixing settings) with the
	 * context it was originally sent with. Messages restored from storage
	 * fall back to the hook's current `context`.
	 */
	const retry = useCallback(() => {
		const lastUser = [...messagesRef.current]
			.reverse()
			.find((m) => m.role === "user");
		if (!lastUser) return;
		const idx = messagesRef.current.lastIndexOf(lastUser);
		const known = sentContexts.current.has(lastUser.id);
		const context = sentContexts.current.get(lastUser.id);
		sentContexts.current.delete(lastUser.id);
		setMessages(messagesRef.current.slice(0, idx));
		void send(lastUser.content, known ? { context: context ?? null } : {});
	}, [send, setMessages]);

	return {
		messages,
		send,
		stop,
		status,
		error,
		errorCode,
		reset,
		retry,
		setMessages,
	};
}
