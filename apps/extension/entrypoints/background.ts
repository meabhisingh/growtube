/**
 * Background service worker: the single place that talks to YouTube
 * (InnerTube), the open-vidiq server and the user's AI provider.
 * Content scripts and pages reach it via lib/messaging.ts and the
 * "ai-chat" Port. Nothing works while signed out (see lib/auth-session.ts).
 */
import { browser, defineBackground } from "#imports";

import { registerAiChatPort } from "@/lib/ai/chat";
import {
	dropIngestQueue,
	flushIngestQueue,
	INGEST_ALARM,
	resetIngestBackoff,
} from "@/lib/api";
import { ACCOUNT_SECTION, authUser } from "@/lib/auth";
import {
	AUTH_REFRESH_ALARM,
	AUTH_REFRESH_MINUTES,
	onServerUrlChanged,
	refreshSession,
	refreshSessionIfStale,
} from "@/lib/auth-session";
import { handlers } from "@/lib/background-handlers";
import { cacheClear } from "@/lib/cache";
import { registerBackgroundRouter } from "@/lib/messaging";
import { onboardingDone, serverUrl } from "@/lib/settings";

function ensureAlarm(name: string, periodInMinutes: number) {
	void browser.alarms.get(name).then((alarm) => {
		if (!alarm || alarm.periodInMinutes !== periodInMinutes)
			void browser.alarms.create(name, { periodInMinutes });
	});
}

export default defineBackground(() => {
	registerBackgroundRouter(handlers);
	registerAiChatPort();

	// The toolbar action opens the popup; the side panel is opened explicitly
	// (popup button, watch panel…).
	void browser.sidePanel
		?.setPanelBehavior?.({ openPanelOnActionClick: false })
		.catch(() => {});

	// Crowdsourced stats: debounced in memory, with an alarm as a safety net
	// for batches left behind when the service worker was suspended.
	ensureAlarm(INGEST_ALARM, 1);
	// The session is checked when the browser starts and about every 12 h.
	ensureAlarm(AUTH_REFRESH_ALARM, AUTH_REFRESH_MINUTES);
	browser.alarms.onAlarm.addListener((alarm) => {
		if (alarm.name === INGEST_ALARM) void flushIngestQueue();
		if (alarm.name === AUTH_REFRESH_ALARM)
			void refreshSession().catch(() => null);
	});
	void refreshSessionIfStale().finally(() => void flushIngestQueue());

	// Sign-in resumes lookups and ingestion; sign-out drops the queue and
	// the cached server answers.
	authUser.watch((user, previous) => {
		if (user && !previous) void resetIngestBackoff();
		if (!user && previous) {
			void dropIngestQueue();
			void cacheClear("srv:").catch(() => 0);
		}
	});
	// A new server URL ends the session (it belonged to the old server). A
	// freshly granted host permission: retry ingestion right away.
	serverUrl.watch((next) => {
		void onServerUrlChanged(next).finally(() => void resetIngestBackoff());
	});
	browser.permissions.onAdded.addListener(() => void resetIngestBackoff());

	// First install: the options page opens on the Account section (an
	// account is required before anything works).
	browser.runtime.onInstalled.addListener(async ({ reason }) => {
		if (reason !== "install") return;
		if (await onboardingDone.getValue()) return;
		try {
			const runtime = browser.runtime as unknown as {
				getURL(path: string): string;
			};
			await browser.tabs.create({
				url: runtime.getURL(`/options.html#${ACCOUNT_SECTION}`),
			});
		} catch (error) {
			console.warn("[open-vidiq] could not open the options page", error);
		}
	});
});
