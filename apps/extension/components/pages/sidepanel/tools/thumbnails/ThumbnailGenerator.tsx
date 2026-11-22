/**
 * AI thumbnail generator: optional concepts (thumbnailConcepts) → prompt →
 * images via the user's provider (ai.generateImage). Images stay in memory;
 * download or send them to the preview.
 */
import { Button, buttonVariants } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { Textarea } from "@open-vidiq/ui/components/textarea";
import {
	Download,
	ExternalLink,
	Eye,
	Lightbulb,
	Settings,
	Sparkles,
	Wand2,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
	type ImageQuality,
	type ImageSize,
	imageExtension,
} from "@/lib/ai/types";
import { ai, ext } from "@/lib/client";

import { useAsyncTask } from "../../../hooks";
import type { ThumbnailConcept } from "../../../storage";
import { Field, NativeSelect } from "../../../ui/controls";
import { ErrorNotice, LoadingBlock, Notice } from "../../../ui/feedback";
import { Eyebrow, Section } from "../../../ui/layout";
import { describeError, openInNewTab } from "../../../utils";
import { AiSetupNotice, useAiStatus } from "../../shared";

/** 1280x720 falls back to 1536x1024, then the provider default, when rejected. */
const SIZES: { value: ImageSize; label: string }[] = [
	{ value: "1280x720", label: "YouTube 16:9 (1280x720)" },
	{ value: "1536x1024", label: "Landscape 3:2 (1536x1024)" },
	{ value: "1024x1024", label: "Square (1024x1024)" },
	{ value: "auto", label: "Provider default" },
];

const QUALITIES: { value: ImageQuality; label: string }[] = [
	{ value: "auto", label: "Quality: auto" },
	{ value: "low", label: "Quality: low (drafts)" },
	{ value: "medium", label: "Quality: medium" },
	{ value: "high", label: "Quality: high" },
];

const STYLE_SUFFIX =
	" YouTube thumbnail, 16:9, bold composition, one clear focal point, high contrast, vivid colors, no text.";

