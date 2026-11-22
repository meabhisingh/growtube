import { formatCompact } from "@open-vidiq/shared";
import { buttonVariants } from "@open-vidiq/ui/components/button";
import { cn } from "@open-vidiq/ui/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	Bot,
	ChartLine,
	Check,
	Flame,
	Gauge,
	Image,
	KeyRound,
	Lightbulb,
	Lock,
	type LucideIcon,
	MessagesSquare,
	PanelRight,
	Plug,
	Scissors,
	Search,
	SearchCheck,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	Timer,
	UserRound,
	Users,
	WandSparkles,
	X,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";

import { AreaChart, type ChartPoint } from "@/components/charts/area-chart";
import { CodeBlock } from "@/components/copy-button";
import { LookupForm } from "@/components/lookup-form";
import { TrendingCard, TrendingCardSkeleton } from "@/components/trending-card";
import { getTrending } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useApi } from "@/lib/use-api";

export const Route = createFileRoute("/")({
	component: HomePage,
});

interface Feature {
	icon: LucideIcon;
	title: string;
	description: string;
	where: string;
	to?: "/trending" | "/mcp" | "/lookup";
}

const FEATURES: Feature[] = [
	{
		icon: Gauge,
		title: "Feed badges",
		description:
			"Views per hour, outlier score and subscriber count on every thumbnail in Home, Search, Subscriptions and channel pages.",
		where: "YouTube feed",
	},
	{
		icon: PanelRight,
		title: "Watch-page panel",
		description:
			"A Views / Overview / AI Coach panel beside every video: VPH, engagement, outlier score, tags and channel stats.",
		where: "Watch page",
	},
	{
		icon: ChartLine,
		title: "Views over time",
		description:
			"See how a video grew in its first 24 hours, 7 days and 28 days, built from crowdsourced snapshots.",
		where: "Watch page + web",
		to: "/lookup",
	},
	{
		icon: MessagesSquare,
		title: "AI Coach",
		description:
			"Chat about any video or your own channel as much as you like. It runs on the AI provider you choose.",
		where: "Watch page",
	},
	{
		icon: ShieldAlert,
		title: "Controversial keyword checker",
		description:
			"Flags words in titles, descriptions and tags that can limit ads or reach, before you hit publish.",
		where: "Watch page + Studio",
	},
	{
		icon: SearchCheck,
		title: "SEO score & tag ranks",
		description:
			"A transparent checklist for title, description and tags, plus where the video ranks in search for each tag.",
		where: "Watch page + Studio",
	},
	{
		icon: Timer,
		title: "Shorts speed & seek",
		description:
			"Playback speed and a seek bar for the Shorts player, so you can study a Short frame by frame.",
		where: "Shorts",
	},
	{
		icon: Search,
		title: "Keyword research",
		description:
			"Search interest and competition signals plus related keywords from YouTube autocomplete and results.",
		where: "Side panel",
	},
	{
		icon: Flame,
		title: "Trends",
		description:
			"Spot breakout videos and topics while they take off, filtered by long-form or Shorts.",
		where: "Side panel + web",
		to: "/trending",
	},
	{
		icon: Users,
		title: "Competitors",
		description:
			"Track rival channels: upload cadence, typical views, best posting times and their outlier hits.",
		where: "Side panel",
	},
	{
		icon: Lightbulb,
		title: "Daily ideas",
		description:
			"Fresh video ideas each day, drawn from outliers in your niche and what is trending right now.",
		where: "Side panel",
	},
	{
		icon: Image,
		title: "Thumbnail preview & generator",
		description:
			"Preview your thumbnail and title in a realistic feed next to competitors, and draft concepts with AI.",
		where: "Side panel",
	},
	{
		icon: Scissors,
		title: "Clip finder",
		description:
			"Finds the most clip-worthy moments in a long video from its transcript, ready to cut into Shorts.",
		where: "Watch page",
	},
	{
		icon: WandSparkles,
		title: "Studio optimizer",
		description:
			"Inside YouTube Studio: rewrite titles, descriptions and tags with AI and watch the SEO score update live.",
		where: "YouTube Studio",
	},
	{
		icon: Plug,
		title: "MCP for AI assistants",
		description:
			"Plug Claude, Cursor or any MCP client into open-vidiq's video, channel and trending data with your own API key.",
		where: "Web",
		to: "/mcp",
	},
];

