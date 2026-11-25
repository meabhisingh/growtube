/**
 * Background implementations of every message in lib/messaging.ts.
 * BACKGROUND ONLY (imported by entrypoints/background.ts).
 *
 * GrowTube needs an account: every message except the `auth.*` ones,
 * `api.health` and the extension plumbing (`PUBLIC_TYPES`) fails with
 * `AUTH_REQUIRED` while signed out, so nothing reaches YouTube, the server
 * or the AI provider. `auth.*` messages are only accepted from extension
 * pages, never from content scripts.
 */
import { browser } from "wxt/browser";
import { z } from "zod";

import { assertProviderReady, getProviderSettings } from "./ai/client";
import {
	aiComplete,
	generateImage,
	listModels,
	testProvider,
} from "./ai/complete";
import { AiError } from "./ai/errors";
import { runGenerator } from "./ai/generate";
import { isGeneratorKind } from "./ai/prompts";
import { getProviderPreset } from "./ai/providers";
import * as api from "./api";
import {
	AuthError,
	assertSignedIn,
	deleteAccount,
	refreshSession,
	signIn,
	signOut,
	signUp,
} from "./auth-session";
import { cacheClear } from "./cache";
import { runCompetitorAlerts } from "./competitor-alerts";
import { type CurrentContext, currentContext } from "./context";
import { createLimiter } from "./limiter";
import type {
	AiStatus,
	HandlerContext,
	Handlers,
	MessageType,
} from "./messaging";
import { hasOriginPermission, originOf } from "./permissions";
import { checkRankTracks } from "./rank-tracker";
import * as youtube from "./youtube";
import type { VideoDetails } from "./youtube/types";
import {
	isPublicVideo,
	playerMarksRestricted,
	withPageRestrictions,
} from "./youtube/visibility";

const CLIENT_VERSION_RE = /^\d+\.\d{8}\.\d{2}\.\d{2}$/;

/** Fire-and-forget crowdsourcing; never fails the caller. */
function ingest(fn: () => Promise<unknown>) {
	void fn().catch((error) =>
		console.debug("[GrowTube] ingest skipped:", error),
	);
}

const rankLimit = createLimiter(2);

/** Remembers non-public videos so nothing about them reaches the server. */
function noteVisibility(d: VideoDetails | null | undefined) {
	if (d && !isPublicVideo(d)) api.markVideoRestricted(d.videoId);
}

/** Messages that work while signed out (no YouTube / server / AI work). */
const PUBLIC_TYPES: ReadonlySet<MessageType> = new Set<MessageType>([
	"auth.signIn",
	"auth.signUp",
	"auth.signOut",
	"auth.refresh",
	"auth.deleteAccount",
	"api.health",
	"yt.setConfig",
	"sidepanel.open",
	"context.set",
	"context.get",
	"options.open",
	"cache.clear",
	"tab.self",
]);

/** Only our own extension pages (popup, side panel, options) may manage the account. */
function assertExtensionPage(ctx: HandlerContext) {
	const runtime = browser.runtime as unknown as {
		id: string;
		getURL(path: string): string;
	};
	const own = runtime.getURL("/");
	const url = ctx.sender.url ?? "";
	if (ctx.sender.id !== runtime.id || !url.startsWith(own))
		throw new AuthError(
			"FORBIDDEN",
			"Sign in from the GrowTube popup, side panel or settings page.",
		);
}

async function openOptions(hash?: string) {
	if (hash) {
		// PublicPath only lists entrypoints that exist at prepare time.
		const runtime = browser.runtime as unknown as {
			getURL(path: string): string;
		};
		await browser.tabs.create({
			url: runtime.getURL(`/options.html#${hash.replace(/^#/, "")}`),
		});
	} else {
		await browser.runtime.openOptionsPage();
	}
}

async function aiStatus(): Promise<AiStatus> {
	const s = await getProviderSettings();
	const preset = getProviderPreset(s.presetId);
	const hasPermission = s.baseURL
		? await hasOriginPermission(s.baseURL)
		: false;
	let problem: string | null = null;
	try {
		await assertProviderReady(s);
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
	}
	const configured =
		/^https?:\/\//.test(s.baseURL) &&
		Boolean(s.model.trim()) &&
		(!preset.requiresKey || Boolean(s.apiKey.trim()));
	return {
		configured,
		hasPermission,
		ready: problem == null,
		presetId: s.presetId,
		providerLabel: preset.label,
		baseURL: s.baseURL,
		origin: originOf(s.baseURL),
		model: s.model,
		imageModel: s.imageModel,
		reasoningEffort: s.reasoningEffort,
		problem,
	};
}

