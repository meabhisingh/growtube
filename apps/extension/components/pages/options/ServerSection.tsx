/**
 * open-vidiq server URL (with a reachability test), the crowdsourcing
 * toggle and an exact account of what the server stores and sees. Usable
 * while signed out (the server URL decides where you sign in).
 *
 * Keep the privacy copy exactly true: it describes the server's behaviour
 * (apps/server, packages/auth) as well as the extension's.
 */
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import {
	CircleCheck,
	LoaderCircle,
	PlugZap,
	RotateCcw,
	Save,
	Server,
	ShieldCheck,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { authUser } from "@/lib/auth";
import { server } from "@/lib/client";
import { DEFAULT_SERVER_URL } from "@/lib/env";
import { useStorageItem } from "@/lib/hooks";
import { ensureOriginPermission, originOf } from "@/lib/permissions";
import { crowdsourceStats, serverUrl } from "@/lib/settings";

import { Field, SwitchRow } from "../ui/controls";
import { ErrorNotice, Notice } from "../ui/feedback";
import { Eyebrow, Section } from "../ui/layout";
import { toast } from "../ui/toast";
import { StatusLine } from "./AiSection";

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

export function ServerSection() {
	const [saved, , loading] = useStorageItem(serverUrl);
	const [user] = useStorageItem(authUser);
	const [crowdsource, setCrowdsource] = useStorageItem(crowdsourceStats);
	const [draft, setDraft] = useState<string | null>(null);
	const [busy, setBusy] = useState<"save" | "test" | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
		null,
	);

	// Follow the stored value unless the user has unsaved edits.
	const lastSaved = useRef(saved);
	useEffect(() => {
		if (loading) return;
		const prev = lastSaved.current;
		lastSaved.current = saved;
		setDraft((d) =>
			d == null || normalizeUrl(d) === normalizeUrl(prev) ? saved : d,
		);
	}, [loading, saved]);

	const current = draft ?? saved;
	const dirty = normalizeUrl(current) !== normalizeUrl(saved);

	/** Permission + save; first await of the click handler. */
	const persist = async (): Promise<boolean> => {
		const url = normalizeUrl(current);
		if (!/^https?:\/\/[^/\s]+/.test(url)) {
			setError(
				"Enter a URL starting with https:// (or http:// for a local server).",
			);
			return false;
		}
		const granted = await ensureOriginPermission(url);
		if (!granted) {
			setError(`Chrome didn't grant access to ${originOf(url) ?? url}.`);
			return false;
		}
		await serverUrl.setValue(url);
		setDraft(url);
		return true;
	};

	const onSave = async () => {
		setBusy("save");
		setError(null);
		setResult(null);
		try {
			if (await persist()) toast("Server URL saved", { tone: "success" });
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
		}
	};

	const onTest = async () => {
		setBusy("test");
		setError(null);
		setResult(null);
		try {
			if (dirty && !(await persist())) return;
			const h = await server.health();
			setResult(
				h.ok
					? { ok: true, text: `${h.serverUrl} is reachable.` }
					: {
							ok: false,
							text: `${h.serverUrl} didn't answer${h.error ? ` (${h.error})` : ""}. History and trending need it; everything else keeps working.`,
						},
			);
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
		}
	};

	return (
		<Section
			id="server"
			title="Server & privacy"
			icon={Server}
			description="The open-vidiq server holds your account and the crowdsourced public stats behind view history charts, recent views/hour and Trends."
		>
			<Field
				label="Server URL"
				htmlFor="server-url"
				hint={`Default: ${DEFAULT_SERVER_URL}. Self-host it and point this at your own instance if you like. Accounts belong to a server${user ? ": changing it signs you out" : ""}.`}
			>
				<div className="flex flex-wrap gap-1.5">
					<Input
						id="server-url"
						value={current}
						onChange={(e) => {
							setDraft(e.target.value);
							setResult(null);
							setError(null);
						}}
						placeholder="https://…"
						spellCheck={false}
						className="min-w-60 flex-1"
					/>
					<Button
						onClick={() => void onSave()}
						disabled={busy !== null || !dirty}
					>
						{busy === "save" ? (
							<LoaderCircle className="animate-spin" />
						) : (
							<Save />
						)}
						Save
					</Button>
					<Button
						variant="outline"
						onClick={() => void onTest()}
						disabled={busy !== null}
					>
						{busy === "test" ? (
							<LoaderCircle className="animate-spin" />
						) : (
							<PlugZap />
						)}
						Test
					</Button>
					{normalizeUrl(current) !== DEFAULT_SERVER_URL ? (
						<Button
							variant="ghost"
							onClick={() => setDraft(DEFAULT_SERVER_URL)}
							disabled={busy !== null}
						>
							<RotateCcw /> Default
						</Button>
					) : null}
				</div>
			</Field>
			{error ? (
				<ErrorNotice error={error} title="Couldn't save the server URL" />
			) : null}
			{result ? (
				result.ok ? (
					<Notice tone="success" icon={CircleCheck} title="Server reachable">
						{result.text}
					</Notice>
				) : (
					<Notice tone="warning" title="Server unreachable">
						{result.text}
					</Notice>
				)
			) : (
				<HealthLine />
			)}

			<div className="border-t pt-1">
				<SwitchRow
					icon={ShieldCheck}
					title="Share public stats (crowdsourcing)"
					description="Helps every open-vidiq user get view history and trending, for free. You can turn it off any time; everything else keeps working."
					checked={crowdsource}
					onCheckedChange={(v) => void setCrowdsource(v)}
				/>
				<PrivacyDetails />
			</div>
		</Section>
	);
}