const PROVIDERS = [
	"OpenAI",
	"OpenRouter",
	"Groq",
	"Mistral",
	"DeepSeek",
	"Together AI",
	"Ollama",
	"LM Studio",
];

const SHARED_DATA = [
	"Video ID, title, channel ID and name",
	"Publish date, duration and whether it's a Short",
	"Public view, like and comment counts",
	"Channel handle, avatar, subscribers, total views and video count",
	"Channel join date, country and public keywords",
];

const NEVER_SHARED = [
	"Which open-vidiq account sent an upload",
	"Unlisted or private videos, even ones you open",
	"Your Google account or YouTube identity",
	"Cookies, watch history or search history",
	"Private YouTube Studio analytics",
	"Your AI provider key, prompts or AI Coach chats",
];

const ACCOUNT_DATA = [
	"Your name and email address",
	"A hash of your password, never the password itself",
	"Login sessions, without your IP address or user agent",
	"API keys you create for MCP clients, stored hashed",
];

function HomePage() {
	const { data: session } = authClient.useSession();
	const signedIn = Boolean(session);
	return (
		<div className="flex flex-col">
			<Hero signedIn={signedIn} />
			<NoLimitsStrip />
			<FeaturesSection />
			{/* /v1/trending needs a session, so the live preview is for members. */}
			{signedIn && <TrendingPreview />}
			<BringYourOwnAi />
			<InstallSection />
			<PrivacySection />
		</div>
	);
}

function Hero({ signedIn }: { signedIn: boolean }) {
	return (
		<section className="relative overflow-hidden border-b">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 bg-[size:48px_48px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
			/>
			<div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]">
				<div className="flex flex-col gap-6">
					<span className="bg-background text-muted-foreground inline-flex w-fit items-center gap-2 border px-2.5 py-1 text-[11px] font-medium">
						<Sparkles
							className="size-3 text-[var(--chart-2)]"
							aria-hidden="true"
						/>
						Free and open source · Chrome extension
					</span>
					<h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">
						The free YouTube growth toolkit
					</h1>
					<p className="text-muted-foreground max-w-xl text-base leading-relaxed text-balance md:text-lg">
						VPH, outlier scores, SEO, keyword research, AI coach. No plans, no
						credits, no limits.
					</p>
					{signedIn ? (
						<>
							<div className="flex flex-wrap gap-2">
								<a
									href="#install"
									className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}
								>
									Install the extension
									<ArrowRight aria-hidden="true" data-icon="inline-end" />
								</a>
								<Link
									to="/trending"
									className={cn(
										buttonVariants({ variant: "outline", size: "lg" }),
										"h-10 px-4",
									)}
								>
									<Flame aria-hidden="true" data-icon="inline-start" />
									See what's trending
								</Link>
							</div>
							<div className="flex max-w-xl flex-col gap-2 pt-2">
								<span className="text-muted-foreground text-xs">
									Or look up any video right now:
								</span>
								<LookupForm placeholder="Paste a YouTube link…" />
							</div>
						</>
					) : (
						<div className="flex flex-col gap-3">
							<div className="flex flex-wrap gap-2">
								<Link
									to="/login"
									search={{ mode: "sign-up" }}
									className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}
								>
									Create a free account
									<ArrowRight aria-hidden="true" data-icon="inline-end" />
								</Link>
								<Link
									to="/login"
									search={{ mode: "sign-in" }}
									className={cn(
										buttonVariants({ variant: "outline", size: "lg" }),
										"h-10 px-4",
									)}
								>
									<UserRound aria-hidden="true" data-icon="inline-start" />
									Sign in
								</Link>
							</div>
							<p className="text-muted-foreground max-w-xl text-xs">
								An account is all it takes: the extension, the web tools and the
								MCP server work once you sign in. Then{" "}
								<a
									href="#install"
									className="hover:text-foreground underline underline-offset-4"
								>
									install the extension
								</a>
								.
							</p>
						</div>
					)}
				</div>
				<HeroPreview />
			</div>
		</section>
	);
}

