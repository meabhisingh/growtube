/** Options page sections: My channel, features, appearance, data, about. */
import { Button } from "@open-vidiq/ui/components/button";
import {
	Crown,
	Database,
	Download,
	Heart,
	Info,
	Monitor,
	Moon,
	Palette,
	PanelRightOpen,
	RotateCcw,
	SlidersHorizontal,
	Sun,
	Trash2,
	UserRound,
	X,
} from "lucide-react";
import { useState } from "react";
import { browser } from "wxt/browser";
import { storage } from "#imports";

import { injectedPrefs } from "@/components/injected/common/prefs";
import { studioKeywords, studioPanelPrefs } from "@/components/studio/prefs";
import { account, ext } from "@/lib/client";
import { currentContext } from "@/lib/context";
import { useBackground, useStorageItem } from "@/lib/hooks";
import {
	aiModelCaps,
	competitors,
	features,
	myChannel,
	SETTINGS_ITEMS,
	shortsDefaultSpeed,
} from "@/lib/settings";
import { openSidePanelFromPage } from "@/lib/sidepanel";
import { deleteStoredToken } from "@/lib/token-store";

import { channelSummary, resolveChannelInput, toMyChannel } from "../data";
import { FEATURE_INFO } from "../features";
import { useAsyncTask } from "../hooks";
import { PAGE_ITEMS } from "../storage";
import { type UiTheme, uiTheme } from "../theme";
import {
	Field,
	NativeSelect,
	SearchForm,
	Segmented,
	SwitchRow,
} from "../ui/controls";
import { ErrorNotice, Notice } from "../ui/feedback";
import { Section } from "../ui/layout";
import { toast } from "../ui/toast";
import { Avatar } from "../ui/video";

// ---------------------------------------------------------------------------

export function ChannelSection() {
	const [mine, setMine] = useStorageItem(myChannel);
	const [list] = useStorageItem(competitors);
	const [input, setInput] = useState("");
	const info = useBackground(
		"yt.getChannel",
		mine ? { ref: { channelId: mine.channelId } } : null,
		[mine?.channelId],
	);
	const save = useAsyncTask(async (value: string) => {
		const channel = await resolveChannelInput(value);
		await setMine(toMyChannel(channel));
		setInput("");
		toast(`My channel: ${channel.title}`, { tone: "success" });
		return channel;
	});

	return (
		<Section
			id="channel"
			title="My channel"
			icon={Crown}
			description="Used for Daily Ideas, Channel Audit, and to give the AI coach context about you. Public data only: no Google sign-in."
		>
			{mine ? (
				<div className="bg-surface-2 flex items-center gap-3 p-2.5">
					<Avatar src={info.data?.avatarUrl} size={40} />
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="truncate text-xs font-medium">{mine.title}</span>
						<span className="text-muted-foreground truncate text-[11px]">
							{info.data
								? channelSummary(info.data)
								: (mine.handle ?? mine.channelId)}
						</span>
					</div>
					<Button size="xs" variant="ghost" onClick={() => void setMine(null)}>
						<X /> Clear
					</Button>
				</div>
			) : null}
			<SearchForm
				value={input}
				onChange={setInput}
				onSubmit={(v) => void save.run(v)}
				placeholder="Channel URL, @handle, channel id or a video link"
				inputLabel="My channel"
				buttonLabel={mine ? "Change" : "Save"}
				icon={UserRound}
				loading={save.loading}
			/>
			{save.error ? <ErrorNotice error={save.error} /> : null}
			<div className="text-muted-foreground flex flex-wrap items-center gap-2 text-[11px]">
				Tracking {list.length} competitor{list.length === 1 ? "" : "s"}.
				<Button
					size="xs"
					variant="outline"
					onClick={() =>
						void openSidePanelFromPage({ tool: "competitors" }).catch(() =>
							toast("Open a normal browser tab to use the side panel.", {
								tone: "error",
							}),
						)
					}
				>
					<PanelRightOpen /> Manage competitors
				</Button>
			</div>
		</Section>
	);
}

