import { buttonVariants } from "@open-vidiq/ui/components/button";
import { Toaster } from "@open-vidiq/ui/components/sonner";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { SearchX } from "lucide-react";

import Footer from "@/components/footer";
import Header from "@/components/header";
import { EmptyState } from "@/components/states";
import { ThemeProvider } from "@/components/theme-provider";

import "../index.css";

export type RouterAppContext = Record<string, never>;

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	notFoundComponent: NotFound,
	head: () => ({
		meta: [
			{
				title: "open-vidiq · The free YouTube growth toolkit",
			},
			{
				name: "description",
				content:
					"Free, open-source YouTube growth toolkit: VPH, outlier scores, SEO, keyword research, trends and an AI coach. No plans, no credits, no limits.",
			},
		],
	}),
});

function RootComponent() {
	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange
				storageKey="vite-ui-theme"
			>
				<div className="flex min-h-svh flex-col">
					<Header />
					<main className="flex flex-1 flex-col">
						<Outlet />
					</main>
					<Footer />
				</div>
				<Toaster richColors />
			</ThemeProvider>
			{import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
		</>
	);
}

function NotFound() {
	return (
		<div className="mx-auto w-full max-w-xl px-4 py-16">
			<EmptyState
				icon={SearchX}
				title="Page not found"
				description="That page doesn't exist. Try the trending board or look up a video."
			>
				<Link to="/trending" className={buttonVariants({ variant: "default" })}>
					Browse trending
				</Link>
				<Link to="/lookup" className={buttonVariants({ variant: "outline" })}>
					Look up a video
				</Link>
			</EmptyState>
		</div>
	);
}