/** Decorative mock of the extension's badges and chart. */
function HeroPreview() {
	const sample = useMemo<ChartPoint[]>(() => {
		const start = Date.UTC(2026, 0, 1);
		return Array.from({ length: 49 }, (_, i) => ({
			t: start + i * 3_600_000,
			value: Math.round(
				182_000 * (1 - Math.exp(-i / 14)) + 900 * Math.sin(i * 1.7) + i * 400,
			),
		}));
	}, []);

	return (
		<div
			inert
			className="relative mx-auto w-full max-w-md select-none lg:max-w-none"
		>
			<div className="bg-card ring-foreground/10 p-3 shadow-2xl ring-1">
				<div className="relative aspect-video overflow-hidden bg-[linear-gradient(135deg,color-mix(in_oklch,var(--chart-2)_55%,transparent),color-mix(in_oklch,var(--chart-5)_35%,transparent)_60%,var(--muted))]">
					<div className="absolute inset-0 flex items-center justify-center">
						<div className="flex size-14 items-center justify-center bg-black/55 text-white">
							<svg
								viewBox="0 0 24 24"
								className="ml-1 size-7 fill-current"
								aria-hidden="true"
							>
								<path d="M8 5v14l11-7z" />
							</svg>
						</div>
					</div>
					<div className="absolute top-2 left-2 flex gap-1">
						<span className="bg-[var(--chart-2)] px-1.5 py-0.5 text-[11px] font-semibold text-white">
							12.4K VPH
						</span>
						<span className="bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white">
							8.2x
						</span>
					</div>
					<span className="absolute right-2 bottom-2 bg-black/80 px-1 py-0.5 text-[11px] font-medium text-white">
						12:34
					</span>
				</div>
				<div className="flex gap-3 pt-3">
					<div className="bg-muted size-9 shrink-0 rounded-full" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<div className="bg-foreground/15 h-3 w-11/12" />
						<div className="bg-foreground/15 h-3 w-2/3" />
						<div className="text-muted-foreground flex items-center gap-2 pt-0.5 text-[11px]">
							<span className="bg-muted text-foreground px-1.5 py-0.5 font-medium">
								1.41M subs
							</span>
							<span>184K views · 2 days ago</span>
						</div>
					</div>
				</div>
				<div className="mt-3 border-t pt-3">
					<div className="flex items-center justify-between pb-1 text-[11px]">
						<span className="font-medium">Views · first 48 hours</span>
						<span className="text-muted-foreground">
							{formatCompact(sample.at(-1)?.value)} total
						</span>
					</div>
					<AreaChart
						data={sample}
						label="Views"
						height={110}
						ariaLabel="Example chart"
					/>
				</div>
			</div>
			<div className="bg-popover text-popover-foreground ring-foreground/10 absolute top-[30%] -left-6 hidden max-w-[15rem] p-3 shadow-xl ring-1 sm:block">
				<div className="flex items-center gap-1.5 pb-1 text-[11px] font-medium">
					<Bot className="size-3.5 text-[var(--chart-2)]" aria-hidden="true" />
					AI Coach
				</div>
				<p className="text-muted-foreground text-[11px] leading-snug">
					This is 8x your usual views. The hook lands in 3 seconds; reuse it for
					your next upload.
				</p>
			</div>
		</div>
	);
}