const raw: Handlers = {
	// ---- Account ----
	"auth.signIn": ({ email, password }, ctx) => {
		assertExtensionPage(ctx);
		return signIn({ email, password });
	},
	"auth.signUp": ({ name, email, password }, ctx) => {
		assertExtensionPage(ctx);
		return signUp({ name, email, password });
	},
	"auth.signOut": async (_payload, ctx) => {
		assertExtensionPage(ctx);
		await signOut();
		return { ok: true as const };
	},
	"auth.refresh": (_payload, ctx) => {
		assertExtensionPage(ctx);
		return refreshSession();
	},
	"auth.deleteAccount": ({ password }, ctx) => {
		assertExtensionPage(ctx);
		return deleteAccount({ password });
	},

	// ---- YouTube ----
	"yt.getVideoDetails": async ({
		videoId,
		level,
		seed,
		force,
		crowdsource,
	}) => {
		const fetched = await youtube.getVideoDetails(videoId, {
			level,
			seed,
			force,
		});
		// The page's own data (e.g. the uploader viewing it) can mark a video
		// unlisted or private even when a cached anonymous lookup didn't.
		const pagePlayer = seed?.player;
		const d =
			pagePlayer?.videoId === videoId && playerMarksRestricted(pagePlayer)
				? withPageRestrictions(fetched, pagePlayer)
				: fetched;
		noteVisibility(d);
		if (crowdsource === false) return d;
		ingest(async () => {
			const snap = api.snapshotFromVideo(d);
			if (snap) await api.ingestVideos([snap]);
		});
		return d;
	},
	"yt.getVideoDetailsBatch": async ({ videoIds, level, crowdsource }) => {
		const res = await youtube.getVideoDetailsBatch(videoIds.slice(0, 200), {
			level,
		});
		for (const d of Object.values(res)) noteVisibility(d);
		if (crowdsource === false) return res;
		ingest(() =>
			api.ingestVideos(
				Object.values(res)
					.map((d) => (d ? api.snapshotFromVideo(d) : null))
					.filter((s): s is NonNullable<typeof s> => s != null),
			),
		);
		return res;
	},
	"yt.getChannel": async ({ ref, force, crowdsource }) => {
		const c = await youtube.getChannel(ref, { force });
		if (crowdsource !== false)
			ingest(() => api.ingestChannels([api.snapshotFromChannel(c)]));
		return c;
	},
	"yt.resolveHandle": ({ handle }) => youtube.resolveHandle(handle),
	"yt.getChannelVideos": ({ channelId, tab, limit }) =>
		youtube.getChannelVideos(channelId, { tab, limit }),
	"yt.getChannelVideosPage": ({ channelId, tab, continuation }) =>
		youtube.getChannelVideosPage(channelId, { tab, continuation }),
	"yt.getChannelBaseline": ({ channelId, format, force }) =>
		youtube.getChannelBaseline(channelId, format ?? "long", { force }),
	"yt.search": async ({ query, limit, type, sort, force, crowdsource }) => {
		const r = await youtube.search(query, { limit, type, sort, force });
		if (crowdsource === false) return r;
		ingest(() =>
			api.ingestVideos(
				r.results
					.map(api.snapshotFromSearchResult)
					.filter((s): s is NonNullable<typeof s> => s != null),
			),
		);
		return r;
	},
	"yt.findVideoRank": ({ query, videoId, depth }) =>
		youtube.findVideoRank(query, videoId, depth),
	"yt.findVideoRanks": async ({ videoId, queries, depth }) => {
		const unique = [
			...new Set(queries.map((q) => q.trim()).filter(Boolean)),
		].slice(0, 40);
		const ranks = await Promise.all(
			unique.map((q) =>
				rankLimit(() =>
					youtube.findVideoRank(q, videoId, depth).catch(() => null),
				),
			),
		);
		return Object.fromEntries(unique.map((q, i) => [q, ranks[i] ?? null]));
	},
	"yt.getSearchSuggestions": ({ query, hl, gl }) =>
		youtube.getSearchSuggestions(query, { hl, gl }),
	"yt.getTranscript": ({ videoId, lang, extraTracks }) =>
		youtube.getTranscript(videoId, { lang, extraTracks }),
	"yt.setConfig": ({ clientName, clientVersion, apiKey, gl }) => {
		youtube.setInnertubeConfig({
			clientName: clientName === "WEB" ? "WEB" : undefined,
			clientVersion:
				clientVersion && CLIENT_VERSION_RE.test(clientVersion)
					? clientVersion
					: undefined,
			apiKey: apiKey && /^[\w-]{20,60}$/.test(apiKey) ? apiKey : undefined,
			gl: gl && /^[A-Za-z]{2}$/.test(gl) ? gl.toUpperCase() : undefined,
			source: "page",
		});
		return { ok: true as const };
	},

	// ---- Server ----
	"api.health": () => api.health(),
	"api.ingestVideos": ({ videos }) => api.ingestVideos(videos),
	"api.ingestChannels": ({ channels }) => api.ingestChannels(channels),
	"api.getVideoHistory": ({ videoId, range, force }) =>
		api.getVideoHistory(videoId, range ?? "24h", { force }),
	"api.getChannelHistory": ({ channelId, force }) =>
		api.getChannelHistory(channelId, { force }),
	"api.getTrending": ({ force, ...query }) => api.getTrending(query, { force }),
	"api.getVideosStats": ({ videoIds }) => api.getVideosStats(videoIds),

	// ---- AI ----
	"ai.status": () => aiStatus(),
	"ai.complete": async ({ messages, json, ...opts }) => {
		const { model, temperature, maxTokens, reasoningEffort } = opts;
		const common = { model, temperature, maxTokens, reasoningEffort };
		if (json) {
			const data = await aiComplete(messages, {
				...common,
				json: z.unknown(),
			});
			return { text: JSON.stringify(data), json: data };
		}
		return { text: await aiComplete(messages, common) };
	},
	"ai.generate": ({ kind, input, model, temperature }) => {
		if (!isGeneratorKind(kind))
			throw new AiError("UNKNOWN", `Unknown generator "${kind}"`);
		return runGenerator(kind, input as never, { model, temperature });
	},
	"ai.listModels": async ({ baseURL, apiKey, presetId }) => {
		const override: Record<string, string> = {};
		if (baseURL) override.baseURL = baseURL;
		if (apiKey !== undefined) override.apiKey = apiKey;
		if (presetId) override.presetId = presetId;
		return listModels(override);
	},
	"ai.test": () => testProvider(),
	"ai.generateImage": ({ prompt, size, quality, model, n }) =>
		generateImage(prompt, { size, quality, model, n }),

	// ---- Background jobs ----
	"alerts.checkNow": () => runCompetitorAlerts({ manual: true }),
	"ranks.check": ({ ids }) =>
		checkRankTracks(Array.isArray(ids) ? ids.slice(0, 100) : "all"),

	// ---- Extension ----
	"sidepanel.open": async ({ context }, ctx) => {
		let tabId = ctx.tabId;
		let windowId = ctx.sender.tab?.windowId ?? null;
		// Call open() before any other await so the user gesture is still valid.
		const opening =
			tabId != null
				? browser.sidePanel.open({ tabId })
				: browser.tabs
						.query({ active: true, lastFocusedWindow: true })
						.then(([tab]) => {
							tabId = tab?.id ?? null;
							windowId = tab?.windowId ?? null;
							if (tabId != null) return browser.sidePanel.open({ tabId });
							if (windowId != null) return browser.sidePanel.open({ windowId });
							throw new Error("No active tab to open the side panel in");
						});
		if (context !== undefined) {
			await currentContext.setValue(
				context
					? {
							...context,
							tabId: context.tabId ?? tabId ?? undefined,
							at: Date.now(),
						}
					: null,
			);
		}
		await opening;
		return { ok: true as const };
	},
	"context.set": async ({ context }, ctx) => {
		const value: CurrentContext | null = context
			? {
					...context,
					tabId: context.tabId ?? ctx.tabId ?? undefined,
					at: Date.now(),
				}
			: null;
		await currentContext.setValue(value);
		return value;
	},
	"context.get": () => currentContext.getValue(),
	"options.open": async ({ hash }) => {
		await openOptions(hash);
		return { ok: true as const };
	},
	"cache.clear": async ({ prefix }) => ({ removed: await cacheClear(prefix) }),
	"tab.self": (_payload, ctx) => ({
		tabId: ctx.tabId,
		windowId: ctx.sender.tab?.windowId ?? null,
	}),
};

type AnyHandler = (payload: unknown, ctx: HandlerContext) => unknown;

/**
 * Every handler, gated: signed out, everything but `PUBLIC_TYPES` throws
 * AUTH_REQUIRED before doing any work. Public handlers are called as-is
 * (synchronously), so `sidepanel.open` keeps the sender's user gesture.
 */
export const handlers: Handlers = Object.fromEntries(
	(Object.entries(raw) as [MessageType, AnyHandler][]).map(([type, fn]) => [
		type,
		PUBLIC_TYPES.has(type)
			? fn
			: async (payload: unknown, ctx: HandlerContext) => {
					await assertSignedIn();
					return fn(payload, ctx);
				},
	]),
) as unknown as Handlers;