function HealthLine() {
	const [url] = useStorageItem(serverUrl);
	const [state, setState] = useState<{
		loading: boolean;
		ok: boolean;
		text: string;
	}>({
		loading: true,
		ok: false,
		text: "Checking the server…",
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-check when the URL changes
	useEffect(() => {
		let alive = true;
		setState((s) => ({ ...s, loading: true }));
		server
			.health()
			.then(
				(h) =>
					alive &&
					setState({
						loading: false,
						ok: h.ok,
						text: h.ok
							? `Connected to ${h.serverUrl}`
							: `Can't reach ${h.serverUrl}`,
					}),
			)
			.catch(
				(e: unknown) =>
					alive &&
					setState({
						loading: false,
						ok: false,
						text: e instanceof Error ? e.message : String(e),
					}),
			);
		return () => {
			alive = false;
		};
	}, [url]);
	return (
		<StatusLine loading={state.loading} ready={state.ok} text={state.text} />
	);
}

function PrivacyBlock({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Eyebrow>{title}</Eyebrow>
			<ul className="list-disc pl-4">{children}</ul>
		</div>
	);
}

/** What the server stores and sees, exactly. */
function PrivacyDetails() {
	return (
		<div className="bg-surface-2 ml-7 flex flex-col gap-3 p-3 text-[11px] leading-relaxed">
			<PrivacyBlock title="Your account">
				<li>
					Signing in is required to use open-vidiq: the toolkit, the YouTube and
					Studio panels and the server data.
				</li>
				<li>
					The server stores your account (name, email and a hash of your
					password, never the password itself) and, for each sign-in, a login
					token with an expiry date. No IP address or browser user agent is
					stored with them.
				</li>
				<li>
					<span className="font-medium">Delete account</span> (Settings →
					Account) removes the account, all its logins and its API keys.
				</li>
			</PrivacyBlock>

			<PrivacyBlock title="Crowdsourced uploads (when sharing is on)">
				<li>
					Only numbers anyone can see on YouTube, for videos and channels the
					extension looked up while you browse.{" "}
					<span className="font-medium">Videos:</span> video id, channel id,
					title, channel name, publish date, duration, Short or not, and the
					public view, like and comment counts.{" "}
					<span className="font-medium">Channels:</span> channel id, @handle,
					name, avatar URL, public subscriber/view/video counts, join date,
					country and channel keywords.
				</li>
				<li>
					Uploads are not linked to your account: the server stores no account
					id (or anything else about you) with them.
				</li>
				<li>
					Unlisted and private videos are never uploaded, and opening one
					uploads nothing about its channel either. Feed badges look up videos
					on public YouTube pages (home, search, subscriptions, channels) by id,
					but never one the extension knows is unlisted or private, and nothing
					on your watch history, library or playlist pages is looked up or
					uploaded.
				</li>
				<li>
					If a public video later turns unlisted or private, a server with a
					YouTube Data API key notices at its next hourly check and deletes the
					video and its history. A server without one can't tell; the video
					drops out of Trending once nobody reports it any more (within two
					days).
				</li>
			</PrivacyBlock>

			<PrivacyBlock title="What the server and its host see">
				<li>
					Server requests (other than the health check) carry your login token:
					that's how sign-in is required. The server's logs record route names
					only.
				</li>
				<li>
					Cloudflare, which hosts the server, can see your IP address, like any
					website host.
				</li>
				<li>
					Rate limits count requests under a keyed hash of your account id (and,
					for sign-in attempts, of your IP address and the email you sign in
					with), kept for 2 to 30 minutes.
				</li>
			</PrivacyBlock>

			<p>
				<span className="font-medium">
					Never sent to the open-vidiq server:
				</span>{" "}
				your AI key and AI chats (AI requests go straight from your browser to
				the provider you chose), transcripts, anything from YouTube Studio (the
				video you are editing, the titles, descriptions and tags you edit there,
				and the tag-rank searches), and your Google account and cookies.
			</p>
		</div>
	);
}
