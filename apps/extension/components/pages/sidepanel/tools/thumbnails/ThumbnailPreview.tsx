/**
 * Thumbnail preview: your image + title rendered in mock YouTube layouts
 * (desktop home grid, search results, watch-page sidebar, mobile app), in
 * dark or light, next to the real results for a query, and live in the real
 * feed of the active YouTube tab ("Preview on YouTube"). The image never
 * leaves this browser (object URL in memory; the live preview hands a
 * downscaled copy to that tab only).
 */
import {
	formatCompact,
	formatDuration,
	parseDurationText,
} from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { cn } from "@growtube/ui/lib/utils";
import { Moon, Sun, Trash2, UserRound } from "lucide-react";
import { type CSSProperties, type ReactNode, useRef, useState } from "react";

import { useStorageItem } from "@/lib/hooks";
import { myChannel } from "@/lib/settings";
import type { SearchResult } from "@/lib/youtube/types";

import { useLocalPref } from "../../../hooks";
import { Field, SearchForm, Segmented } from "../../../ui/controls";
import { ErrorNotice, Notice } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import {
	type CompetitorSearch,
	ImageDropZone,
	type PreviewDraft,
} from "./common";
import { toAvatarJpeg } from "./image-utils";
import { LivePreview } from "./LivePreview";

type Layout = "home" | "search" | "sidebar" | "mobile";
type MockTheme = "dark" | "light";

