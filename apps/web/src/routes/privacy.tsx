import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowUpRight,
	ChartLine,
	Cookie,
	Lock,
	type LucideIcon,
	Trash2,
	UserRound,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Public privacy policy (linked from the footer and the Chrome Web Store
 * listing). Not under _auth: it must be readable signed out.
 *
 * Keep every sentence true to the code: the server (apps/server,
 * packages/auth, packages/db schema), the extension (options page privacy
 * copy, lib/youtube/visibility.ts) and the web app. Change the effective
 * date when the content changes.
 */
export const Route = createFileRoute("/privacy")({
	head: () => ({
		meta: [
			{ title: "Privacy policy · GrowTube" },
			{
				name: "description",
				content:
					"What GrowTube's extension, website and server collect, what stays in your browser, and how to delete your account.",
			},
		],
	}),
	component: PrivacyPage,
});

const EFFECTIVE_DATE = "November 22, 2026";
const ISSUES_URL = "https://github.com/meabhisingh/growtube/issues";
/**
 * Set both before submitting to the Chrome Web Store (its review reads this
 * page): the developer name exactly as the Chrome Web Store developer
 * account shows it, and that account's public contact email. While they are
 * null the page leaves the name out and sends contact requests to GitHub
 * issues instead.
 */
const OPERATOR: string | null = null;
const CONTACT_EMAIL: string | null = null;

type SectionId =
	| "who-we-are"
	| "account"
	| "extension"
	| "browser"
	| "ai"
	| "youtube"
	| "cookies"
	| "server"
	| "use"
	| "retention"
	| "security"
	| "children"
	| "choices"
	| "changes"
	| "contact";

/** Table of contents: short labels for the nav, full titles on the sections. */
const SECTIONS: { id: SectionId; nav: string; title: string }[] = [
	{ id: "who-we-are", nav: "Who we are", title: "Who we are" },
	{ id: "account", nav: "Your account", title: "What your account stores" },
	{
		id: "extension",
		nav: "Extension uploads",
		title: "What the extension sends to GrowTube",
	},
	{
		id: "browser",
		nav: "In your browser",
		title: "What stays in your browser",
	},
	{ id: "ai", nav: "AI providers", title: "AI features and your AI provider" },
	{
		id: "youtube",
		nav: "YouTube data",
		title: "YouTube data and YouTube API Services",
	},
	{ id: "cookies", nav: "Cookies & website", title: "Cookies and the website" },
	{
		id: "server",
		nav: "Logs & hosting",
		title: "Server logs, rate limits and hosting",
	},
	{ id: "use", nav: "How we use data", title: "How we use data" },
	{
		id: "retention",
		nav: "Retention & deletion",
		title: "How long data is kept, and deleting it",
	},
	{ id: "security", nav: "Security", title: "Security" },
	{ id: "children", nav: "Children", title: "Children" },
	{ id: "choices", nav: "Your choices", title: "Your choices and rights" },
	{ id: "changes", nav: "Changes", title: "Changes to this policy" },
	{ id: "contact", nav: "Contact", title: "Contact" },
];

const SUMMARY: { icon: LucideIcon; text: string }[] = [
	{
		icon: UserRound,
		text: "A free account is required. We store your name, your email, a hash of your password, your login sessions and any API keys you create.",
	},
	{
		icon: ChartLine,
		text: "To show stats, the extension looks up the public videos and channels you see by their ID. If you turn on sharing (it's off until you do), it also uploads their public numbers. Neither is linked to your account, and unlisted or private videos are never sent.",
	},
	{
		icon: Lock,
		text: "Your settings, AI key and AI Coach chats stay in your browser. AI requests go straight to the provider you choose.",
	},
	{
		icon: Cookie,
		text: "No ads, no analytics, no tracking cookies. We don't sell your data.",
	},
	{
		icon: Trash2,
		text: "You can delete your account at any time, on the website or in the extension.",
	},
];