// ---------------------------------------------------------------------------

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export function FeaturesSection() {
	const [flags, setFlags] = useStorageItem(features);
	const [speed, setSpeed] = useStorageItem(shortsDefaultSpeed);
	return (
		<Section
			id="features"
			title="Features on YouTube"
			icon={SlidersHorizontal}
			description="Turn the parts open-vidiq adds to YouTube on or off. Changes apply right away."
		>
			<div className="flex flex-col divide-y">
				{FEATURE_INFO.map((f) => (
					<SwitchRow
						key={f.key}
						icon={f.icon}
						title={f.title}
						description={f.description}
						checked={flags[f.key]}
						onCheckedChange={(v) =>
							void setFlags((prev) => ({ ...prev, [f.key]: v }))
						}
					/>
				))}
			</div>
			<Field
				label="Shorts default speed"
				htmlFor="shorts-speed"
				hint="Playback rate applied when a Short starts (needs Shorts controls on)."
			>
				<NativeSelect
					id="shorts-speed"
					value={speed}
					onChange={(e) => void setSpeed(Number(e.target.value))}
					className="w-40"
					disabled={!flags.shortsControls}
				>
					{SPEEDS.map((s) => (
						<option key={s} value={s}>
							{s === 1 ? "Normal (1x)" : `${s}x`}
						</option>
					))}
				</NativeSelect>
			</Field>
		</Section>
	);
}

// ---------------------------------------------------------------------------

export function AppearanceSection() {
	const [theme, setTheme] = useStorageItem(uiTheme);
	return (
		<Section
			id="appearance"
			title="Appearance"
			icon={Palette}
			description="Theme of the toolkit, popup and this page. What open-vidiq adds to YouTube follows YouTube's own theme."
		>
			<Segmented<UiTheme>
				value={theme}
				onChange={(v) => void setTheme(v)}
				options={[
					{ value: "system", label: "System", icon: Monitor },
					{ value: "dark", label: "Dark", icon: Moon },
					{ value: "light", label: "Light", icon: Sun },
				]}
				className="self-start"
				ariaLabel="Theme"
			/>
		</Section>
	);
}

// ---------------------------------------------------------------------------

