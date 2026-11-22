import { createFileRoute, Link } from "@tanstack/react-router";
import { Hash, Link2, Search, Users } from "lucide-react";

import { LookupForm } from "@/components/lookup-form";

export const Route = createFileRoute("/_auth/lookup")({
	head: () => ({
		meta: [{ title: "Look up a video or channel · GrowTube" }],
	}),
	component: LookupPage,
});

const formats = [
	{
		icon: Link2,
		title: "Video links",
		examples: [
			"youtube.com/watch?v=…",
			"youtu.be/…",
			"youtube.com/shorts/…",
			"youtube.com/live/…",
		],
	},
	{ icon: Hash, title: "Video IDs", examples: ["dQw4w9WgXcQ"] },
	{
		icon: Users,
		title: "Channel links and IDs",
		examples: [
			"youtube.com/channel/UC…",
			"UCuAXFkgsw1L7xaCfnd5JJOw",
			"@handle or youtube.com/@handle",
		],
	},
	{
		icon: Search,
		title: "Anything else",
		examples: ["Searches the trending board by title"],
	},
] as const;

function LookupPage() {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-12 md:py-20">
			<div className="flex flex-col gap-3 text-center">
				<h1 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
					Look up any video or channel
				</h1>
				<p className="text-muted-foreground text-sm text-balance">
					Views over time, views per hour, engagement and subscriber history
					from GrowTube's crowdsourced stats. Free and unlimited.
				</p>
			</div>

			<LookupForm size="lg" autoFocus />

			<section
				aria-labelledby="formats-heading"
				className="flex flex-col gap-4"
			>
				<h2
					id="formats-heading"
					className="text-muted-foreground text-xs font-medium tracking-wider uppercase"
				>
					What you can paste
				</h2>
				<ul className="grid gap-3 sm:grid-cols-2">
					{formats.map(({ icon: Icon, title, examples }) => (
						<li
							key={title}
							className="bg-card ring-foreground/8 flex gap-3 rounded-xl p-4 shadow-xs ring-1"
						>
							<Icon
								className="text-muted-foreground mt-0.5 size-4 shrink-0"
								aria-hidden="true"
							/>
							<div className="flex min-w-0 flex-col gap-1">
								<span className="text-sm font-medium">{title}</span>
								{examples.map((example) => (
									<code
										key={example}
										className="text-muted-foreground truncate font-mono text-xs"
									>
										{example}
									</code>
								))}
							</div>
						</li>
					))}
				</ul>
				<p className="text-muted-foreground text-xs">
					@handles work for channels GrowTube has already seen (any extension
					user visited them). Legacy /c/ and /user/ links aren't supported: open
					the channel on YouTube and copy its channel ID, or browse the{" "}
					<Link
						to="/trending"
						className="hover:text-foreground underline underline-offset-4"
					>
						trending board
					</Link>
					.
				</p>
			</section>
		</div>
	);
}