function PrivacyPage() {
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 md:py-16">
			<header className="flex max-w-3xl flex-col gap-3">
				<p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
					Privacy
				</p>
				<h1 className="text-2xl font-semibold tracking-tight text-balance md:text-3xl">
					Privacy policy
				</h1>
				<p className="text-muted-foreground text-sm leading-relaxed">
					What the GrowTube Chrome extension, this website and the GrowTube
					server collect, where it goes, how long it is kept and how to delete
					it. It describes what the code actually does.
				</p>
				<p className="text-xs font-medium">
					Effective date: <time dateTime="2026-11-22">{EFFECTIVE_DATE}</time>
				</p>
			</header>

			<div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
				<TableOfContents />

				<article className="flex max-w-3xl min-w-0 flex-col gap-10">
					<Summary />

					<PolicySection id="who-we-are">
						<p>
							GrowTube is a free YouTube creator toolkit made of three parts:
							the GrowTube Chrome extension, this website and the GrowTube
							server that both of them use. This policy covers all three. "We",
							"us" and "GrowTube" mean{" "}
							{OPERATOR ? <Strong>{OPERATOR}</Strong> : "the developer"}, who
							runs this GrowTube service and publishes the GrowTube extension on
							the Chrome Web Store. You can reach us at <ContactLink />.
						</p>
						<p>
							GrowTube is an independent project. It is not affiliated with,
							endorsed by or sponsored by YouTube, Google or vidIQ.
						</p>
						<p>
							GrowTube's source code is published on GitHub, so anyone can run
							their own server. If you point the extension at a different server
							(<Ui>Settings → Server & privacy</Ui>), whoever runs that server
							holds your account and uploads there, and this policy does not
							cover it.
						</p>
					</PolicySection>

					<PolicySection id="account">
						<p>
							You need a free account (email and password) to use the extension,
							the website's tools, the API and MCP. The server stores exactly
							this:
						</p>
						<Bullets>
							<li>
								<Strong>Your account:</Strong> your name, your email address and
								when you created the account. GrowTube never sends email, so the
								address is not verified and you won't get mail from us.
							</li>
							<li>
								<Strong>Your password, hashed</Strong> with scrypt. The password
								itself is never stored.
							</li>
							<li>
								<Strong>Login sessions:</Strong> one per sign-in, with a random
								token, its expiry (7 days, extended while you use GrowTube),
								when it was created and last updated, and your user ID.{" "}
								<Strong>No IP address and no browser user agent</Strong> are
								stored with them.
							</li>
							<li>
								<Strong>MCP API keys you create:</Strong> a SHA-256 hash of each
								key, its first 8 characters so you can tell keys apart, the name
								you gave it, and when it was created, last used and (if you
								chose an expiry) expires. The full key is shown once, when you
								create it.
							</li>
						</Bullets>
						<p>
							We don't ask for or store a profile photo, phone number, postal
							address, payment details or any Google or YouTube account. Your
							account details are on the dashboard, and your API keys on the MCP
							page.
						</p>
					</PolicySection>

					<PolicySection id="extension">
						<p>
							The extension talks to the GrowTube server for two things. Every
							request except the health check carries your login token, because
							GrowTube only works signed in.
						</p>
						<SubHeading>Looking up stats</SubHeading>
						<p>
							To show views per hour, view history, channel history and trends,
							the extension asks the server about public videos and channels you
							see on YouTube and the channels you add as competitors, by their
							video or channel ID, and sends the text of trending searches you
							run. This happens whenever you're signed in, whether or not
							sharing is on, and the extension's sign-in form says so. The
							server answers from its database. It doesn't record which account
							asked about what: lookups are not stored with your account, and
							the logs leave out IDs and search text (see{" "}
							<SectionLink id="server">server logs</SectionLink>). The extension
							never looks up a video it knows is unlisted or private, or
							anything on your watch history, library or playlist pages.
						</p>
						<SubHeading>Sharing public stats (crowdsourcing)</SubHeading>
						<p>
							<Ui>Share public stats</Ui> is off until you turn it on, with a
							checkbox on the extension's sign-in form or later in its popup or
							in <Ui>Settings → Server & privacy</Ui>. With it on, the extension
							also uploads the public numbers it saw for those videos and
							channels, so that everyone gets view history and trends:
						</p>
						<Bullets>
							<li>
								<Strong>Videos:</Strong> video ID, title, channel ID and name,
								publish date, duration, whether it's a Short, and the public
								view, like and comment counts.
							</li>
							<li>
								<Strong>Channels:</Strong> channel ID, @handle, name, avatar
								image URL, public subscriber, view and video counts, join date,
								country and channel keywords.
							</li>
						</Bullets>
						<p>
							<Strong>Uploads are not linked to your account.</Strong> The
							server checks that an upload comes from a signed-in extension,
							then stores it without any user ID or anything else about you.
							Times that come from your browser's report are rounded down to the
							hour.
						</p>
						<p>The extension never uploads:</p>
						<Bullets>
							<li>
								Unlisted or private videos, even ones you open. Only videos that
								YouTube's own page data confirms as public are uploaded, and
								opening an unlisted or private video uploads nothing about its
								channel either.
							</li>
							<li>
								Anything from your watch history, library, downloads, clips or
								playlist pages.
							</li>
							<li>Anything from YouTube Studio.</li>
							<li>
								Your Google account, your YouTube cookies, or your watch or
								search history.
							</li>
						</Bullets>
						<p>
							You can turn sharing on or off at any time in the extension's
							popup or in <Ui>Settings → Server & privacy</Ui>. Everything else
							works either way. If a public video later becomes unlisted or
							private, a server that uses the YouTube Data API notices at its
							next hourly check and deletes the video and its history. Otherwise
							the video drops out of Trending once nobody reports it any more,
							within about two days.
						</p>
					</PolicySection>

					<PolicySection id="browser">
						<p>
							Most of what you do in GrowTube stays in the extension's storage
							on your computer and is never sent to the GrowTube server:
						</p>
						<Bullets>
							<li>
								Your settings and feature switches, your channel and your
								competitor list. The Competitors tool looks up each competitor's
								public channel history on the server by channel ID; like other{" "}
								<SectionLink id="extension">stats lookups</SectionLink>, that is
								not stored with your account.
							</li>
							<li>Your AI provider settings and AI API key.</li>
							<li>AI Coach conversations, saved ideas and other results.</li>
							<li>
								Cached public YouTube data, so the extension doesn't fetch the
								same thing twice.
							</li>
							<li>
								Your GrowTube login token, plus your name and email so the
								extension can show who is signed in.
							</li>
						</Bullets>
						<p>
							In <Ui>Settings → Your data</Ui> you can export this data (without
							your AI key), clear the cache, or reset everything, which also
							signs you out. Uninstalling the extension removes its data from
							your browser too.
						</p>
					</PolicySection>

					<PolicySection id="ai">
						<p>
							AI features, such as the AI Coach, title and description ideas,
							the clip finder, thumbnail concepts and the Studio optimizer, use
							an OpenAI-compatible AI provider that you choose, with your own
							API key. When you use one, the extension sends your request
							directly from your browser to that provider, together with the
							context it needs: for example a video's title, description, stats
							or transcript, your channel's details, or the title, description
							and tags you are editing in Studio.
						</p>
						<p>
							These requests never pass through GrowTube's servers, and we never
							see your key, your prompts or the answers. The provider you choose
							processes them under its own privacy policy and terms, so check
							those before you add a key. With a local model (for example in
							Ollama or LM Studio) nothing leaves your computer. Chrome asks for
							your permission before the extension can contact your provider's
							address.
						</p>
					</PolicySection>

					<PolicySection id="youtube">
						<p>
							GrowTube doesn't ask for access to your Google or YouTube account
							and never signs in to it.
						</p>
						<p>
							On YouTube, the extension reads the public information on the
							pages you visit and fetches more public YouTube data from your
							browser, such as video and channel pages, search results,
							autocomplete suggestions and thumbnails. These requests go to
							YouTube without your YouTube cookies. In YouTube Studio it reads
							the title, description and tags of the video you are editing to
							score them on your computer. They go to your AI provider only when
							you use an AI tool, and never to the GrowTube server.
						</p>
						<p>
							<Strong>GrowTube uses YouTube API Services.</Strong> The GrowTube
							server can be set up with a YouTube Data API key (this is
							optional). With one, an hourly job asks the YouTube Data API for
							the current public statistics and visibility of recently reported
							videos and channels. The server also checks newly reported videos
							against YouTube's public oEmbed endpoint. This happens on the
							server and involves no information about you.
						</p>
						<p>
							By using GrowTube you agree to be bound by the{" "}
							<ExternalLink href="https://www.youtube.com/t/terms">
								YouTube Terms of Service
							</ExternalLink>
							. Requests to YouTube, whether from your browser or from our
							server, are handled by Google under the{" "}
							<ExternalLink href="https://policies.google.com/privacy">
								Google Privacy Policy
							</ExternalLink>
							.
						</p>
					</PolicySection>

					<PolicySection id="cookies">
						<p>
							The website uses one cookie: the session cookie the GrowTube
							server sets when you sign in, to keep you signed in. It is
							HttpOnly and Secure, holds only a signed session token, and is
							removed when you sign out. Your light or dark theme choice is
							saved in your browser's local storage.
						</p>
						<p>
							There are{" "}
							<Strong>
								no analytics, advertising or tracking cookies and no third-party
								trackers
							</Strong>
							, on the website or in the extension. The extension uses no
							cookies at all: it sends its login token with each request
							instead.
						</p>
						<p>
							Pages that show videos load thumbnails and channel avatars from
							YouTube's image servers, and video pages ask YouTube's public
							oEmbed endpoint for the title and channel name, without cookies.
							When an AI assistant calls GrowTube's MCP server with your API
							key, the server checks the key, notes when it was last used and
							answers with public stats. It doesn't store the assistant's
							questions.
						</p>
					</PolicySection>

					<PolicySection id="server">
						<Bullets>
							<li>
								<Strong>Logs</Strong> record only the request method, the route
								pattern (for example <Code>/v1/videos/:id/history</Code>,
								without the actual ID), the response status and how long it
								took. No IP addresses, query strings, headers, request bodies or
								search text.
							</li>
							<li>
								<Strong>Rate limits</Strong> against abuse count requests under
								a keyed hash (HMAC) of your account ID, or, for sign-in, sign-up
								and account deletion, of your IP address (and for sign-in also
								of the email address you sign in with). Never the ID, IP address
								or email itself. The counters expire after 2 to 30 minutes.
							</li>
							<li>
								<Strong>Trending searches</Strong> are cached for 5 minutes
								under a keyed hash of the search text, never the text itself.
							</li>
							<li>
								<Strong>Hosting:</Strong> the website and the server run on
								Cloudflare Workers, and the server keeps its data in a Postgres
								database and a Redis cache. Like any web host, Cloudflare
								processes your IP address and request metadata to deliver and
								protect the service, under the{" "}
								<ExternalLink href="https://www.cloudflare.com/privacypolicy/">
									Cloudflare Privacy Policy
								</ExternalLink>
								.
							</li>
						</Bullets>
					</PolicySection>

					<PolicySection id="use">
						<p>
							We use the data described here only to provide GrowTube's features
							and keep the service secure: signing you in, showing stats,
							history and trends, answering MCP requests and preventing abuse.
							We don't sell your data, we don't use it for advertising, and we
							don't build profiles of you. We share it with no one except the
							providers that host the service, or when the law requires it.
						</p>
						<div className="bg-muted/40 flex flex-col gap-3 rounded-xl border p-4">
							<SubHeading>Chrome Web Store Limited Use</SubHeading>
							<p>
								The use of information received from the GrowTube extension
								adheres to the{" "}
								<ExternalLink href="https://developer.chrome.com/docs/webstore/program-policies/policies">
									Chrome Web Store User Data Policy
								</ExternalLink>
								, including the{" "}
								<ExternalLink href="https://developer.chrome.com/docs/webstore/program-policies/limited-use">
									Limited Use
								</ExternalLink>{" "}
								requirements. Data from the extension:
							</p>
							<Bullets>
								<li>
									is used only to provide and improve GrowTube's features;
								</li>
								<li>
									is not sold, and is not transferred to anyone except as needed
									to run those features, to comply with the law, or to protect
									against malware, spam, fraud or abuse;
								</li>
								<li>
									is never used or transferred for personalized advertising, and
									never used to determine creditworthiness or for lending;
								</li>
								<li>
									is not read by any person unless you explicitly agree to it,
									it is needed for security (such as investigating abuse) or to
									comply with the law, or it is aggregated and anonymized for
									running the service.
								</li>
							</Bullets>
						</div>
					</PolicySection>

					<PolicySection id="retention">
						<Bullets>
							<li>
								<Strong>Your account</Strong> is kept until you delete it. You
								can delete it on the website (
								<Ui>Dashboard → Delete account</Ui>) or in the extension (
								<Ui>Settings → Account → Delete account</Ui>
								), with your password. This removes your account, your password
								hash, all of your sessions and all of your API keys from the
								database and signs you out everywhere. It can't be undone.
							</li>
							<li>
								<Strong>Sessions</Strong> end when you sign out (the dashboard
								can also sign you out on all devices) and expire after 7 days
								without use. Expired sessions are deleted daily.
							</li>
							<li>
								<Strong>API keys</Strong> are kept until you revoke them on the
								MCP page or they expire. Expired keys are deleted daily.
							</li>
							<li>
								<Strong>Crowdsourced public stats</Strong> were never linked to
								an account, so they stay when you delete yours, and nothing in
								them points back to you. Detailed view snapshots of a video are
								thinned to one per hour after 7 days and deleted after 180 days.
								Daily channel snapshots and the latest public numbers of each
								video and channel are kept for the history charts. A video that
								YouTube reports as unlisted or private is deleted with its
								history.
							</li>
							<li>
								<Strong>Rate-limit counters</Strong> expire after 2 to 30
								minutes, and cached API responses after at most 10 minutes.
							</li>
							<li>
								<Strong>Data in your browser</Strong> stays until you reset it
								in <Ui>Settings → Your data</Ui> or uninstall the extension.
								Deleting your account doesn't touch it.
							</li>
						</Bullets>
					</PolicySection>

					<PolicySection id="security">
						<Bullets>
							<li>
								Passwords are hashed with scrypt, API keys are stored as SHA-256
								hashes, and the extension's login token is signed.
							</li>
							<li>
								The website's session cookie is HttpOnly and Secure, so scripts
								on the page can't read it.
							</li>
							<li>
								Deleting your account needs your password, and sign-in attempts
								are rate-limited per IP address and per account to slow down
								password guessing.
							</li>
							<li>
								Beyond YouTube and the GrowTube server, the extension gets
								access to a site only when you add an AI provider or a custom
								server, and Chrome asks you first.
							</li>
						</Bullets>
						<p>
							No system is perfectly secure. If you think you've found a
							security problem, please tell us (see{" "}
							<SectionLink id="contact">Contact</SectionLink>).
						</p>
					</PolicySection>

					<PolicySection id="children">
						<p>
							GrowTube is not directed to children under 13, and we don't
							knowingly collect personal information from them. If you believe a
							child under 13 has created an account, contact us at{" "}
							<ContactLink /> and we will delete it.
						</p>
					</PolicySection>

					<PolicySection id="choices">
						<Bullets>
							<li>
								Turn crowdsourcing on or off in the extension's popup or in{" "}
								<Ui>Settings → Server & privacy</Ui>.
							</li>
							<li>
								See your account details on the dashboard, and sign out on one
								or all devices.
							</li>
							<li>
								Export, clear or reset the extension's data in{" "}
								<Ui>Settings → Your data</Ui>.
							</li>
							<li>
								Delete your account at any time, on the website or in the
								extension.
							</li>
							<li>
								Your name and email can't be edited. To change them, delete your
								account and create a new one.
							</li>
						</Bullets>
						<p>
							Depending on where you live, you may have the right to access,
							correct, delete or export your personal data, or to object to how
							it is used. The tools above cover most of this. For anything else,
							contact us.
						</p>
					</PolicySection>

					<PolicySection id="changes">
						<p>
							When we change this policy, we update this page and the effective
							date at the top. If a change means GrowTube would collect or share
							something it doesn't today, this page is updated before that
							change takes effect.
						</p>
					</PolicySection>

					<PolicySection id="contact">
						<p>
							{OPERATOR ? `GrowTube is run by ${OPERATOR}. ` : null}For
							questions or requests about privacy, including access, correction
							or deletion requests and anything about children's data, contact
							us at <ContactLink />.
						</p>
						<p>
							For general questions and bug reports you can also open an issue
							on GitHub at{" "}
							<ExternalLink href={ISSUES_URL}>
								github.com/meabhisingh/growtube/issues
							</ExternalLink>
							. Issues are public, so please don't include passwords, API keys
							or other personal details in them.
						</p>
					</PolicySection>
				</article>
			</div>
		</div>
	);
}

