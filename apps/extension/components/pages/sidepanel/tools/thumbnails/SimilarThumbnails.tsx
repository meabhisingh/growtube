/** Grid of the top results' thumbnails for a query, with views/VPH/outlier. */
import { formatCompact, formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Skeleton } from "@growtube/ui/components/skeleton";
import { LayoutGrid, MonitorPlay } from "lucide-react";
import { useEffect, useState } from "react";
import { yt } from "@/lib/client";
import { useOutliers } from "../../../baselines";
import { useAsyncTask } from "../../../hooks";
import { OutlierBadge, VphBadge } from "../../../ui/badges";
import { SearchForm } from "../../../ui/controls";
import { EmptyState, ErrorNotice } from "../../../ui/feedback";
import { Thumb } from "../../../ui/video";
import { openLink, vphOf, watchUrl } from "../../../utils";
import { usePanel } from "../../nav";

export function SimilarThumbnails({
	intent,
}: {
	intent: { id: number; query: string } | null;
}) {
	const { activeTab } = usePanel();
	const [query, setQuery] = useState("");
	const search = useAsyncTask((q: string) =>
		yt.search(q, { limit: 30, type: "video" }),
	);
	const fromTab = useAsyncTask(async (videoId: string) => {
		const v = await yt.getVideoDetails(videoId, { level: "basic" });
		setQuery(v.title);
		await search.run(v.title);
		return v.title;
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (!intent) return;
		setQuery(intent.query);
		void search.run(intent.query);
	}, [intent?.id]);

	const results = search.data?.results ?? [];
	const outliers = useOutliers(
		results.map((r) => ({
			videoId: r.videoId,
			channelId: r.channelId,
			views: r.views,
			isShort: r.isShort,
		})),
	);

	return (
		<div className="flex flex-col gap-3">
			<SearchForm
				value={query}
				onChange={setQuery}
				onSubmit={(q) => void search.run(q)}
				placeholder="Topic or title, e.g. iPhone 17 review"
				inputLabel="Thumbnail search"
				loading={search.loading}
			/>
			{activeTab.videoId ? (
				<Button
					size="xs"
					variant="outline"
					className="self-start"
					disabled={fromTab.loading || search.loading}
					onClick={() =>
						activeTab.videoId && void fromTab.run(activeTab.videoId)
					}
				>
					<MonitorPlay /> Use this tab's video title
				</Button>
			) : null}
			{search.error || fromTab.error ? (
				<ErrorNotice
					error={search.error ?? fromTab.error}
					onRetry={() => query.trim() && void search.run(query.trim())}
				/>
			) : search.loading && !search.data ? (
				<Grid>
					{Array.from({ length: 8 }, (_, i) => (
						<div key={i} className="flex flex-col gap-1.5">
							<Skeleton className="aspect-video w-full rounded-lg" />
							<Skeleton className="h-3 w-5/6 rounded-full" />
							<Skeleton className="h-2.5 w-1/2 rounded-full" />
						</div>
					))}
				</Grid>
			) : !search.data ? (
				<EmptyState icon={LayoutGrid} title="See what already wins the click">
					Search a topic to compare the thumbnails ranking for it, with their
					views per hour and outlier scores. Unlimited searches.
				</EmptyState>
			) : results.length === 0 ? (
				<div className="text-muted-foreground py-6 text-center text-xs">
					No results.
				</div>
			) : (
				<Grid>
					{results.map((r) => (
						<button
							key={r.videoId}
							type="button"
							onClick={(e) => openLink(watchUrl(r.videoId), e)}
							onAuxClick={(e) => openLink(watchUrl(r.videoId), e)}
							className="group focus-visible:ring-ring/60 flex flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2"
						>
							<Thumb
								videoId={r.videoId}
								src={r.thumbnail}
								durationSec={r.durationSec}
								isShort={r.isShort}
								isLive={r.isLive}
								className="w-full transition-transform duration-200 ease-out group-hover:scale-[1.02]"
							/>
							<span className="ovq-clamp-2 group-hover:text-brand text-[11px] leading-snug font-medium transition-colors duration-150">
								{r.title}
							</span>
							<span className="text-muted-foreground truncate text-[10px]">
								{[
									r.channelTitle,
									r.views != null ? `${formatCompact(r.views)} views` : null,
									r.publishedAt
										? formatRelative(r.publishedAt)
										: r.publishedText,
								]
									.filter(Boolean)
									.join(" · ")}
							</span>
							<span className="flex flex-wrap gap-1">
								<VphBadge vph={vphOf(r.views, r.publishedAt)} />
								<OutlierBadge
									score={outliers[r.videoId]}
									loading={outliers[r.videoId] === undefined && !!r.channelId}
								/>
							</span>
						</button>
					))}
				</Grid>
			)}
		</div>
	);
}

function Grid({ children }: { children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-2.5 gap-y-4">
			{children}
		</div>
	);
}
