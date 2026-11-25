/**
 * Thumbnail checker: local canvas analysis (no AI, nothing uploaded) of the
 * user's own image or any video's thumbnail. Brightness, contrast,
 * colorfulness, clutter, readability at phone size, faces (when the browser
 * has a FaceDetector) and how it stands out from the competitor search
 * shared with the Preview view, as a 0-100 score with a checklist.
 */
import { Button } from "@growtube/ui/components/button";
import { cn } from "@growtube/ui/lib/utils";
import {
	CircleCheck,
	CircleMinus,
	CircleX,
	type LucideIcon,
	MonitorPlay,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { yt } from "@/lib/client";

import { useAsyncTask, useLocalPref } from "../../../hooks";
import { Badge, scoreLabel, scoreTone } from "../../../ui/badges";
import { SearchForm, Segmented } from "../../../ui/controls";
import { ErrorNotice, Notice, Spinner } from "../../../ui/feedback";
import { Section } from "../../../ui/layout";
import { usePanel } from "../../nav";
import {
	analyzeImage,
	buildReport,
	type CheckReport,
	type CheckStatus,
	competitorColors,
	detectFaces,
	hasFaceDetector,
	type Rgb,
} from "./analyze";
import {
	type CompetitorSearch,
	competitorThumbs,
	ImageDropZone,
} from "./common";
import { loadImage, loadVideoThumb, parseVideoRef } from "./image-utils";

type Source = "mine" | "video";

type Subject = {
	src: string;
	label: string;
	/** Video being checked (excluded from its own competitors) */
	videoId: string | null;
	/** Title to search competitors with */
	title: string;
};

const STATUS_ICON: Record<
	CheckStatus,
	{ icon: LucideIcon; className: string }
> = {
	pass: {
		icon: CircleCheck,
		className: "text-emerald-600 dark:text-emerald-400",
	},
	warn: {
		icon: TriangleAlert,
		className: "text-amber-600 dark:text-amber-400",
	},
	fail: { icon: CircleX, className: "text-red-600 dark:text-red-400" },
	skip: { icon: CircleMinus, className: "text-muted-foreground" },
};

/** Real display widths on youtube.com (CSS px). */
const SIZES = [
	{ id: "home", label: "Home grid (desktop)", width: 320, radius: 12 },
	{ id: "search", label: "Search results", width: 360, radius: 12 },
	{ id: "mobile", label: "Mobile list / Up next", width: 168, radius: 8 },
] as const;

export function ThumbnailChecker({
	image,
	onImageFile,
	title,
	competitors,
}: {
	image: string | null;
	onImageFile: (file: File | null | undefined) => void;
	/** The title typed in Preview (competitor search default) */
	title: string;
	competitors: CompetitorSearch;
}) {
	const { activeTab } = usePanel();
	const [source, setSource] = useLocalPref<Source>(
		"thumbnails.checkSource",
		"mine",
	);
	const [videoInput, setVideoInput] = useState("");
	const video = useAsyncTask(async (ref: string) => {
		const videoId = parseVideoRef(ref);
		if (!videoId)
			throw new Error(
				"Paste a YouTube video link or an 11-character video id.",
			);
		const [thumb, details] = await Promise.all([
			loadVideoThumb(videoId),
			yt.getVideoDetails(videoId, { level: "basic" }).catch(() => null),
		]);
		return {
			src: thumb.url,
			label: details?.title ?? videoId,
			videoId,
			title: details?.title ?? "",
		} satisfies Subject;
	});

	const subject: Subject | null =
		source === "mine"
			? image
				? { src: image, label: "Your thumbnail", videoId: null, title }
				: null
			: (video.data ?? null);

	// ---- Image analysis (runs when the subject changes) ----
	const analysis = useAsyncTask(async (src: string) => {
		const img = await loadImage(src);
		const stats = analyzeImage(img);
		const faces = await detectFaces(img);
		return { stats, faces };
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: per image
	useEffect(() => {
		if (subject?.src) void analysis.run(subject.src);
		else analysis.reset();
	}, [subject?.src]);

	// ---- Competitor colors (shared search from Preview) ----
	const thumbs = competitorThumbs(competitors).filter(
		(t) => t.videoId !== subject?.videoId,
	);
	const thumbKey = thumbs.map((t) => t.thumbnail).join("|");
	const [colors, setColors] = useState<{ key: string; rgb: Rgb[] } | null>(
		null,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the urls
	useEffect(() => {
		if (!thumbKey) return setColors(null);
		let alive = true;
		void competitorColors(thumbs.map((t) => t.thumbnail)).then((rgb) => {
			if (alive) setColors({ key: thumbKey, rgb });
		});
		return () => {
			alive = false;
		};
	}, [thumbKey]);
	const competitorRgb =
		colors && colors.key === thumbKey && colors.rgb.length ? colors.rgb : null;

	const report: CheckReport | null = useMemo(
		() =>
			analysis.data
				? buildReport(analysis.data.stats, {
						faces: analysis.data.faces,
						faceDetector: hasFaceDetector(),
						competitors: competitorRgb,
					})
				: null,
		[analysis.data, competitorRgb],
	);

	const compareQuery = (subject?.title || title).trim();

	return (
		<div className="flex flex-col gap-3">
			<Section
				title="Thumbnail checker"
				description="Analyzed in this browser with a canvas. Nothing is uploaded."
			>
				<Segmented<Source>
					size="xs"
					value={source}
					onChange={setSource}
					options={[
						{ value: "mine", label: "Your image" },
						{ value: "video", label: "A video" },
					]}
					className="self-start"
					ariaLabel="What to check"
				/>
				{source === "mine" ? (
					<ImageDropZone image={image} onImageFile={onImageFile} />
				) : (
					<>
						<SearchForm
							value={videoInput}
							onChange={setVideoInput}
							onSubmit={(v) => void video.run(v)}
							placeholder="Video link or id"
							inputLabel="Video to check"
							buttonLabel="Check"
							loading={video.loading}
						/>
						{activeTab.videoId ? (
							<Button
								size="xs"
								variant="outline"
								className="self-start"
								disabled={video.loading}
								onClick={() => {
									if (!activeTab.videoId) return;
									setVideoInput(activeTab.videoId);
									void video.run(activeTab.videoId);
								}}
							>
								<MonitorPlay /> This tab's video
							</Button>
						) : null}
						{video.error ? <ErrorNotice error={video.error} /> : null}
					</>
				)}
			</Section>

			{!subject ? (
				<Notice>
					{source === "mine"
						? "Add your thumbnail (or paste one) to check it."
						: "Pick a video to check its thumbnail."}
				</Notice>
			) : (
				<>
					<Section title="At real sizes">
						<div className="flex flex-col gap-3">
							{SIZES.map((s) => (
								<figure key={s.id} className="m-0 flex flex-col gap-1">
									<img
										src={subject.src}
										alt=""
										referrerPolicy="no-referrer"
										className="aspect-video object-cover"
										style={{
											width: s.width,
											maxWidth: "100%",
											borderRadius: s.radius,
										}}
									/>
									<figcaption className="text-muted-foreground text-[11px]">
										{s.label} · {s.width} px wide
									</figcaption>
								</figure>
							))}
						</div>
					</Section>

					{analysis.error ? (
						<ErrorNotice
							error={analysis.error}
							title="Couldn't read this image"
						/>
					) : !report ? (
						<div className="text-muted-foreground flex items-center gap-2 text-xs">
							<Spinner /> Analyzing…
						</div>
					) : (
						<Section
							title={
								<span className="flex items-center gap-2">
									Score
									<Badge
										tone={scoreTone(report.score)}
										className="min-w-9 justify-center text-sm"
									>
										{report.score}
									</Badge>
									<span className="text-muted-foreground text-xs font-normal">
										{scoreLabel(report.score)}
									</span>
								</span>
							}
							description={subject.label}
						>
							<ul className="flex flex-col gap-2.5">
								{report.items.map((item) => {
									const { icon: Icon, className } = STATUS_ICON[item.status];
									return (
										<li key={item.id} className="flex gap-2">
											<Icon
												className={cn("mt-0.5 size-4 shrink-0", className)}
												aria-label={item.status}
											/>
											<div className="flex min-w-0 flex-col gap-0.5">
												<div className="flex flex-wrap items-baseline gap-x-2 text-xs">
													<span className="font-medium">{item.label}</span>
													<span className="text-muted-foreground ovq-num text-[11px]">
														{item.value}
													</span>
												</div>
												<p className="text-muted-foreground text-[11px] leading-relaxed">
													{item.tip}
												</p>
											</div>
										</li>
									);
								})}
							</ul>
							{competitorRgb ? (
								<div className="flex flex-col gap-1.5">
									<span className="text-muted-foreground text-[11px]">
										Compared with {competitorRgb.length} results
										{competitors.data?.query
											? ` for “${competitors.data.query}”`
											: ""}
										:
									</span>
									<div className="flex flex-wrap items-center gap-1">
										<Swatch rgb={report.stats.average} label="Yours" mine />
										{competitorRgb.map((rgb, i) => (
											<Swatch key={i} rgb={rgb} label={`Competitor ${i + 1}`} />
										))}
									</div>
								</div>
							) : compareQuery ? (
								<Button
									size="xs"
									variant="outline"
									className="self-start"
									disabled={competitors.loading}
									onClick={() => void competitors.run(compareQuery)}
								>
									{competitors.loading ? <Spinner /> : null}
									Compare with results for “
									{compareQuery.length > 40
										? `${compareQuery.slice(0, 40)}…`
										: compareQuery}
									”
								</Button>
							) : (
								<p className="text-muted-foreground text-[11px]">
									Type a title in Preview (or search a topic there) to compare
									with competitors.
								</p>
							)}
							{competitors.error ? (
								<ErrorNotice error={competitors.error} />
							) : null}
						</Section>
					)}
				</>
			)}
		</div>
	);
}

function Swatch({
	rgb,
	label,
	mine,
}: {
	rgb: Rgb;
	label: string;
	mine?: boolean;
}) {
	const [r, g, b] = rgb.map(Math.round);
	return (
		<span
			title={`${label}: average rgb(${r}, ${g}, ${b})`}
			className={cn(
				"ring-foreground/15 inline-block size-5 rounded-md ring-1",
				mine && "ring-brand size-6 ring-2",
			)}
			style={{ background: `rgb(${r}, ${g}, ${b})` }}
		/>
	);
}
