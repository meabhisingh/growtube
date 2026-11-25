/**
 * "Preview on YouTube": shows the user's card in the real home grid or
 * search results of the active YouTube tab (through the background, see
 * `tab.feedPreview`). The image is downscaled to a 1280x720 JPEG here; it
 * only travels to that tab's content script, never to a server.
 */
import { Button } from "@growtube/ui/components/button";
import { ExternalLink, MonitorPlay, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";

import { ext } from "@/lib/client";
import type { FeedPreviewCard, FeedPreviewStatus } from "@/lib/feed-preview";
import { detectPageType } from "@/lib/youtube/page-type";

import { ErrorNotice, Notice } from "../../../ui/feedback";
import { usePanel } from "../../nav";
import { toPreviewJpeg } from "./image-utils";

const HOME_URL = "https://www.youtube.com/";
const searchUrl = (q: string) =>
	`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;

/** Resolves when the tab finished loading (or after `timeoutMs`). */
function waitForTabLoad(tabId: number, timeoutMs = 20_000): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			browser.tabs.onUpdated.removeListener(onUpdated);
			resolve();
		};
		const onUpdated = (id: number, change: { status?: string }) => {
			if (id === tabId && change.status === "complete") done();
		};
		const timer = setTimeout(done, timeoutMs);
		browser.tabs.onUpdated.addListener(onUpdated);
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function LivePreview({
	image,
	card,
	title,
}: {
	image: string | null;
	/** Everything but the image */
	card: Omit<FeedPreviewCard, "image">;
	title: string;
}) {
	const { activeTab } = usePanel();
	const pageType =
		activeTab.isYouTube && activeTab.url ? detectPageType(activeTab.url) : null;
	const supported = pageType === "home" || pageType === "search";
	const [busy, setBusy] = useState(false);
	const [status, setStatus] = useState<{
		status: FeedPreviewStatus;
		tabId: number;
		url: string | null;
	} | null>(null);
	const [error, setError] = useState<unknown>(null);
	const seq = useRef(0);

	// A shown status is stale once the tab navigates (the card is gone).
	useEffect(() => {
		if (
			status?.status === "shown" &&
			(status.tabId !== activeTab.tabId || status.url !== activeTab.url)
		)
			setStatus(null);
	}, [activeTab.tabId, activeTab.url, status]);

	const send = async (navigateTo?: string) => {
		const tabId = activeTab.tabId;
		if (tabId == null || !image) return;
		const id = ++seq.current;
		setBusy(true);
		setError(null);
		setStatus(null);
		try {
			const full: FeedPreviewCard = {
				...card,
				image: await toPreviewJpeg(image),
			};
			if (navigateTo) {
				const loaded = waitForTabLoad(tabId);
				await browser.tabs.update(tabId, { url: navigateTo });
				await loaded;
			}
			// After a fresh load the content script may need a moment.
			let res = await ext.feedPreview(tabId, full);
			for (
				let attempt = 0;
				navigateTo && attempt < 12 && res.status === "no-content-script";
				attempt++
			) {
				await sleep(700);
				if (id !== seq.current) return;
				res = await ext.feedPreview(tabId, full);
			}
			if (id !== seq.current) return;
			const tab = await browser.tabs.get(tabId).catch(() => null);
			setStatus({ status: res.status, tabId, url: tab?.url ?? null });
		} catch (e) {
			if (id === seq.current) setError(e);
		} finally {
			if (id === seq.current) setBusy(false);
		}
	};

	const remove = async () => {
		const tabId = status?.tabId ?? activeTab.tabId;
		seq.current++;
		setBusy(false);
		setStatus(null);
		if (tabId == null) return;
		try {
			await ext.feedPreview(tabId, null);
		} catch (e) {
			setError(e);
		}
	};

	const offers =
		activeTab.tabId != null ? (
			<>
				<Button
					size="xs"
					variant="outline"
					disabled={busy || !image}
					onClick={() => void send(HOME_URL)}
				>
					<ExternalLink /> Open YouTube home here
				</Button>
				{title.trim() ? (
					<Button
						size="xs"
						variant="outline"
						disabled={busy || !image}
						onClick={() => void send(searchUrl(title.trim()))}
					>
						<Search /> Search my title here
					</Button>
				) : null}
			</>
		) : null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center gap-1.5">
				<Button
					size="sm"
					disabled={!image || !supported || busy || activeTab.tabId == null}
					onClick={() => void send()}
				>
					<MonitorPlay /> {busy ? "Placing…" : "Preview on YouTube"}
				</Button>
				{status?.status === "shown" ? (
					<Button size="sm" variant="ghost" onClick={() => void remove()}>
						<X /> Remove preview
					</Button>
				) : null}
			</div>
			{!image ? (
				<p className="text-muted-foreground text-[11px]">
					Add your thumbnail to place it in the real feed of this tab.
				</p>
			) : !supported && !busy ? (
				<Notice
					title="Open YouTube's home page or search results"
					actions={offers}
				>
					Your card goes into the real feed of the active tab, in 3rd place.
					Only you see it, and it's gone when you navigate.
				</Notice>
			) : null}
			{status?.status === "shown" ? (
				<Notice tone="success" title="Your card is in the feed">
					It sits in 3rd place in this tab, marked "GrowTube preview". It
					disappears when you navigate or press Remove (also on the page).
				</Notice>
			) : status?.status === "no-grid" ? (
				<Notice tone="warning" title="No video grid found">
					Wait until videos are visible on the page (scroll a little), then try
					again.
				</Notice>
			) : status?.status === "no-content-script" ? (
				<Notice tone="warning" title="GrowTube isn't running in this tab">
					Reload the YouTube tab (it was opened before GrowTube was installed or
					updated), then try again.
				</Notice>
			) : status?.status === "unsupported-page" ||
				status?.status === "not-youtube" ? (
				<Notice
					tone="warning"
					title="Not a home or search page"
					actions={offers}
				>
					The live preview works on YouTube's home page and search results.
				</Notice>
			) : null}
			{error ? <ErrorNotice error={error} /> : null}
		</div>
	);
}
