import {
	formatCompact,
	formatNumber,
	formatRelative,
	type TrendingVideo,
	thumbnailUrl,
	videoUrl,
} from "@growtube/shared";
import { Skeleton } from "@growtube/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useState } from "react";

interface TrendingCardProps {
	video: TrendingVideo;
	rank: number;
	/** Current time, passed in so every card on a board agrees. */
	now: number;
}

export function TrendingCard({ video, rank, now }: TrendingCardProps) {
	const [thumbFailed, setThumbFailed] = useState(false);
	const title = video.title?.trim() || "Untitled video";
	const historyState = {
		channelId: video.channelId ?? undefined,
		channelTitle: video.channelTitle ?? undefined,
		videoTitle: video.title ?? undefined,
	};

	return (
		<article className="group bg-card ring-foreground/8 hover:ring-foreground/15 focus-within:ring-ring/60 relative flex min-w-0 flex-col overflow-hidden rounded-xl shadow-xs ring-1 transition duration-200 ease-out focus-within:ring-2 hover:shadow-md motion-safe:hover:-translate-y-0.5">
			<div className="bg-muted relative aspect-video overflow-hidden">
				{!thumbFailed && (
					<img
						src={thumbnailUrl(video.videoId, "mqdefault")}
						alt=""
						loading="lazy"
						decoding="async"
						referrerPolicy="no-referrer"
						onError={() => setThumbFailed(true)}
						className="size-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
					/>
				)}
				<span className="absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums backdrop-blur-sm">
					#{rank}
				</span>
				<span className="absolute top-2 right-2 rounded-md bg-[var(--chart-2)] px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums shadow-sm">
					{formatCompact(video.vph)} VPH
				</span>
				{video.isShort && (
					<span className="absolute bottom-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
						Short
					</span>
				)}
			</div>

			<div className="flex flex-1 flex-col gap-2 p-3">
				<h3 className="line-clamp-2 text-sm leading-snug font-medium">
					<Link
						to="/video/$videoId"
						params={{ videoId: video.videoId }}
						state={historyState}
						className="outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
						title={title}
					>
						{title}
					</Link>
				</h3>

				<div className="text-muted-foreground flex min-w-0 items-center justify-between gap-2 text-xs">
					{video.channelId ? (
						<Link
							to="/channel/$channelId"
							params={{ channelId: video.channelId }}
							state={historyState}
							className="hover:text-foreground relative z-10 truncate hover:underline"
						>
							{video.channelTitle ?? "View channel"}
						</Link>
					) : (
						<span className="truncate">
							{video.channelTitle ?? "Unknown channel"}
						</span>
					)}
					<a
						href={videoUrl(video.videoId)}
						target="_blank"
						rel="noreferrer"
						className="hover:text-foreground hover:bg-muted relative z-10 -m-1 shrink-0 rounded-md p-1 transition-colors"
						aria-label={`Watch “${title}” on YouTube`}
						title="Watch on YouTube"
					>
						<ExternalLink className="size-3.5" aria-hidden="true" />
					</a>
				</div>

				<dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-2 text-xs">
					<div className="min-w-0">
						<dt className="text-muted-foreground text-[10px] tracking-wide uppercase">
							Views
						</dt>
						<dd
							className="truncate font-medium tabular-nums"
							title={formatNumber(video.views)}
						>
							{formatCompact(video.views)}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-muted-foreground text-[10px] tracking-wide uppercase">
							VPH
						</dt>
						<dd
							className="truncate font-medium tabular-nums"
							title={`${formatNumber(video.vph)} views per hour`}
						>
							{formatCompact(video.vph)}
						</dd>
					</div>
					<div className="min-w-0">
						<dt className="text-muted-foreground text-[10px] tracking-wide uppercase">
							Age
						</dt>
						<dd
							className="truncate font-medium"
							title={
								video.publishedAt
									? new Date(video.publishedAt).toLocaleString()
									: undefined
							}
						>
							{video.publishedAt ? formatRelative(video.publishedAt, now) : "—"}
						</dd>
					</div>
				</dl>
			</div>
		</article>
	);
}

export function TrendingCardSkeleton() {
	return (
		<div
			className="bg-card ring-foreground/8 flex flex-col overflow-hidden rounded-xl shadow-xs ring-1"
			aria-hidden="true"
		>
			{/* Flush with the card's clipped top edge, like the thumbnail. */}
			<Skeleton className="aspect-video w-full rounded-none" />
			<div className="flex flex-col gap-2 p-3">
				<Skeleton className="h-4 w-11/12 rounded-md" />
				<Skeleton className="h-4 w-2/3 rounded-md" />
				<Skeleton className="h-3 w-1/3 rounded-md" />
				<div className="mt-1 grid grid-cols-3 gap-2 border-t pt-2">
					<Skeleton className="h-7 rounded-md" />
					<Skeleton className="h-7 rounded-md" />
					<Skeleton className="h-7 rounded-md" />
				</div>
			</div>
		</div>
	);
}