function TableOfContents() {
	return (
		<nav
			aria-label="On this page"
			className="bg-card ring-foreground/8 h-fit rounded-xl p-4 shadow-xs ring-1 lg:sticky lg:top-20 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0"
		>
			<p className="text-muted-foreground pb-2 text-[11px] font-medium tracking-wider uppercase">
				On this page
			</p>
			<ol className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs lg:grid-cols-1">
				{SECTIONS.map((section) => (
					<li key={section.id}>
						<Link
							to="/privacy"
							hash={section.id}
							className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1.5 block rounded-lg px-1.5 py-1 transition-colors duration-150 outline-none focus-visible:ring-2"
						>
							{section.nav}
						</Link>
					</li>
				))}
			</ol>
		</nav>
	);
}

function Summary() {
	return (
		<section
			aria-labelledby="summary-heading"
			className="bg-card ring-foreground/8 flex flex-col gap-4 rounded-xl p-5 shadow-xs ring-1"
		>
			<h2 id="summary-heading" className="text-sm font-semibold">
				The short version
			</h2>
			<ul className="flex flex-col gap-3 text-sm">
				{SUMMARY.map(({ icon: Icon, text }) => (
					<li key={text} className="flex gap-3">
						<Icon
							className="mt-0.5 size-4 shrink-0 text-[var(--chart-2)]"
							aria-hidden="true"
						/>
						<span className="text-muted-foreground leading-relaxed">
							{text}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function PolicySection({
	id,
	children,
}: {
	id: SectionId;
	children: ReactNode;
}) {
	const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
	const headingId = `${id}-heading`;
	return (
		<section
			id={id}
			aria-labelledby={headingId}
			className="flex scroll-mt-20 flex-col gap-3"
		>
			<h2
				id={headingId}
				className="text-lg font-semibold tracking-tight text-balance"
			>
				{title}
			</h2>
			<div className="text-muted-foreground flex flex-col gap-3 text-sm leading-relaxed">
				{children}
			</div>
		</section>
	);
}

function SubHeading({ children }: { children: ReactNode }) {
	return (
		<h3 className="text-foreground pt-1 text-sm font-semibold">{children}</h3>
	);
}

function Bullets({ children }: { children: ReactNode }) {
	return (
		<ul className="marker:text-muted-foreground/60 flex list-disc flex-col gap-2 pl-5">
			{children}
		</ul>
	);
}

function Strong({ children }: { children: ReactNode }) {
	return <strong className="text-foreground font-medium">{children}</strong>;
}

/** A place in the extension's or website's UI, like "Settings → Your data". */
function Ui({ children }: { children: ReactNode }) {
	return (
		<span className="text-foreground font-medium whitespace-nowrap">
			{children}
		</span>
	);
}

function Code({ children }: { children: ReactNode }) {
	return (
		<code className="bg-muted text-foreground rounded-md px-1 py-0.5 font-mono text-xs">
			{children}
		</code>
	);
}

function SectionLink({ id, children }: { id: SectionId; children: ReactNode }) {
	return (
		<Link
			to="/privacy"
			hash={id}
			className="text-foreground underline underline-offset-4"
		>
			{children}
		</Link>
	);
}

/** The contact email, or GitHub issues until CONTACT_EMAIL is set. */
function ContactLink() {
	if (!CONTACT_EMAIL) {
		return (
			<ExternalLink href={ISSUES_URL}>
				github.com/meabhisingh/growtube/issues
			</ExternalLink>
		);
	}
	return (
		<a
			href={`mailto:${CONTACT_EMAIL}`}
			className="text-foreground underline underline-offset-4"
		>
			{CONTACT_EMAIL}
		</a>
	);
}

function ExternalLink({
	href,
	children,
}: {
	href: string;
	children: ReactNode;
}) {
	return (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			className="text-foreground underline underline-offset-4"
		>
			{children}
			<ArrowUpRight
				className="ml-0.5 inline size-3 align-[-1px]"
				aria-hidden="true"
			/>
		</a>
	);
}
