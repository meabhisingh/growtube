/** Video thumbnails, rows and channel avatars. */
import {
	formatCompact,
	formatDuration,
	formatRelative,
} from "@open-vidiq/shared/format";
import { thumbnailUrl } from "@open-vidiq/shared/youtube";
import { cn } from "@open-vidiq/ui/lib/utils";
import { UserRound } from "lucide-react";
import { type ReactNode, useState } from "react";

import { openLink, watchUrl } from "../utils";

export function Thumb({
	videoId,
	src,
	durationSec,
	isShort,
	isLive,
	className,
	alt = "",
}: {
	videoId: string;
	src?: string | null;
	durationSec?: number | null;
	isShort?: boolean;
	isLive?: boolean;
	className?: string;
	alt?: string;
}) {
	const [failed, setFailed] = useState(false);
	const url = !src || failed ? thumbnailUrl(videoId, "mqdefault") : src;
	return (
		<div
			className={cn(
				"bg-muted relative aspect-video shrink-0 overflow-hidden",
				className,
			)}
		>
			<img
				src={url}
				alt={alt}
				loading="lazy"
				decoding="async"
				referrerPolicy="no-referrer"
				onError={() => setFailed(true)}
				className="size-full object-cover"
			/>
			{isLive ? (
				<span className="absolute right-1 bottom-1 bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white">
					LIVE
				</span>
			) : isShort ? (
				<span className="absolute right-1 bottom-1 bg-black/80 px-1 text-[10px] leading-4 font-semibold text-white">
					SHORT
				</span>
			) : durationSec ? (
				<span className="ovq-num absolute right-1 bottom-1 bg-black/80 px-1 text-[10px] leading-4 font-medium text-white">
					{formatDuration(durationSec)}
				</span>
			) : null}
		</div>
	);
}

export type VideoRowData = {
	videoId: string;
	title: string;
	thumbnail?: string | null;
	channelTitle?: string | null;
	views?: number | null;
	publishedAt?: string | null;
	publishedText?: string | null;
	durationSec?: number | null;
	isShort?: boolean;
	isLive?: boolean;
};

/** Compact list row: thumbnail, title, meta line and badges. Opens the video. */
export function VideoRow({
	video,
	badges,
	rank,
	actions,
	className,
	thumbClassName,
	onOpen,
}: {
	video: VideoRowData;
	badges?: ReactNode;
	rank?: number;
	actions?: ReactNode;
	className?: string;
	thumbClassName?: string;
	/** Defaults to opening the video in a new tab */
	onOpen?: (e: React.MouseEvent) => void;
}) {
	const when = video.publishedAt
		? formatRelative(video.publishedAt)
		: (video.publishedText ?? null);
	const open = (e: React.MouseEvent) => {
		if (onOpen) onOpen(e);
		else openLink(watchUrl(video.videoId), e);
	};
	return (
		<div className={cn("group flex gap-2.5", className)}>
			{rank != null ? (
				<div className="ovq-num text-muted-foreground w-4 shrink-0 pt-1 text-right text-[11px] font-semibold">
					{rank}
				</div>
			) : null}
			<button
				type="button"
				onClick={open}
				onAuxClick={open}
				className="focus-visible:ring-ring shrink-0 outline-none focus-visible:ring-2"
				aria-label={`Open “${video.title}” on YouTube`}
			>
				<Thumb
					videoId={video.videoId}
					src={video.thumbnail}
					durationSec={video.durationSec}
					isShort={video.isShort}
					isLive={video.isLive}
					className={cn("w-28", thumbClassName)}
				/>
			</button>
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<button
					type="button"
					onClick={open}
					onAuxClick={open}
					className="ovq-clamp-2 hover:text-brand focus-visible:text-brand text-left text-xs leading-snug font-medium outline-none"
					title={video.title}
				>
					{video.title}
				</button>
				<div className="text-muted-foreground truncate text-[11px]">
					{[
						video.channelTitle,
						video.views != null ? `${formatCompact(video.views)} views` : null,
						when,
					]
						.filter(Boolean)
						.join(" · ")}
				</div>
				{badges ? (
					<div className="flex flex-wrap items-center gap-1">{badges}</div>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 items-start gap-0.5">{actions}</div>
			) : null}
		</div>
	);
}

export function Avatar({
	src,
	size = 32,
	className,
	alt = "",
}: {
	src?: string | null;
	size?: number;
	className?: string;
	alt?: string;
}) {
	const [failed, setFailed] = useState(false);
	return (
		<div
			className={cn(
				"bg-muted text-muted-foreground flex shrink-0 items-center justify-center overflow-hidden rounded-full",
				className,
			)}
			style={{ width: size, height: size }}
		>
			{src && !failed ? (
				<img
					src={src}
					alt={alt}
					referrerPolicy="no-referrer"
					loading="lazy"
					onError={() => setFailed(true)}
					className="size-full object-cover"
				/>
			) : (
				<UserRound style={{ width: size * 0.55, height: size * 0.55 }} />
			)}
		</div>
	);
}
