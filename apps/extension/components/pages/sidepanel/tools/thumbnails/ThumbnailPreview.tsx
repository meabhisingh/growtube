/**
 * Thumbnail preview: your image + title rendered in mock YouTube layouts
 * (home grid, search results, watch-page sidebar), in dark or light, next to
 * the real results for a query. The image never leaves this page (object URL
 * in memory).
 */
import {
	formatCompact,
	formatDuration,
	parseDurationText,
} from "@open-vidiq/shared/format";
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { cn } from "@open-vidiq/ui/lib/utils";
import { ImageUp, Moon, Sun, Trash2 } from "lucide-react";
import {
	type CSSProperties,
	type DragEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

import { yt } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { myChannel } from "@/lib/settings";
import type { SearchResult } from "@/lib/youtube/types";

import { useAsyncTask, useLocalPref } from "../../../hooks";
import { Field, SearchForm, Segmented } from "../../../ui/controls";
import { ErrorNotice, Notice } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";

type Layout = "home" | "search" | "sidebar";
type MockTheme = "dark" | "light";

type MockVideo = {
	key: string;
	mine: boolean;
	title: string;
	channel: string;
	meta: string;
	duration: string | null;
	thumb: string | null;
	description?: string;
};

const PALETTE: Record<MockTheme, CSSProperties> = {
	dark: {
		background: "#0f0f0f",
		color: "#f1f1f1",
		["--yt-secondary" as string]: "#aaaaaa",
		["--yt-placeholder" as string]: "#272727",
	},
	light: {
		background: "#ffffff",
		color: "#0f0f0f",
		["--yt-secondary" as string]: "#606060",
		["--yt-placeholder" as string]: "#e5e5e5",
	},
};

const FONT = 'Roboto, "YouTube Sans", Arial, sans-serif';

export function ThumbnailPreview({
	image,
	onImageChange,
}: {
	image: string | null;
	onImageChange: (url: string | null) => void;
}) {
	const [mine] = useStorageItem(myChannel);
	const [title, setTitle] = useState("");
	const [channelName, setChannelName] = useState("");
	const [duration, setDuration] = useState("12:34");
	const [layout, setLayout] = useLocalPref<Layout>("thumbnails.layout", "home");
	const [theme, setTheme] = useLocalPref<MockTheme>(
		"thumbnails.mockTheme",
		"dark",
	);
	const [query, setQuery] = useState("");
	const [dragging, setDragging] = useState(false);
	const fileRef = useRef<HTMLInputElement | null>(null);
	const objectUrl = useRef<string | null>(null);
	const competitors = useAsyncTask((q: string) =>
		yt.search(q, { limit: 12, type: "video" }),
	);

	// Revoke our object URL when replaced or on unmount.
	useEffect(
		() => () => {
			if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		},
		[],
	);

	const setFile = (file: File | null | undefined) => {
		if (!file?.type.startsWith("image/")) return;
		if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		const url = URL.createObjectURL(file);
		objectUrl.current = url;
		onImageChange(url);
	};

	const clear = () => {
		if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
		objectUrl.current = null;
		onImageChange(null);
		if (fileRef.current) fileRef.current.value = "";
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setDragging(false);
		setFile(e.dataTransfer.files[0]);
	};

	const durationSec = parseDurationText(duration);
	const myVideo: MockVideo = {
		key: "mine",
		mine: true,
		title: title.trim() || "Your video title goes here",
		channel: channelName.trim() || mine?.title || "Your channel",
		meta: "1.2K views • 2 hours ago",
		duration: durationSec ? formatDuration(durationSec) : null,
		thumb: image,
		description: "Your description preview appears in search results.",
	};
	const real = (competitors.data?.results ?? [])
		.filter((r) => !r.isShort)
		.map(toMock);
	const items = [...real.slice(0, 1), myVideo, ...real.slice(1)];

	return (
		<div className="flex flex-col gap-3">
			<Section
				title="Your thumbnail"
				description="Stays in memory on this page, never uploaded."
			>
				<input
					ref={fileRef}
					type="file"
					accept="image/*"
					className="hidden"
					onChange={(e) => setFile(e.target.files?.[0])}
				/>
				<section
					aria-label="Thumbnail drop zone"
					onDragOver={(e) => {
						e.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={onDrop}
					className={cn(
						"flex items-center gap-3 border border-dashed p-2.5",
						dragging && "border-brand bg-brand-soft",
					)}
				>
					{image ? (
						<img
							src={image}
							alt=""
							className="aspect-video w-28 shrink-0 object-cover"
						/>
					) : (
						<div className="bg-muted text-muted-foreground flex aspect-video w-28 shrink-0 items-center justify-center">
							<ImageUp className="size-5" aria-hidden />
						</div>
					)}
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<span className="text-muted-foreground text-[11px]">
							Drop an image here, or
						</span>
						<div className="flex gap-1.5">
							<Button size="xs" onClick={() => fileRef.current?.click()}>
								<ImageUp /> {image ? "Replace" : "Choose image"}
							</Button>
							{image ? (
								<Button size="xs" variant="ghost" onClick={clear}>
									<Trash2 /> Remove
								</Button>
							) : null}
						</div>
						<span className="text-muted-foreground text-[10px]">
							1280×720 (16:9) works best.
						</span>
					</div>
				</section>
				<Field
					label="Title"
					htmlFor="preview-title"
					trailing={
						<span
							className={cn(
								"ovq-num text-[11px]",
								title.length > 70
									? "text-amber-600 dark:text-amber-400"
									: "text-muted-foreground",
							)}
						>
							{title.length}/100
						</span>
					}
					hint={
						title.length > 70
							? "Titles over ~70 characters get cut off in search and on mobile."
							: undefined
					}
				>
					<Input
						id="preview-title"
						value={title}
						maxLength={100}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Your video title goes here"
					/>
				</Field>
				<div className="grid grid-cols-[1fr_88px] gap-2">
					<Field label="Channel name" htmlFor="preview-channel">
						<Input
							id="preview-channel"
							value={channelName}
							onChange={(e) => setChannelName(e.target.value)}
							placeholder={mine?.title ?? "Your channel"}
						/>
					</Field>
					<Field label="Length" htmlFor="preview-duration">
						<Input
							id="preview-duration"
							value={duration}
							onChange={(e) => setDuration(e.target.value)}
							placeholder="12:34"
						/>
					</Field>
				</div>
			</Section>

			<Section
				title="Compare with real results"
				description="Search a topic to place your thumbnail between today's real results."
			>
				<SearchForm
					value={query}
					onChange={setQuery}
					onSubmit={(q) => void competitors.run(q)}
					placeholder="Topic you're competing for"
					inputLabel="Competitor search"
					loading={competitors.loading}
				/>
				{competitors.error ? <ErrorNotice error={competitors.error} /> : null}
			</Section>

			<div className="flex flex-wrap items-center gap-1.5">
				<Segmented<Layout>
					size="xs"
					value={layout}
					onChange={setLayout}
					options={[
						{ value: "home", label: "Home" },
						{ value: "search", label: "Search" },
						{ value: "sidebar", label: "Sidebar" },
					]}
					ariaLabel="Layout"
				/>
				<Segmented<MockTheme>
					size="xs"
					value={theme}
					onChange={setTheme}
					options={[
						{ value: "dark", label: "Dark", icon: Moon },
						{ value: "light", label: "Light", icon: Sun },
					]}
					ariaLabel="YouTube theme"
				/>
			</div>

			{!image ? (
				<Notice>Add your thumbnail above to see it in place.</Notice>
			) : null}

			<div
				className="ring-foreground/10 overflow-hidden p-3 ring-1"
				style={{ ...PALETTE[theme], fontFamily: FONT }}
			>
				{layout === "home" ? (
					<HomeGrid items={items} />
				) : layout === "search" ? (
					<SearchList items={items} />
				) : (
					<SidebarList items={items} />
				)}
			</div>
		</div>
	);
}

function toMock(r: SearchResult): MockVideo {
	return {
		key: r.videoId,
		mine: false,
		title: r.title,
		channel: r.channelTitle ?? "",
		meta: [
			r.views != null ? `${formatCompact(r.views)} views` : null,
			r.publishedText,
		]
			.filter(Boolean)
			.join(" • "),
		duration: r.durationSec ? formatDuration(r.durationSec) : null,
		thumb: r.thumbnail,
	};
}

function MockThumb({
	item,
	radius,
	className,
}: {
	item: MockVideo;
	radius: number;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"relative aspect-video shrink-0 overflow-hidden",
				className,
			)}
			style={{
				borderRadius: radius,
				background: "var(--yt-placeholder)",
				outline: item.mine ? "2px solid var(--ovq-brand)" : undefined,
				outlineOffset: 2,
			}}
		>
			{item.thumb ? (
				<img
					src={item.thumb}
					alt=""
					referrerPolicy="no-referrer"
					className="size-full object-cover"
				/>
			) : (
				<div
					className="flex size-full items-center justify-center text-[10px]"
					style={{ color: "var(--yt-secondary)" }}
				>
					Your thumbnail
				</div>
			)}
			{item.duration ? (
				<span
					className="absolute right-1 bottom-1 px-1 text-[10px] leading-4 font-medium text-white"
					style={{ background: "rgba(0,0,0,0.8)", borderRadius: 4 }}
				>
					{item.duration}
				</span>
			) : null}
		</div>
	);
}

function MockAvatar({
	name,
	size,
	mine,
}: {
	name: string;
	size: number;
	mine: boolean;
}) {
	return (
		<div
			className="flex shrink-0 items-center justify-center rounded-full font-medium text-white"
			style={{
				width: size,
				height: size,
				fontSize: size * 0.45,
				background: mine ? "var(--ovq-brand)" : "#6b7280",
			}}
			aria-hidden
		>
			{name.trim().charAt(0).toUpperCase() || "?"}
		</div>
	);
}

const clamp2: CSSProperties = {
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
};

function Secondary({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}) {
	return (
		<div
			className="truncate"
			style={{ color: "var(--yt-secondary)", fontSize: 12, ...style }}
		>
			{children}
		</div>
	);
}

function HomeGrid({ items }: { items: MockVideo[] }) {
	return (
		<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5">
			{items.slice(0, 8).map((item) => (
				<div key={item.key} className="flex min-w-0 flex-col gap-2.5">
					<MockThumb item={item} radius={10} />
					<div className="flex gap-2">
						<MockAvatar name={item.channel} size={26} mine={item.mine} />
						<div className="flex min-w-0 flex-col gap-0.5">
							<div
								style={{
									...clamp2,
									fontSize: 13,
									fontWeight: 500,
									lineHeight: "18px",
								}}
							>
								{item.title}
							</div>
							<Secondary>{item.channel}</Secondary>
							<Secondary>{item.meta}</Secondary>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

function SearchList({ items }: { items: MockVideo[] }) {
	return (
		<div className="flex flex-col gap-4">
			{items.slice(0, 6).map((item) => (
				<div key={item.key} className="flex gap-3">
					<MockThumb item={item} radius={8} className="w-[48%]" />
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div
							style={{
								...clamp2,
								fontSize: 14,
								fontWeight: 400,
								lineHeight: "20px",
							}}
						>
							{item.title}
						</div>
						<Secondary>{item.meta}</Secondary>
						<div className="flex items-center gap-1.5 py-1">
							<MockAvatar name={item.channel} size={18} mine={item.mine} />
							<Secondary>{item.channel}</Secondary>
						</div>
						{item.description ? (
							<Secondary style={{ whiteSpace: "normal", ...clamp2 }}>
								{item.description}
							</Secondary>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}

function SidebarList({ items }: { items: MockVideo[] }) {
	return (
		<div className="flex flex-col gap-2">
			{items.slice(0, 8).map((item) => (
				<div key={item.key} className="flex gap-2">
					<MockThumb item={item} radius={8} className="w-[42%] max-w-[168px]" />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div
							style={{
								...clamp2,
								fontSize: 13,
								fontWeight: 500,
								lineHeight: "18px",
							}}
						>
							{item.title}
						</div>
						<Secondary>{item.channel}</Secondary>
						<Secondary>{item.meta}</Secondary>
					</div>
				</div>
			))}
		</div>
	);
}