async function exportData() {
	const out: Record<string, unknown> = {
		exportedAt: new Date().toISOString(),
		app: "open-vidiq",
	};
	for (const [key, item] of Object.entries(SETTINGS_ITEMS)) {
		const value = await item.getValue();
		out[key] =
			key === "aiProvider" && value && typeof value === "object"
				? { ...(value as object), apiKey: "" }
				: value;
	}
	const blob = new Blob([JSON.stringify(out, null, 2)], {
		type: "application/json",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `open-vidiq-data-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** Optional host permissions granted at runtime (AI provider, custom server). */
async function revokeOptionalOrigins() {
	const required = new Set(
		browser.runtime.getManifest().host_permissions ?? [],
	);
	const all = await browser.permissions.getAll();
	const optional = (all.origins ?? []).filter((o) => !required.has(o));
	if (optional.length) await browser.permissions.remove({ origins: optional });
}

async function resetEverything() {
	// Sign out first (revokes the login on the server the user is signed in to).
	await account.signOut().catch(async () => {
		// Background unreachable: at least forget the session locally (this
		// page shares the extension origin's IndexedDB with the background).
		await deleteStoredToken().catch(() => {});
		await storage.removeItem("local:authUser").catch(() => {});
	});
	for (const item of Object.values(SETTINGS_ITEMS)) await item.removeValue();
	for (const item of Object.values(PAGE_ITEMS)) await item.removeValue();
	// UI prefs of the YouTube / Studio injected panels.
	for (const item of [injectedPrefs, studioPanelPrefs, studioKeywords])
		await item.removeValue().catch(() => {});
	await currentContext.removeValue().catch(() => {});
	// Learned AI request capabilities (lib/ai/params.ts).
	await aiModelCaps.removeValue().catch(() => {});
	await ext.clearCache().catch(() => null);
	await revokeOptionalOrigins().catch(() => {});
	try {
		for (const key of Object.keys(localStorage))
			if (key.startsWith("ovq:")) localStorage.removeItem(key);
	} catch {
		// storage unavailable
	}
}

export function DataSection() {
	const [confirmReset, setConfirmReset] = useState(false);
	const [busy, setBusy] = useState<"cache" | "reset" | "export" | null>(null);
	const [error, setError] = useState<unknown>(null);

	const run = async (kind: "cache" | "reset" | "export") => {
		setBusy(kind);
		setError(null);
		try {
			if (kind === "cache") {
				const { removed } = await ext.clearCache();
				toast(`Cleared ${removed} cached item${removed === 1 ? "" : "s"}`, {
					tone: "success",
				});
			} else if (kind === "export") {
				await exportData();
			} else {
				await resetEverything();
				toast("Everything was reset", { tone: "success" });
				setTimeout(() => window.location.reload(), 600);
			}
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
			setConfirmReset(false);
		}
	};

	return (
		<Section
			id="data"
			title="Your data"
			icon={Database}
			description="Settings, AI key, chats, ideas and competitors live in this browser only. Your account lives on the open-vidiq server (see Account)."
		>
			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					onClick={() => void run("export")}
					disabled={busy !== null}
				>
					<Download /> Export (without API key)
				</Button>
				<Button
					variant="outline"
					onClick={() => void run("cache")}
					disabled={busy !== null}
				>
					<RotateCcw /> Clear cached YouTube data
				</Button>
			</div>
			<div className="flex flex-col gap-2 border-t border-red-500/30 pt-3">
				{confirmReset ? (
					<Notice
						tone="error"
						title="Reset everything?"
						actions={
							<>
								<Button
									variant="destructive"
									size="sm"
									onClick={() => void run("reset")}
									disabled={busy !== null}
								>
									<Trash2 /> Yes, delete all my open-vidiq data
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setConfirmReset(false)}
								>
									Cancel
								</Button>
							</>
						}
					>
						This deletes your AI settings and key, conversations, saved ideas,
						competitors, my channel, feature settings and cache, revokes the
						site access you granted and signs you out. It can't be undone. Your
						open-vidiq account itself stays: delete it under Account.
					</Notice>
				) : (
					<Button
						variant="destructive"
						className="self-start"
						onClick={() => setConfirmReset(true)}
						disabled={busy !== null}
					>
						<Trash2 /> Reset all data
					</Button>
				)}
			</div>
			{error ? <ErrorNotice error={error} /> : null}
		</Section>
	);
}

// ---------------------------------------------------------------------------

export function AboutSection() {
	const version = browser.runtime.getManifest().version;
	const health = useBackground("api.health", {}, []);
	return (
		<Section id="about" title="About open-vidiq" icon={Info}>
			<div className="flex flex-col gap-2 text-xs leading-relaxed">
				<p className="flex items-start gap-2">
					<Heart className="text-brand mt-0.5 size-4 shrink-0" aria-hidden />
					<span>
						open-vidiq is a free, open-source YouTube growth toolkit. Every
						feature is included and unlimited: no plans, no credits, no
						paywalls. It needs a free account. You bring your own AI provider
						(or a free local model), and your settings, AI key and chats stay in
						your browser.
					</span>
				</p>
				<p className="text-muted-foreground">
					Version {version}
					{health.data
						? ` · server ${health.data.ok ? "online" : "offline"}`
						: ""}
				</p>
			</div>
			<div className="bg-surface-2 flex flex-col gap-1.5 p-3 text-xs">
				<span className="font-medium">Tip: free local AI with Ollama</span>
				<p className="text-muted-foreground leading-relaxed">
					Ollama only accepts requests from origins it trusts. Start it with the
					extension allowed, then pick "Ollama (local)" above:
				</p>
				<code className="bg-background block overflow-x-auto px-2 py-1.5 font-mono text-[11px]">
					OLLAMA_ORIGINS=chrome-extension://* ollama serve
				</code>
				<p className="text-muted-foreground leading-relaxed">
					On Windows:{" "}
					<code className="font-mono">
						setx OLLAMA_ORIGINS "chrome-extension://*"
					</code>
					, then restart Ollama. LM Studio: enable the local server and CORS in
					the Developer tab.
				</p>
			</div>
			<p className="text-muted-foreground text-[11px] leading-relaxed">
				Not affiliated with YouTube, Google or vidIQ. YouTube data comes from
				YouTube's public web pages, requested from your browser.
			</p>
			<div>
				<Button
					size="sm"
					variant="outline"
					onClick={() => void openSidePanelFromPage().catch(() => {})}
				>
					<PanelRightOpen /> Open the toolkit
				</Button>
			</div>
		</Section>
	);
}
