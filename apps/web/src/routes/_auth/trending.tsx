import { formatRelative, trendingQuery } from "@open-vidiq/shared";
import { Button, buttonVariants } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { cn } from "@open-vidiq/ui/lib/utils";
import {
	createFileRoute,
	Link,
	stripSearchParams,
} from "@tanstack/react-router";
import {
	Flame,
	LoaderCircle,
	RefreshCw,
	Search,
	SearchX,
	X,
} from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { z } from "zod";

import { Segmented, type SegmentedOption } from "@/components/segmented";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states";
import { TrendingCard, TrendingCardSkeleton } from "@/components/trending-card";
import { getTrending } from "@/lib/api";
import { useApi } from "@/lib/use-api";

const PAGE_SIZE = 48;

const searchDefaults = { window: "24h", type: "all" } as const;

const trendingSearchSchema = z.object({
	window: trendingQuery.shape.window.catch(searchDefaults.window),
	type: trendingQuery.shape.type.catch(searchDefaults.type),
	q: trendingQuery.shape.q.catch(undefined),
});

type TrendingSearch = z.output<typeof trendingSearchSchema>;

export const Route = createFileRoute("/_auth/trending")({
	validateSearch: trendingSearchSchema,
	search: { middlewares: [stripSearchParams(searchDefaults)] },
	head: () => ({ meta: [{ title: "Trending on YouTube · open-vidiq" }] }),
	component: TrendingPage,
});

const windowOptions: readonly SegmentedOption<TrendingSearch["window"]>[] = [
	{ value: "24h", label: "24 hours" },
	{ value: "7d", label: "7 days" },
];

const typeOptions: readonly SegmentedOption<TrendingSearch["type"]>[] = [
	{ value: "all", label: "All" },
	{ value: "long", label: "Long-form" },
	{ value: "short", label: "Shorts" },
];

function TrendingPage() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const { window: win, type, q } = search;

	const key = `trending:${win}:${type}:${q ?? ""}`;
	const { data, error, isPending, isFetching, refetch } = useApi(
		key,
		(signal) => getTrending({ window: win, type, q, limit: PAGE_SIZE }, signal),
		{ keepPrevious: true, staleMs: 60_000 },
	);

	const setSearch = useCallback(
		(patch: Partial<TrendingSearch>) => {
			navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
		},
		[navigate],
	);

	const onQueryCommit = useCallback(
		(next: string | undefined) => setSearch({ q: next }),
		[setSearch],
	);

	const now = data ? Date.parse(data.generatedAt) || Date.now() : Date.now();
	const videos = data?.videos ?? [];

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
			<div className="flex flex-col gap-2">
				<h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
					<Flame className="size-6 text-[var(--chart-2)]" aria-hidden="true" />
					Trending now
				</h1>
				<p className="text-muted-foreground max-w-2xl text-sm">
					The fastest-growing videos by views per hour, from public stats that
					open-vidiq users see while they browse YouTube. Free, unlimited,
					updated continuously.
				</p>
			</div>

			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex flex-wrap items-center gap-2">
					<Segmented
						label="Time window"
						value={win}
						options={windowOptions}
						onChange={(value) => setSearch({ window: value })}
					/>
					<Segmented
						label="Video type"
						value={type}
						options={typeOptions}
						onChange={(value) => setSearch({ type: value })}
					/>
				</div>
				<SearchBox value={q} onCommit={onQueryCommit} />
			</div>

			<div className="text-muted-foreground flex min-h-5 flex-wrap items-center justify-between gap-2 text-xs">
				<span aria-live="polite">
					{data && !isPending
						? `${videos.length} video${videos.length === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""} · updated ${formatRelative(data.generatedAt)}`
						: isPending
							? "Loading trending videos…"
							: null}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onClick={refetch}
					disabled={isFetching}
					aria-label="Refresh trending videos"
				>
					{isFetching ? (
						<LoaderCircle className="animate-spin" aria-hidden="true" />
					) : (
						<RefreshCw aria-hidden="true" />
					)}
					Refresh
				</Button>
			</div>

			{error && data && <StaleBanner error={error} onRetry={refetch} />}

			{isPending ? (
				<div
					className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
					aria-busy="true"
				>
					{Array.from({ length: 8 }, (_, i) => (
						<TrendingCardSkeleton key={i} />
					))}
				</div>
			) : error && !data ? (
				<ErrorState
					title="Couldn't load trending videos"
					error={error}
					onRetry={refetch}
					retrying={isFetching}
				/>
			) : videos.length === 0 ? (
				q ? (
					<EmptyState
						icon={SearchX}
						title={`No trending videos match “${q}”`}
						description="Try a shorter search, another time window, or clear the filters."
					>
						<Button
							variant="outline"
							onClick={() => setSearch({ q: undefined })}
						>
							Clear search
						</Button>
					</EmptyState>
				) : (
					<EmptyState
						icon={Flame}
						title="Nothing trending here yet"
						description="The board fills up as people browse YouTube with the open-vidiq extension. Install it and every video you see helps."
					>
						<Link
							to="/"
							hash="install"
							className={buttonVariants({ variant: "default" })}
						>
							Install the extension
						</Link>
						{(win !== "7d" || type !== "all") && (
							<Button
								variant="outline"
								onClick={() => setSearch({ window: "7d", type: "all" })}
							>
								Show all of the last 7 days
							</Button>
						)}
					</EmptyState>
				)
			) : (
				<ol
					className={cn(
						"grid grid-cols-1 gap-4 transition-opacity sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
						isFetching && "opacity-60",
					)}
					aria-busy={isFetching}
				>
					{videos.map((video, i) => (
						<li key={video.videoId} className="flex">
							<TrendingCard video={video} rank={i + 1} now={now} />
						</li>
					))}
				</ol>
			)}
		</div>
	);
}

interface SearchBoxProps {
	value: string | undefined;
	onCommit: (value: string | undefined) => void;
}

/** Title filter that writes to the URL after a short pause (or on Enter). */
function SearchBox({ value, onCommit }: SearchBoxProps) {
	const [draft, setDraft] = useState(value ?? "");
	const committed = useRef(value ?? "");

	// Sync when the URL changes from elsewhere (back button, "Clear search").
	useEffect(() => {
		const next = value ?? "";
		if (next !== committed.current) {
			committed.current = next;
			setDraft(next);
		}
	}, [value]);

	const commit = useCallback(
		(raw: string) => {
			const next = raw.trim().slice(0, 100);
			if (next === committed.current) return;
			committed.current = next;
			onCommit(next || undefined);
		},
		[onCommit],
	);

	useEffect(() => {
		const id = window.setTimeout(() => commit(draft), 350);
		return () => window.clearTimeout(id);
	}, [draft, commit]);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		commit(draft);
	}

	return (
		<search className="w-full lg:w-72">
			<form onSubmit={onSubmit} className="relative">
				<label htmlFor="trending-search" className="sr-only">
					Filter by title
				</label>
				<Search
					aria-hidden="true"
					className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
				/>
				<Input
					id="trending-search"
					type="search"
					value={draft}
					maxLength={100}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Filter by title…"
					className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
				/>
				{draft && (
					<button
						type="button"
						onClick={() => {
							setDraft("");
							commit("");
						}}
						className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 p-1"
						aria-label="Clear search"
					>
						<X className="size-3.5" aria-hidden="true" />
					</button>
				)}
			</form>
		</search>
	);
}
