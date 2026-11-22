import { MCP_API_KEY_HEADER } from "@growtube/shared/auth";
import { Button } from "@growtube/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@growtube/ui/components/card";
import { Input } from "@growtube/ui/components/input";
import { Label } from "@growtube/ui/components/label";
import { cn } from "@growtube/ui/lib/utils";
import { createFileRoute } from "@tanstack/react-router";
import {
	CircleCheck,
	Info,
	LoaderCircle,
	Plug,
	TriangleAlert,
} from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { ApiKeysCard } from "@/components/api-keys";
import { CodeBlock, CopyField } from "@/components/copy-button";
import { IS_LOCAL_SERVER, MCP_URL } from "@/lib/api";
import { type McpProbeResult, probeMcp } from "@/lib/mcp-probe";

export const Route = createFileRoute("/_auth/mcp")({
	head: () => ({ meta: [{ title: "MCP for AI assistants · GrowTube" }] }),
	component: McpPage,
});

interface ToolDoc {
	name: string;
	description: string;
	args: { name: string; detail: string }[];
}

const TOOLS: ToolDoc[] = [
	{
		name: "get_video_stats",
		description:
			"Latest public numbers for one video: views, likes, comments, publish date, duration and views per hour.",
		args: [{ name: "videoId", detail: "video ID or any YouTube video URL" }],
	},
	{
		name: "get_video_history",
		description:
			"Views, likes and comments over time for a video, the same data as the chart on the video page.",
		args: [
			{ name: "videoId", detail: "video ID or any YouTube video URL" },
			{
				name: "range",
				detail: `"24h" | "7d" | "28d" (first N after publishing) | "all"`,
			},
		],
	},
	{
		name: "get_channel_history",
		description:
			"Daily subscribers, total views and video count for a channel.",
		args: [
			{
				name: "channelId",
				detail: "channel ID (UC…), @handle or channel URL",
			},
		],
	},
	{
		name: "get_trending",
		description:
			"The fastest-growing videos of the last 24 hours or 7 days, ranked by views per hour.",
		args: [
			{ name: "window", detail: `"24h" | "7d"` },
			{ name: "type", detail: `"all" | "long" | "short"` },
			{ name: "q", detail: "optional title filter" },
			{ name: "limit", detail: "how many videos to return" },
		],
	},
];

const EXAMPLE_PROMPTS = [
	"Which cooking Shorts are trending fastest this week, and what do their titles have in common?",
	"Chart the first 7 days of views for https://youtu.be/dQw4w9WgXcQ and tell me if it's still growing.",
	"How many subscribers did @RickAstleyYT gain in the last 28 days?",
	"Compare the views per hour of the top 5 trending long-form videos today.",
];

/** Placeholder shown in every snippet; users paste their own key. */
const KEY_PLACEHOLDER = "YOUR_API_KEY";
const KEY_HEADER = MCP_API_KEY_HEADER;

const claudeDesktopConfig = JSON.stringify(
	{
		mcpServers: {
			growtube: {
				command: "npx",
				args: [
					"-y",
					"mcp-remote",
					MCP_URL,
					"--header",
					`${KEY_HEADER}:\${GROWTUBE_API_KEY}`,
				],
				env: { GROWTUBE_API_KEY: KEY_PLACEHOLDER },
			},
		},
	},
	null,
	2,
);

const cursorConfig = JSON.stringify(
	{
		mcpServers: {
			growtube: {
				url: MCP_URL,
				headers: { [KEY_HEADER]: KEY_PLACEHOLDER },
			},
		},
	},
	null,
	2,
);

const vscodeConfig = JSON.stringify(
	{
		inputs: [
			{
				type: "promptString",
				id: "growtube-api-key",
				description: "GrowTube API key",
				password: true,
			},
		],
		servers: {
			growtube: {
				type: "http",
				url: MCP_URL,
				// biome-ignore lint/suspicious/noTemplateCurlyInString: VS Code's own input variable syntax
				headers: { [KEY_HEADER]: "${input:growtube-api-key}" },
			},
		},
	},
	null,
	2,
);