export function ThumbnailGenerator({
	intent,
	onPreview,
}: {
	intent: { id: number; prompt: string } | null;
	onPreview: (url: string) => void;
}) {
	const status = useAiStatus();
	const [title, setTitle] = useState("");
	const [prompt, setPrompt] = useState("");
	const [size, setSize] = useState<ImageSize>("1280x720");
	const [quality, setQuality] = useState<ImageQuality>("auto");
	const [count, setCount] = useState(1);
	const [styleHint, setStyleHint] = useState(true);
	const concepts = useAsyncTask((t: string) =>
		ai.generate("thumbnailConcepts", { title: t, count: 3 }),
	);
	const images = useAsyncTask(async () => {
		const full = `${prompt.trim()}${styleHint ? STYLE_SUFFIX : ""}`;
		return ai.generateImage(full, { size, quality, n: count });
	});

	// biome-ignore lint/correctness/useExhaustiveDependencies: once per intent
	useEffect(() => {
		if (intent) setPrompt(intent.prompt);
	}, [intent?.id]);

	const imageModel = status.data?.imageModel;
	const noImageModel = status.data?.ready && !imageModel;
	const imageError = images.error ? describeError(images.error) : null;

	return (
		<div className="flex flex-col gap-3">
			<AiSetupNotice />
			{noImageModel ? (
				<Notice
					tone="warning"
					title="No image model configured"
					actions={
						<Button
							size="xs"
							variant="outline"
							onClick={() => void ext.openOptions("ai")}
						>
							<Settings /> AI settings
						</Button>
					}
				>
					Image generation needs a provider with an image model, e.g. OpenAI
					(gpt-image-2.6-sunburst or the faster gpt-image-2.6-flare),
					OpenRouter, Together (FLUX.2) or Gemini (Nano Banana). Concepts still
					work with any chat model.
				</Notice>
			) : null}

			<Section
				title="Concepts"
				icon={Lightbulb}
				description="Optional: let the AI propose thumbnail concepts for your title."
			>
				<form
					className="flex gap-1.5"
					onSubmit={(e) => {
						e.preventDefault();
						if (title.trim()) void concepts.run(title.trim());
					}}
				>
					<Input
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Video title"
						aria-label="Video title for concepts"
					/>
					<Button
						type="submit"
						variant="outline"
						disabled={!title.trim() || concepts.loading}
					>
						<Sparkles /> Ideas
					</Button>
				</form>
				{concepts.error ? (
					<ErrorNotice
						error={concepts.error}
						onRetry={() => void concepts.run(title.trim())}
					/>
				) : concepts.loading ? (
					<LoadingBlock label="Designing concepts…" />
				) : concepts.data ? (
					<div className="flex flex-col gap-2">
						{concepts.data.concepts.map((c) => (
							<ConceptCard
								key={c.imagePrompt}
								concept={c}
								onUse={() => setPrompt(c.imagePrompt)}
							/>
						))}
					</div>
				) : null}
			</Section>

			<Section title="Generate" icon={Wand2}>
				<Field
					label="Image prompt"
					htmlFor="thumb-prompt"
					hint="Describe the scene. Add text overlays afterwards in your editor: image models are bad at text."
				>
					<Textarea
						id="thumb-prompt"
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="A surprised creator holding a glowing smartphone, dramatic rim light, dark blue background"
						className="min-h-20"
					/>
				</Field>
				<label className="text-muted-foreground flex items-center gap-2 text-[11px]">
					<input
						type="checkbox"
						checked={styleHint}
						onChange={(e) => setStyleHint(e.target.checked)}
					/>
					Add thumbnail style hints (16:9, high contrast, no text)
				</label>
				<div className="grid grid-cols-[1fr_auto] gap-2">
					<NativeSelect
						value={size}
						onChange={(e) => setSize(e.target.value as ImageSize)}
						aria-label="Image size"
						className="col-span-2"
					>
						{SIZES.map((s) => (
							<option key={s.value} value={s.value}>
								{s.label}
							</option>
						))}
					</NativeSelect>
					<NativeSelect
						value={quality}
						onChange={(e) => setQuality(e.target.value as ImageQuality)}
						aria-label="Image quality"
						title="Dropped automatically if the model doesn't support it"
					>
						{QUALITIES.map((q) => (
							<option key={q.value} value={q.value}>
								{q.label}
							</option>
						))}
					</NativeSelect>
					<NativeSelect
						value={count}
						onChange={(e) => setCount(Number(e.target.value))}
						aria-label="Number of images"
					>
						{[1, 2, 3, 4].map((n) => (
							<option key={n} value={n}>
								{n} image{n === 1 ? "" : "s"}
							</option>
						))}
					</NativeSelect>
				</div>
				<Button
					onClick={() => void images.run()}
					disabled={!prompt.trim() || images.loading}
				>
					<Wand2 /> {images.loading ? "Generating…" : "Generate"}
				</Button>
				{imageModel ? (
					<div className="text-muted-foreground text-[11px]">
						Using {status.data?.providerLabel} · {imageModel}
					</div>
				) : null}
				{images.error ? (
					<ErrorNotice
						error={images.error}
						title={
							imageError?.code === "NO_IMAGE_SUPPORT"
								? "This provider can't generate images"
								: undefined
						}
						onRetry={() => void images.run()}
					/>
				) : null}
				{images.loading ? (
					<LoadingBlock label="Painting… image models can take up to a minute." />
				) : null}
				{images.data?.adjustments.length ? (
					<div className="text-muted-foreground text-[11px]">
						Adjusted for {imageModel ?? "this model"}:{" "}
						{images.data.adjustments.join("; ")}.
					</div>
				) : null}
				{images.data?.images.length ? (
					<div className="grid grid-cols-1 gap-3">
						{images.data.images.map((src, i) => (
							<figure
								key={src.slice(-40) + String(i)}
								className="flex flex-col gap-1.5"
							>
								<img
									src={src}
									alt={`Generated thumbnail ${i + 1}`}
									className="ring-foreground/10 w-full ring-1"
								/>
								<figcaption className="flex flex-wrap gap-1.5">
									{src.startsWith("data:") ? (
										<a
											href={src}
											download={`open-vidiq-thumbnail-${i + 1}.${imageExtension(src)}`}
											className={buttonVariants({
												variant: "outline",
												size: "xs",
											})}
										>
											<Download /> Download
										</a>
									) : (
										<Button
											size="xs"
											variant="outline"
											onClick={() => void openInNewTab(src)}
										>
											<ExternalLink /> Open
										</Button>
									)}
									<Button
										size="xs"
										variant="ghost"
										onClick={() => onPreview(src)}
									>
										<Eye /> Preview in YouTube layouts
									</Button>
								</figcaption>
							</figure>
						))}
					</div>
				) : null}
			</Section>
		</div>
	);
}

function ConceptCard({
	concept,
	onUse,
}: {
	concept: ThumbnailConcept;
	onUse: () => void;
}) {
	return (
		<div className="bg-surface-2 flex flex-col gap-1.5 p-2.5 text-xs">
			<div className="flex items-start gap-2">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					{concept.headline ? (
						<div className="text-sm font-black tracking-tight uppercase">
							{concept.headline}
						</div>
					) : (
						<Eyebrow>No text overlay</Eyebrow>
					)}
					<p className="leading-relaxed">{concept.visual}</p>
				</div>
				<Button size="xs" onClick={onUse}>
					Use
				</Button>
			</div>
			<p className="text-muted-foreground leading-relaxed">
				{concept.composition}
				{concept.emotion ? ` · ${concept.emotion}` : ""}
			</p>
			{concept.colors.length ? (
				<div className="flex gap-1">
					{concept.colors.slice(0, 6).map((c) => (
						<span
							key={c}
							className="ring-foreground/15 h-3 w-6 ring-1"
							style={{ background: c }}
							title={c}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