type MockVideo = {
	key: string;
	mine: boolean;
	title: string;
	channel: string;
	meta: string;
	duration: string | null;
	thumb: string | null;
	avatar?: string | null;
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
const MY_META = "1.2K views • 2 hours ago";

export function ThumbnailPreview({
	image,
	onImageFile,
	draft,
	onDraftChange,
	competitors,
}: {
	image: string | null;
	onImageFile: (file: File | null | undefined) => void;
	draft: PreviewDraft;
	onDraftChange: (update: (prev: PreviewDraft) => PreviewDraft) => void;
	competitors: CompetitorSearch;
}) {
	const [mine] = useStorageItem(myChannel);
	const { title, channelName, duration, avatar } = draft;
	const set = (patch: Partial<PreviewDraft>) =>
		onDraftChange((d) => ({ ...d, ...patch }));
	const [layout, setLayout] = useLocalPref<Layout>("thumbnails.layout", "home");
	const [theme, setTheme] = useLocalPref<MockTheme>(
		"thumbnails.mockTheme",
		"dark",
	);
	const [query, setQuery] = useState("");
	const avatarRef = useRef<HTMLInputElement | null>(null);

	const durationSec = parseDurationText(duration);
	const myVideo: MockVideo = {
		key: "mine",
		mine: true,
		title: title.trim() || "Your video title goes here",
		channel: channelName.trim() || mine?.title || "Your channel",
		meta: MY_META,
		duration: durationSec ? formatDuration(durationSec) : null,
		thumb: image,
		avatar,
		description: "Your description preview appears in search results.",
	};
	const real = (competitors.data?.results ?? [])
		.filter((r) => !r.isShort)
		.map(toMock);
	const items = [...real.slice(0, 2), myVideo, ...real.slice(2)];
	const searchTitle = () => {
		const q = title.trim();
		if (!q) return;
		setQuery(q);
		void competitors.run(q);
	};

	return (
		<div className="flex flex-col gap-3">
			<Section
				title="Your thumbnail"
				description="Stays in this browser, never uploaded."
			>
				<ImageDropZone image={image} onImageFile={onImageFile} />
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
						onChange={(e) => set({ title: e.target.value })}
						placeholder="Your video title goes here"
					/>
				</Field>
				<div className="grid grid-cols-[1fr_88px] gap-2">
					<Field label="Channel name" htmlFor="preview-channel">
						<Input
							id="preview-channel"
							value={channelName}
							onChange={(e) => set({ channelName: e.target.value })}
							placeholder={mine?.title ?? "Your channel"}
						/>
					</Field>
					<Field label="Length" htmlFor="preview-duration">
						<Input
							id="preview-duration"
							value={duration}
							onChange={(e) => set({ duration: e.target.value })}
							placeholder="12:34"
						/>
					</Field>
				</div>
				<div className="flex items-center gap-2">
					<MockAvatar name={myVideo.channel} size={28} mine image={avatar} />
					<input
						ref={avatarRef}
						type="file"
						accept="image/*"
						className="hidden"
						onChange={(e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (file?.type.startsWith("image/"))
								void toAvatarJpeg(file)
									.then((url) => set({ avatar: url }))
									.catch(() => {});
						}}
					/>
					<Button
						size="xs"
						variant="outline"
						onClick={() => avatarRef.current?.click()}
					>
						<UserRound /> {avatar ? "Change avatar" : "Avatar (optional)"}
					</Button>
					{avatar ? (
						<Button
							size="xs"
							variant="ghost"
							onClick={() => set({ avatar: null })}
						>
							<Trash2 /> Remove
						</Button>
					) : null}
				</div>
				<LivePreview
					image={image}
					title={title}
					card={{
						title: myVideo.title,
						channel: myVideo.channel,
						avatar,
						duration: myVideo.duration,
						meta: MY_META,
					}}
				/>
			</Section>

			<Section
				title="Compare with real results"
				description="Search your title or topic to place your thumbnail between today's real results."
			>
				<SearchForm
					value={query}
					onChange={setQuery}
					onSubmit={(q) => void competitors.run(q)}
					placeholder="Topic you're competing for"
					inputLabel="Competitor search"
					loading={competitors.loading}
				/>
				{title.trim() && title.trim() !== query.trim() ? (
					<Button
						size="xs"
						variant="outline"
						className="self-start"
						disabled={competitors.loading}
						onClick={searchTitle}
					>
						Search my title
					</Button>
				) : null}
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
						{ value: "mobile", label: "Mobile" },
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
				className={cn(
					"ring-foreground/10 overflow-hidden shadow-xs ring-1",
					layout === "mobile"
						? "mx-auto w-full max-w-[360px] rounded-[22px] px-0 py-3"
						: "rounded-xl p-3",
				)}
				style={{ ...PALETTE[theme], fontFamily: FONT }}
			>
				{layout === "home" ? (
					<HomeGrid items={items} />
				) : layout === "search" ? (
					<SearchList items={items} />
				) : layout === "sidebar" ? (
					<SidebarList items={items} />
				) : (
					<MobileList items={items} />
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
				outlineOffset: radius ? 2 : -2,
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
	image,
}: {
	name: string;
	size: number;
	mine: boolean;
	image?: string | null;
}) {
	return (
		<div
			className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium text-white"
			style={{
				width: size,
				height: size,
				fontSize: size * 0.45,
				background: mine ? "var(--ovq-brand)" : "#6b7280",
			}}
			aria-hidden
		>
			{image ? (
				<img src={image} alt="" className="size-full object-cover" />
			) : (
				name.trim().charAt(0).toUpperCase() || "?"
			)}
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
						<MockAvatar
							name={item.channel}
							size={26}
							mine={item.mine}
							image={item.avatar}
						/>
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
							<MockAvatar
								name={item.channel}
								size={18}
								mine={item.mine}
								image={item.avatar}
							/>
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

/** YouTube's phone app home feed: full-bleed thumbnails, one per row. */
function MobileList({ items }: { items: MockVideo[] }) {
	return (
		<div className="flex flex-col gap-5">
			{items.slice(0, 5).map((item) => (
				<div key={item.key} className="flex min-w-0 flex-col gap-2.5">
					<MockThumb item={item} radius={0} className="w-full" />
					<div className="flex gap-3 px-3">
						<MockAvatar
							name={item.channel}
							size={36}
							mine={item.mine}
							image={item.avatar}
						/>
						<div className="flex min-w-0 flex-col gap-0.5">
							<div
								style={{
									...clamp2,
									fontSize: 14,
									fontWeight: 500,
									lineHeight: "20px",
								}}
							>
								{item.title}
							</div>
							<Secondary>
								{[item.channel, item.meta].filter(Boolean).join(" • ")}
							</Secondary>
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