const claudeCodeCommand = `claude mcp add --transport http growtube ${MCP_URL} \\
  --header "${KEY_HEADER}: ${KEY_PLACEHOLDER}"`;

const headerExample = `${KEY_HEADER}: ${KEY_PLACEHOLDER}
# or
Authorization: Bearer ${KEY_PLACEHOLDER}`;

const curlExample = `curl -X POST ${MCP_URL} \\
  -H "Content-Type: application/json" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "${KEY_HEADER}: ${KEY_PLACEHOLDER}" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`;

function McpPage() {
	const { session } = Route.useRouteContext();
	// The key created on this visit, kept in memory only, to prefill the test.
	const [testKey, setTestKey] = useState("");

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 py-10">
			<header className="flex flex-col gap-3">
				<p className="text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-wider uppercase">
					<Plug className="size-3.5" aria-hidden="true" />
					Model Context Protocol
				</p>
				<h1 className="text-3xl font-semibold tracking-tight text-balance">
					Give your AI assistant YouTube stats
				</h1>
				<p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
					GrowTube exposes its crowdsourced video, channel and trending data as
					an MCP server. Connect Claude, Cursor, VS Code or any MCP client and
					ask questions in plain language. Each client signs in with an API key
					from your account. It's read-only public data with no quota.
				</p>
			</header>

			<section aria-labelledby="keys-heading" className="flex flex-col gap-3">
				<h2 id="keys-heading" className="text-lg font-semibold tracking-tight">
					API keys
				</h2>
				<ApiKeysCard userId={session.user.id} onCreated={setTestKey} />
			</section>

			<section
				aria-labelledby="endpoint-heading"
				className="flex flex-col gap-3"
			>
				<h2
					id="endpoint-heading"
					className="text-lg font-semibold tracking-tight"
				>
					Endpoint
				</h2>
				<CopyField value={MCP_URL} label="Copy MCP endpoint URL" />
				<p className="text-muted-foreground text-xs">
					Transport:{" "}
					<strong className="text-foreground font-medium">
						Streamable HTTP
					</strong>{" "}
					· Authentication: your API key in the{" "}
					<code className="text-foreground font-mono">{KEY_HEADER}</code>{" "}
					header, or as{" "}
					<code className="text-foreground font-mono">
						Authorization: Bearer
					</code>
					. Requests without a valid key get HTTP 401.
				</p>
				<CodeBlock caption="Request headers" code={headerExample} />
				{IS_LOCAL_SERVER && (
					<Callout tone="warning" title="This URL only works on your computer">
						Clients running somewhere else need a public HTTPS URL. Deploy the
						worker (<code className="font-mono">pnpm run deploy</code>) or
						expose it with a tunnel such as{" "}
						<code className="font-mono">
							cloudflared tunnel --url http://localhost:3000
						</code>
						. Claude Desktop (via mcp-remote), Claude Code, Cursor and VS Code
						on this computer can use localhost directly.
					</Callout>
				)}
				<ConnectionTest apiKey={testKey} onApiKeyChange={setTestKey} />
			</section>

			<section
				aria-labelledby="clients-heading"
				className="flex flex-col gap-4"
			>
				<h2
					id="clients-heading"
					className="text-lg font-semibold tracking-tight"
				>
					Connect a client
				</h2>
				<p className="text-muted-foreground text-xs">
					Replace{" "}
					<code className="text-foreground font-mono">{KEY_PLACEHOLDER}</code>{" "}
					with a key from above. Menu names change between app releases; if a
					step doesn't match, look for "MCP" in the app's settings.
				</p>

				<ClientCard
					title="Claude Desktop"
					description="Uses mcp-remote to bridge the desktop app to the HTTP endpoint and send your key."
				>
					<Steps
						items={[
							<>
								Open <strong>Settings → Developer → Edit Config</strong> and add
								the block below to{" "}
								<code className="font-mono">claude_desktop_config.json</code>{" "}
								(needs Node.js).
							</>,
							<>
								Put your key in <code className="font-mono">env</code>.
								mcp-remote fills it into the{" "}
								<code className="font-mono">{KEY_HEADER}</code> header, so the
								key never sits inside the command arguments.
							</>,
							<>Restart Claude Desktop. GrowTube shows up in the tools menu.</>,
						]}
					/>
					<CodeBlock
						caption="claude_desktop_config.json"
						code={claudeDesktopConfig}
					/>
				</ClientCard>

				<ClientCard
					title="Claude Code"
					description="One command, works with localhost."
				>
					<CodeBlock caption="Terminal" code={claudeCodeCommand} />
				</ClientCard>

				<ClientCard
					title="Cursor, VS Code and others"
					description="Any client that speaks streamable HTTP and can send a header."
				>
					<div className="grid gap-3 md:grid-cols-2">
						<CodeBlock caption="~/.cursor/mcp.json" code={cursorConfig} />
						<CodeBlock caption=".vscode/mcp.json" code={vscodeConfig} />
					</div>
					<p className="text-muted-foreground text-xs">
						VS Code asks for the key the first time it connects and keeps it in
						its secret storage, so it isn't saved in the file.
					</p>
				</ClientCard>

				<Callout tone="info" title="Claude.ai and ChatGPT connectors">
					Their custom connectors sign in with OAuth and can't send an API key
					header, so they can't connect to GrowTube yet. Use Claude Desktop,
					Claude Code or another client above instead.
				</Callout>
			</section>

			<section aria-labelledby="tools-heading" className="flex flex-col gap-4">
				<h2 id="tools-heading" className="text-lg font-semibold tracking-tight">
					Tools
				</h2>
				<p className="text-muted-foreground text-xs">
					Arguments mirror the REST API. Your assistant reads the full JSON
					schema from the server, so you never have to type these yourself.
				</p>
				<div className="grid gap-3 md:grid-cols-2">
					{TOOLS.map((tool) => (
						<Card key={tool.name} size="sm">
							<CardHeader>
								<CardTitle>
									<code className="font-mono">{tool.name}</code>
								</CardTitle>
								<CardDescription>{tool.description}</CardDescription>
							</CardHeader>
							<CardContent>
								<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
									{tool.args.map((arg) => (
										<div key={arg.name} className="contents">
											<dt className="font-mono">{arg.name}</dt>
											<dd className="text-muted-foreground">{arg.detail}</dd>
										</div>
									))}
								</dl>
							</CardContent>
						</Card>
					))}
				</div>
			</section>

			<section
				aria-labelledby="prompts-heading"
				className="flex flex-col gap-4"
			>
				<h2
					id="prompts-heading"
					className="text-lg font-semibold tracking-tight"
				>
					Things to ask
				</h2>
				<ul className="grid gap-2">
					{EXAMPLE_PROMPTS.map((prompt) => (
						<li
							key={prompt}
							className="bg-muted/40 border-border/60 relative rounded-xl border py-2.5 pr-3.5 pl-5 text-sm before:absolute before:inset-y-2.5 before:left-2 before:w-[3px] before:rounded-full before:bg-[var(--chart-2)]"
						>
							{prompt}
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="debug-heading" className="flex flex-col gap-4">
				<h2 id="debug-heading" className="text-lg font-semibold tracking-tight">
					Test from the command line
				</h2>
				<p className="text-muted-foreground text-xs">
					The MCP Inspector gives you a UI to call each tool: run it, pick
					"Streamable HTTP", paste the endpoint and add your key as a{" "}
					<code className="font-mono">{KEY_HEADER}</code> header (or as a bearer
					token) in its authentication settings.
				</p>
				<CodeBlock
					caption="Terminal"
					code="npx @modelcontextprotocol/inspector"
				/>
				<CodeBlock caption="Raw request" code={curlExample} />
			</section>
		</div>
	);
}

function ClientCard({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm">{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">{children}</CardContent>
		</Card>
	);
}

function Steps({ items }: { items: ReactNode[] }) {
	return (
		<ol className="flex flex-col gap-2 text-xs leading-relaxed">
			{items.map((item, i) => (
				<li key={i} className="flex gap-2.5">
					<span
						aria-hidden="true"
						className="bg-muted flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium tabular-nums"
					>
						{i + 1}
					</span>
					<span className="pt-0.5">{item}</span>
				</li>
			))}
		</ol>
	);
}

function Callout({
	tone,
	title,
	children,
}: {
	tone: "warning" | "info" | "success";
	title: string;
	children: ReactNode;
}) {
	const Icon =
		tone === "warning"
			? TriangleAlert
			: tone === "success"
				? CircleCheck
				: Info;
	return (
		<div
			className={cn(
				"flex gap-3 rounded-xl border px-3.5 py-3 text-xs leading-relaxed",
				tone === "warning" && "border-amber-500/30 bg-amber-500/10",
				tone === "success" && "border-emerald-500/30 bg-emerald-500/10",
				tone === "info" && "bg-muted/40",
			)}
		>
			<Icon
				aria-hidden="true"
				className={cn(
					"mt-0.5 size-4 shrink-0",
					tone === "warning" && "text-amber-700 dark:text-amber-400",
					tone === "success" && "text-emerald-700 dark:text-emerald-400",
				)}
			/>
			<div className="flex min-w-0 flex-col gap-1">
				<span className="font-medium">{title}</span>
				<div className="text-muted-foreground">{children}</div>
			</div>
		</div>
	);
}

type ProbeState =
	| { status: "idle" }
	| { status: "running" }
	| { status: "ok"; result: McpProbeResult }
	| { status: "error"; message: string };

function ConnectionTest({
	apiKey,
	onApiKeyChange,
}: {
	apiKey: string;
	onApiKeyChange: (value: string) => void;
}) {
	const inputId = useId();
	const [state, setState] = useState<ProbeState>({ status: "idle" });
	const key = apiKey.trim();

	async function run(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!key || state.status === "running") return;
		setState({ status: "running" });
		try {
			setState({ status: "ok", result: await probeMcp(key) });
		} catch (error) {
			setState({
				status: "error",
				message:
					error instanceof Error
						? error.message
						: "The connection test failed.",
			});
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<form
				onSubmit={(event) => void run(event)}
				className="flex flex-col gap-2"
				noValidate
			>
				<Label htmlFor={inputId}>Test a key</Label>
				<div className="flex gap-2">
					<Input
						id={inputId}
						type="password"
						value={apiKey}
						onChange={(event) => onApiKeyChange(event.target.value)}
						placeholder="Paste an API key"
						autoComplete="off"
						spellCheck={false}
						className="min-w-0 flex-1 font-mono"
					/>
					<Button
						type="submit"
						variant="outline"
						disabled={!key || state.status === "running"}
					>
						{state.status === "running" ? (
							<LoaderCircle className="animate-spin" aria-hidden="true" />
						) : (
							<Plug aria-hidden="true" />
						)}
						Test connection
					</Button>
				</div>
				<p className="text-muted-foreground text-xs">
					The key is sent only to the MCP endpoint above and isn't saved.
				</p>
			</form>
			<div aria-live="polite">
				{state.status === "ok" && (
					<Callout
						tone="success"
						title={`Connected${state.result.serverName ? ` to ${state.result.serverName}` : ""}${state.result.serverVersion ? ` ${state.result.serverVersion}` : ""}`}
					>
						{state.result.tools ? (
							<>
								{state.result.tools.length} tool
								{state.result.tools.length === 1 ? "" : "s"} available:{" "}
								{state.result.tools.map((tool, i) => (
									<span key={tool.name}>
										{i > 0 && ", "}
										<code className="text-foreground font-mono">
											{tool.name}
										</code>
									</span>
								))}
							</>
						) : (
							"The server answered. Its tool list needs a session, so check it from your MCP client."
						)}
						{state.result.protocolVersion && (
							<> · protocol {state.result.protocolVersion}</>
						)}
					</Callout>
				)}
				{state.status === "error" && (
					<Callout tone="warning" title="Connection test failed">
						{state.message}
					</Callout>
				)}
			</div>
		</div>
	);
}