function NoLimitsStrip() {
	const items = [
		{
			title: "Unlimited AI Coach",
			body: "Runs on your own AI key or a local model, so there's nothing to meter.",
		},
		{
			title: "Unlimited research",
			body: "Keyword, competitor and trend tools never count your searches.",
		},
		{
			title: "Nothing locked",
			body: "Controversial keywords, outlier scores and view history are all included.",
		},
	];
	return (
		<section
			aria-label="No plans, no credits, no limits"
			className="bg-muted/30 border-b"
		>
			<div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-10 md:grid-cols-3">
				{items.map((item) => (
					<div key={item.title} className="flex gap-3">
						<Check
							className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
							aria-hidden="true"
						/>
						<div className="flex flex-col gap-1">
							<h2 className="text-sm font-semibold">{item.title}</h2>
							<p className="text-muted-foreground text-xs leading-relaxed">
								{item.body}
							</p>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}

function SectionHeading({
	id,
	eyebrow,
	title,
	children,
}: {
	id: string;
	eyebrow: string;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex max-w-2xl flex-col gap-3">
			<p className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
				{eyebrow}
			</p>
			<h2
				id={id}
				className="text-2xl font-semibold tracking-tight text-balance md:text-3xl"
			>
				{title}
			</h2>
			{children && (
				<div className="text-muted-foreground text-sm leading-relaxed">
					{children}
				</div>
			)}
		</div>
	);
}

function FeaturesSection() {
	return (
		<section
			id="features"
			aria-labelledby="features-heading"
			className="scroll-mt-20 border-b"
		>
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 md:py-20">
				<SectionHeading
					id="features-heading"
					eyebrow="Features"
					title="Everything a creator needs, in one extension"
				>
					Data where you already work: on YouTube, in Studio and in a side
					panel. Every tool is free, with no daily caps.
				</SectionHeading>
				<ul className="bg-border ring-border grid gap-px overflow-hidden ring-1 sm:grid-cols-2 lg:grid-cols-3">
					{FEATURES.map((feature) => (
						<li key={feature.title} className="flex">
							<FeatureCard feature={feature} />
						</li>
					))}
				</ul>
			</div>
		</section>
	);
}

function FeatureCard({ feature }: { feature: Feature }) {
	const { icon: Icon, title, description, where, to } = feature;
	return (
		<div className="group bg-background hover:bg-muted/40 relative flex w-full flex-col gap-3 p-5 transition-colors">
			<div className="flex items-center justify-between gap-2">
				<span className="bg-muted text-foreground flex size-8 items-center justify-center">
					<Icon className="size-4" aria-hidden="true" />
				</span>
				<span className="text-muted-foreground text-[10px] tracking-wider uppercase">
					{where}
				</span>
			</div>
			<h3 className="text-sm font-semibold">
				{to ? (
					<Link
						to={to}
						className="outline-none after:absolute after:inset-0 focus-visible:underline"
					>
						{title}
						<ArrowRight
							className="ml-1 inline size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
							aria-hidden="true"
						/>
					</Link>
				) : (
					title
				)}
			</h3>
			<p className="text-muted-foreground text-xs leading-relaxed">
				{description}
			</p>
		</div>
	);
}

function TrendingPreview() {
	const { data, isPending, error } = useApi(
		"trending:24h:all:",
		(signal) => getTrending({ window: "24h", type: "all", limit: 48 }, signal),
		{ staleMs: 60_000 },
	);
	const videos = data?.videos.slice(0, 4) ?? [];
	if (error || (!isPending && videos.length === 0)) return null;
	const now = data ? Date.parse(data.generatedAt) || Date.now() : Date.now();

	return (
		<section aria-labelledby="live-heading" className="border-b">
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-16">
				<div className="flex flex-wrap items-end justify-between gap-4">
					<SectionHeading
						id="live-heading"
						eyebrow="Live"
						title="Trending right now"
					>
						Ranked by views per hour from what the community sees on YouTube.
					</SectionHeading>
					<Link
						to="/trending"
						className={buttonVariants({ variant: "outline" })}
					>
						Full board
						<ArrowRight aria-hidden="true" data-icon="inline-end" />
					</Link>
				</div>
				<ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{isPending
						? Array.from({ length: 4 }, (_, i) => (
								<li key={i} className="flex">
									<TrendingCardSkeleton />
								</li>
							))
						: videos.map((video, i) => (
								<li key={video.videoId} className="flex">
									<TrendingCard video={video} rank={i + 1} now={now} />
								</li>
							))}
				</ol>
			</div>
		</section>
	);
}

function BringYourOwnAi() {
	return (
		<section
			id="ai"
			aria-labelledby="ai-heading"
			className="bg-muted/30 scroll-mt-20 border-b"
		>
			<div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 md:py-20 lg:grid-cols-2">
				<div className="flex flex-col gap-6">
					<SectionHeading
						id="ai-heading"
						eyebrow="Bring your own AI"
						title="Use any model. Your key stays in your browser."
					>
						The AI Coach, title ideas, clip finder, thumbnail concepts and
						Studio optimizer work with any OpenAI-compatible API. Paste a base
						URL, key and model into the extension settings and that's it.
					</SectionHeading>
					<ul className="flex flex-col gap-3 text-sm">
						{[
							"Your key is stored locally in the extension and sent only to the provider you pick.",
							"Requests go straight from your browser to that provider, never through open-vidiq servers.",
							"Run fully offline with a local model in Ollama or LM Studio.",
							"No usage caps from us: you pay your provider directly, or nothing with a local model.",
						].map((line) => (
							<li key={line} className="flex gap-2.5">
								<ShieldCheck
									className="mt-0.5 size-4 shrink-0 text-[var(--chart-2)]"
									aria-hidden="true"
								/>
								<span className="text-muted-foreground">{line}</span>
							</li>
						))}
					</ul>
					<ul
						className="flex flex-wrap gap-1.5"
						aria-label="Compatible providers"
					>
						{PROVIDERS.map((provider) => (
							<li
								key={provider}
								className="bg-background border px-2 py-1 text-[11px]"
							>
								{provider}
							</li>
						))}
						<li className="text-muted-foreground px-2 py-1 text-[11px]">
							and any other OpenAI-compatible API
						</li>
					</ul>
				</div>

				<div inert className="bg-card ring-foreground/10 p-5 shadow-xl ring-1">
					<div className="flex items-center gap-2 border-b pb-3 text-sm font-medium">
						<KeyRound className="size-4" aria-hidden="true" />
						AI provider
					</div>
					<dl className="flex flex-col gap-3 pt-4 text-xs">
						<MockField label="Base URL" value="https://openrouter.ai/api/v1" />
						<MockField label="Model" value="anthropic/claude-sonnet-4.5" />
						<MockField label="API key" value="sk-or-••••••••••••••••" />
					</dl>
					<p className="text-muted-foreground flex items-center gap-1.5 pt-4 text-[11px]">
						<Lock className="size-3" aria-hidden="true" />
						Saved in this browser only
					</p>
				</div>
			</div>
		</section>
	);
}

function MockField({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-1">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="bg-background truncate border px-2.5 py-2 font-mono">
				{value}
			</dd>
		</div>
	);
}

function InstallSection() {
	const steps = [
		{
			title: "Get the code",
			body: "Clone the open-vidiq repository and install dependencies with pnpm.",
			code: "pnpm install",
			caption: "Terminal, in the repo root",
		},
		{
			title: "Build the extension",
			body: "This produces an unpacked Manifest V3 build.",
			code: "pnpm --filter extension build",
			caption: "Terminal",
		},
		{
			title: "Open the extensions page",
			body: "Go to this address in Chrome (or Edge, Brave, Arc) and switch on Developer mode in the top-right corner.",
			code: "chrome://extensions",
			caption: "Address bar",
		},
		{
			title: "Load unpacked",
			body: "Click Load unpacked and choose this folder inside the repo.",
			code: "apps/extension/.output/chrome-mv3",
			caption: "Folder",
		},
		{
			title: "Sign in",
			body: "Open the extension's side panel and sign in with your open-vidiq account. Nothing runs until you do.",
			code: null,
			caption: null,
		},
	];

	return (
		<section
			id="install"
			aria-labelledby="install-heading"
			className="scroll-mt-20 border-b"
		>
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 md:py-20">
				<SectionHeading
					id="install-heading"
					eyebrow="Install"
					title="Up and running in two minutes"
				>
					open-vidiq isn't on the Chrome Web Store yet, so you build it
					yourself. Pin it from the puzzle-piece menu, sign in, open YouTube,
					and the badges appear. Add an AI provider in the settings whenever you
					like.
				</SectionHeading>
				<ol className="grid gap-6 md:grid-cols-2">
					{steps.map((step, i) => (
						<li key={step.title} className="flex gap-4">
							<span
								aria-hidden="true"
								className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center text-xs font-semibold tabular-nums"
							>
								{i + 1}
							</span>
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<h3 className="text-sm font-semibold">{step.title}</h3>
								<p className="text-muted-foreground text-xs leading-relaxed">
									{step.body}
								</p>
								{step.code && (
									<CodeBlock
										code={step.code}
										caption={step.caption ?? undefined}
									/>
								)}
							</div>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}

function PrivacySection() {
	return (
		<section
			id="privacy"
			aria-labelledby="privacy-heading"
			className="scroll-mt-20"
		>
			<div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-16 md:py-20">
				<SectionHeading
					id="privacy-heading"
					eyebrow="Privacy"
					title="Crowdsourced stats, nothing personal"
				>
					You need a free account to use open-vidiq, but the stats you share are
					not tied to it. View history and trends exist because signed-in
					extension users share the public numbers they already see on YouTube;
					the server checks that an upload comes from a signed-in account, then
					stores it without any user ID. Unlisted and private videos are never
					uploaded. The exact payload is defined in{" "}
					<code className="text-foreground font-mono text-xs">
						packages/shared/src/api.ts
					</code>
					, so you can read what's sent.
				</SectionHeading>
				<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
					<PrivacyList
						title="Stored with your account"
						tone="account"
						items={ACCOUNT_DATA}
						footnote="Delete your account from the dashboard to remove all of it."
					/>
					<PrivacyList
						title="Shared with the stats server"
						tone="shared"
						items={SHARED_DATA}
						footnote="Only public numbers anyone can see on YouTube, never linked to your account."
					/>
					<PrivacyList
						title="Never uploaded"
						tone="private"
						items={NEVER_SHARED}
						footnote="AI features talk directly to the provider you configure."
					/>
				</div>
			</div>
		</section>
	);
}

function PrivacyList({
	title,
	tone,
	items,
	footnote,
}: {
	title: string;
	tone: "account" | "shared" | "private";
	items: string[];
	footnote: string;
}) {
	const Icon = tone === "private" ? X : Check;
	return (
		<div className="bg-card ring-foreground/10 flex flex-col gap-4 p-5 ring-1">
			<h3 className="flex items-center gap-2 text-sm font-semibold">
				{tone === "account" ? (
					<UserRound className="size-4" aria-hidden="true" />
				) : tone === "shared" ? (
					<ChartLine
						className="size-4 text-[var(--chart-2)]"
						aria-hidden="true"
					/>
				) : (
					<Lock
						className="size-4 text-emerald-600 dark:text-emerald-400"
						aria-hidden="true"
					/>
				)}
				{title}
			</h3>
			<ul className="flex flex-col gap-2 text-xs">
				{items.map((item) => (
					<li key={item} className="flex gap-2">
						<Icon
							aria-hidden="true"
							className={cn(
								"mt-0.5 size-3.5 shrink-0",
								"text-muted-foreground",
							)}
						/>
						<span>{item}</span>
					</li>
				))}
			</ul>
			<p className="text-muted-foreground mt-auto border-t pt-3 text-[11px]">
				{footnote}
			</p>
		</div>
	);
}
