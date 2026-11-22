/**
 * Streaming chat over a runtime Port named "ai-chat". BACKGROUND ONLY.
 *
 * Client -> { type: "start", messages, model?, temperature?, context? }
 * Server -> { type: "delta", text }* then { type: "done" } | { type: "error", message, code }
 * Disconnecting the port aborts the request.
 */
import type { Browser } from "wxt/browser";
import { browser } from "wxt/browser";

import { hasSession } from "../auth-session";
import { keepAliveWhile } from "../keepalive";
import { assertProviderReady, getProviderSettings } from "./client";
import { reasoningBudgetError, toAiError } from "./errors";
import { adaptiveChat, contentText } from "./params";
import { coachSystemPrompt } from "./prompts";
import {
	AI_CHAT_PORT,
	type AiChatClientMessage,
	type AiChatServerMessage,
	type ChatMessage,
} from "./types";

const MAX_HISTORY_CHARS = 60_000;

/** Keeps the newest messages within a rough character budget. */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
	const out: ChatMessage[] = [];
	let total = 0;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (!m || typeof m.content !== "string") continue;
		total += m.content.length;
		if (total > MAX_HISTORY_CHARS && out.length) break;
		out.unshift({ role: m.role, content: m.content });
	}
	return out;
}

async function handleStart(
	port: Browser.runtime.Port,
	msg: AiChatClientMessage,
	signal: AbortSignal,
	post: (m: AiChatServerMessage) => void,
) {
	const s = await getProviderSettings();
	const model = msg.model?.trim() || s.model;
	try {
		await assertProviderReady(s);
		const history = trimHistory(
			(msg.messages ?? []).filter(
				(m) =>
					m.role === "user" || m.role === "assistant" || m.role === "system",
			),
		);
		const extraSystem = history
			.filter((m) => m.role === "system")
			.map((m) => m.content);
		const system = [coachSystemPrompt(msg.context), ...extraSystem].join(
			"\n\n",
		);
		// Same adaptive parameters as one-shot calls (temperature dropped for
		// reasoning models, learned rejections applied). No output cap.
		const { response: stream } = await adaptiveChat(s, {
			model,
			temperature: msg.temperature,
			stream: true,
			signal,
			messages: [
				{ role: "system", content: system },
				...history.filter((m) => m.role !== "system"),
			],
		});
		let finishReason: string | null = null;
		let wroteText = false;
		for await (const chunk of stream) {
			const choice = chunk.choices?.[0];
			const text = contentText(choice?.delta?.content);
			if (text) {
				wroteText ||= !!text.trim();
				post({ type: "delta", text });
			}
			if (choice?.finish_reason) finishReason = choice.finish_reason;
		}
		if (!wroteText && finishReason === "length") {
			const e = reasoningBudgetError();
			post({ type: "error", message: e.message, code: e.code });
			return;
		}
		post({ type: "done", finishReason });
	} catch (error) {
		if (signal.aborted) return;
		const e = toAiError(error, { baseURL: s.baseURL, model });
		post({ type: "error", message: e.message, code: e.code });
	} finally {
		try {
			port.disconnect();
		} catch {
			// already gone
		}
	}
}

export function registerAiChatPort(): void {
	browser.runtime.onConnect.addListener((port) => {
		if (port.name !== AI_CHAT_PORT) return;
		const controller = new AbortController();
		let connected = true;
		let started = false;
		port.onDisconnect.addListener(() => {
			connected = false;
			controller.abort();
		});
		const post = (m: AiChatServerMessage) => {
			if (!connected) return;
			try {
				port.postMessage(m);
			} catch {
				connected = false;
				controller.abort();
			}
		};
		port.onMessage.addListener((raw: unknown) => {
			const msg = raw as AiChatClientMessage;
			if (msg?.type !== "start" || started) return;
			started = true;
			// Reasoning models can think for > 30 s before the first token.
			void keepAliveWhile(
				hasSession().then((signedIn) =>
					signedIn
						? handleStart(port, msg, controller.signal, post)
						: post({
								type: "error",
								message:
									"Sign in to GrowTube to use the AI coach (Settings → Account).",
								code: "AUTH_REQUIRED",
							}),
				),
			);
		});
	});
}
