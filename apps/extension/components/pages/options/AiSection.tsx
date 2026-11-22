/**
 * AI provider settings: preset, base URL, API key (local only), chat + image
 * models (listModels with manual entry, shut-down models hidden, deprecated
 * ones flagged with a one-click replacement), temperature, reasoning effort,
 * Save and Test.
 *
 * Host permission for the provider origin is requested with
 * ensureProviderPermission() as the FIRST await of the Save / Test / Load
 * models click handlers, so Chrome still sees the user gesture.
 */
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { cn } from "@open-vidiq/ui/lib/utils";
import {
	CircleCheck,
	ExternalLink,
	Eye,
	EyeOff,
	KeyRound,
	List,
	LoaderCircle,
	PlugZap,
	RotateCcw,
	Save,
	Sparkles,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import {
	findDeprecation,
	type ModelKind,
	todayIso,
} from "@/lib/ai/deprecations";
import { AI_PROVIDER_PRESETS, getProviderPreset } from "@/lib/ai/providers";
import {
	type AiModelInfo,
	type AiProviderSettings,
	isReasoningEffort,
	type ReasoningEffortSetting,
} from "@/lib/ai/types";
import { ai } from "@/lib/client";
import { useStorageItem } from "@/lib/hooks";
import { ensureProviderPermission, originOf } from "@/lib/permissions";
import {
	aiProvider,
	onboardingDone,
	withProviderDefaults,
} from "@/lib/settings";

import { useAiStatus } from "../status";
import { Field, NativeSelect } from "../ui/controls";
import { ErrorNotice, Notice } from "../ui/feedback";
import { Section } from "../ui/layout";
import { toast } from "../ui/toast";

const IMAGE_MODEL_RE =
	/image|dall-?e|flux|imagen|stable-?diffusion|sdxl|sd3|kandinsky|playground|nano-banana|seedream|recraft|ideogram|hidream/i;
/** Ids that can't answer Chat Completions (audio, embeddings, legacy completions…). */
const NON_CHAT_RE =
	/embed|tts|audio|whisper|transcri|realtime|moderation|speech|davinci|babbage|sora|rerank/i;

const EFFORT_OPTIONS: { value: ReasoningEffortSetting; label: string }[] = [
	{ value: "", label: "Default (provider decides)" },
	{ value: "none", label: "None" },
	{ value: "minimal", label: "Minimal" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "xhigh", label: "XHigh" },
	{ value: "max", label: "Max" },
];

function normalize(s: AiProviderSettings): AiProviderSettings {
	return {
		...s,
		baseURL: s.baseURL.trim().replace(/\/+$/, ""),
		apiKey: s.apiKey.trim(),
		model: s.model.trim(),
		imageModel: s.imageModel.trim(),
		temperature: Math.min(2, Math.max(0, Number(s.temperature) || 0)),
		reasoningEffort: isReasoningEffort(s.reasoningEffort)
			? s.reasoningEffort
			: "",
	};
}

type ModelLists = {
	chat: AiModelInfo[];
	image: AiModelInfo[];
	/** Already past their shutdown date */
	shutDown: number;
	/** Live, but not chat models (images, audio, embeddings…) */
	nonChat: number;
	byId: Map<string, AiModelInfo>;
};

/** Hides shut-down models and splits chat vs image candidates. */
function splitModels(models: AiModelInfo[], today: string): ModelLists {
	const live = models.filter((m) => !m.shutdownDate || m.shutdownDate >= today);
	const image = live.filter((m) => IMAGE_MODEL_RE.test(m.id));
	const chat = live.filter(
		(m) => !IMAGE_MODEL_RE.test(m.id) && !NON_CHAT_RE.test(m.id),
	);
	return {
		chat,
		image,
		shutDown: models.length - live.length,
		nonChat: live.length - chat.length,
		byId: new Map(models.map((m) => [m.id, m])),
	};
}

function modelsHint(lists: ModelLists): string {
	const hidden = [
		lists.shutDown ? `${lists.shutDown} already shut down` : "",
		lists.nonChat
			? `${lists.nonChat} image/audio/embedding models not listed here`
			: "",
	].filter(Boolean);
	return `${lists.chat.length} chat models from the provider${hidden.length ? ` (${hidden.join("; ")})` : ""}. You can also type any id.`;
}

function deprecatedLabel(m: AiModelInfo): string | undefined {
	return m.shutdownDate
		? `Deprecated · shuts down ${m.shutdownDate}`
		: undefined;
}

function validate(s: AiProviderSettings): string | null {
	const preset = getProviderPreset(s.presetId);
	if (!/^https?:\/\/[^/\s]+/.test(s.baseURL.trim()))
		return "Enter a base URL starting with https:// (or http:// for local servers).";
	if (preset.requiresKey && !s.apiKey.trim())
		return `Paste your ${preset.label} API key.`;
	if (!s.model.trim()) return "Choose or type a chat model.";
	return null;
}

export function AiSection() {
	const [savedRaw, , loading] = useStorageItem(aiProvider);
	// Values written by older versions may lack newer fields.
	const saved = useMemo(() => withProviderDefaults(savedRaw), [savedRaw]);
	const [draft, setDraft] = useState<AiProviderSettings | null>(null);
	const [showKey, setShowKey] = useState(false);
	const [busy, setBusy] = useState<"save" | "test" | "models" | null>(null);
	const [error, setError] = useState<unknown>(null);
	const [testResult, setTestResult] = useState<string | null>(null);
	const [models, setModels] = useState<AiModelInfo[] | null>(null);
	const status = useAiStatus();
	const modelsId = useId();
	const imageModelsId = useId();
	const effortId = useId();
	const today = todayIso();

	// Follow the stored value (also when changed elsewhere) unless the user
	// has unsaved edits.
	const lastSaved = useRef(saved);
	useEffect(() => {
		if (loading) return;
		const prev = lastSaved.current;
		lastSaved.current = saved;
		setDraft((d) =>
			d == null ||
			JSON.stringify(normalize(d)) === JSON.stringify(normalize(prev))
				? saved
				: d,
		);
	}, [loading, saved]);

	const current = draft ?? saved;
	const preset = getProviderPreset(current.presetId);
	const dirty =
		JSON.stringify(normalize(current)) !== JSON.stringify(normalize(saved));
	const origin = originOf(current.baseURL);
	const lists = useMemo(
		() => (models ? splitModels(models, today) : null),
		[models, today],
	);
	const imageOptions = lists
		? lists.image.length
			? lists.image
			: [...lists.byId.values()].filter(
					(m) => !m.shutdownDate || m.shutdownDate >= today,
				)
		: [];

	const update = (patch: Partial<AiProviderSettings>) => {
		setDraft((d) => ({ ...(d ?? saved), ...patch }));
		setTestResult(null);
		setError(null);
	};

	const choosePreset = (id: string) => {
		const p = getProviderPreset(id);
		setModels(null);
		update({
			presetId: id,
			baseURL: p.baseURL || (id === "custom" ? current.baseURL : ""),
			// Keys are provider-specific: only keep the saved one for its own provider.
			apiKey: id === saved.presetId ? saved.apiKey : "",
			model: id === saved.presetId ? saved.model : p.defaultModel,
			imageModel:
				id === saved.presetId ? saved.imageModel : p.defaultImageModel,
			reasoningEffort:
				id === saved.presetId
					? saved.reasoningEffort
					: (p.defaultReasoningEffort ?? ""),
		});
	};

	/** Permission + validation + save. Must be called first in a click handler. */
	const persist = async (): Promise<boolean> => {
		const next = normalize(current);
		const problem = validate(next);
		if (problem) {
			setError(problem);
			return false;
		}
		const granted = await ensureProviderPermission(next.baseURL);
		if (!granted) {
			setError(
				`Chrome didn't grant access to ${originOf(next.baseURL) ?? next.baseURL}. open-vidiq needs it to call your AI provider.`,
			);
			return false;
		}
		await aiProvider.setValue(next);
		await onboardingDone.setValue(true);
		setDraft(next);
		status.refetch();
		return true;
	};

	const onSave = async () => {
		setBusy("save");
		setError(null);
		try {
			if (await persist()) toast("AI settings saved", { tone: "success" });
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
		}
	};

	const onTest = async () => {
		setBusy("test");
		setError(null);
		setTestResult(null);
		try {
			if (!(await persist())) return;
			const res = await ai.test();
			const adapted = res.adjustments?.length
				? ` Adjusted for this model: ${res.adjustments.join("; ")}.`
				: "";
			setTestResult(
				`${res.model} replied “${res.reply || "(empty)"}”. You're all set.${adapted}`,
			);
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
		}
	};

	const onLoadModels = async () => {
		setBusy("models");
		setError(null);
		try {
			const url = current.baseURL.trim();
			if (!/^https?:\/\//.test(url)) {
				setError("Enter the base URL first.");
				return;
			}
			const granted = await ensureProviderPermission(url);
			if (!granted) {
				setError(`Chrome didn't grant access to ${originOf(url) ?? url}.`);
				return;
			}
			const list = await ai.listModels({
				baseURL: url,
				apiKey: current.apiKey.trim(),
				presetId: current.presetId,
			});
			setModels(list);
			const split = splitModels(list, todayIso());
			if (!list.length)
				setError("The provider returned no models. Type the model id instead.");
			else
				toast(`${split.chat.length} chat models available`, {
					tone: "success",
				});
		} catch (e) {
			setError(e);
		} finally {
			setBusy(null);
		}
	};

	return (
		<Section
			id="ai"
			title="AI provider"
			icon={Sparkles}
			description="Bring your own OpenAI-compatible provider, or run a free local model. open-vidiq adds no limits and no credits on top."
		>
			<StatusLine
				loading={status.loading && !status.data}
				ready={!!status.data?.ready}
				text={
					!status.data
						? "Checking…"
						: status.data.ready
							? `Ready: ${status.data.providerLabel} · ${status.data.model}`
							: (status.data.problem ?? "Not configured yet")
				}
			/>

			<fieldset
				className="grid min-w-0 grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5"
				aria-label="Provider"
			>
				{AI_PROVIDER_PRESETS.map((p) => {
					const active = p.id === current.presetId;
					return (
						<button
							key={p.id}
							type="button"
							aria-pressed={active}
							onClick={() => choosePreset(p.id)}
							className={cn(
								"focus-visible:ring-ring flex flex-col items-start gap-0.5 px-2.5 py-2 text-left ring-1 transition-colors outline-none focus-visible:ring-2",
								active
									? "bg-brand-soft ring-brand/50"
									: "bg-surface ring-foreground/10 hover:ring-foreground/25",
							)}
						>
							<span className="text-xs font-medium">{p.label}</span>
							<span className="text-muted-foreground text-[10.5px]">
								{p.local
									? "Free · runs locally"
									: p.requiresKey
										? "API key"
										: "Any endpoint"}
							</span>
						</button>
					);
				})}
			</fieldset>

			{preset.note ? <Notice>{preset.note}</Notice> : null}

			<div className="grid gap-3 md:grid-cols-2">
				<Field
					label="Base URL"
					htmlFor="ai-base"
					hint="OpenAI-compatible endpoint, usually ending in /v1."
				>
					<Input
						id="ai-base"
						value={current.baseURL}
						onChange={(e) => update({ baseURL: e.target.value })}
						placeholder="https://api.example.com/v1"
						spellCheck={false}
					/>
				</Field>
				<Field
					label="API key"
					htmlFor="ai-key"
					trailing={
						preset.keyUrl ? (
							<a
								href={preset.keyUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="text-brand inline-flex items-center gap-1 text-[11px] hover:underline"
							>
								Get a key <ExternalLink className="size-3" />
							</a>
						) : null
					}
					hint={
						<>
							Stored only in this browser (chrome.storage.local) and sent only
							to{" "}
							<span className="text-foreground font-medium">
								{origin ?? "your provider"}
							</span>
							.{preset.requiresKey ? "" : " Optional for this provider."}
						</>
					}
				>
					<div className="relative">
						<KeyRound
							className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
							aria-hidden
						/>
						<Input
							id="ai-key"
							type={showKey ? "text" : "password"}
							value={current.apiKey}
							onChange={(e) => update({ apiKey: e.target.value })}
							placeholder={preset.requiresKey ? "Paste your key" : "Not needed"}
							autoComplete="off"
							spellCheck={false}
							className="pr-8 pl-8"
						/>
						<button
							type="button"
							onClick={() => setShowKey((s) => !s)}
							aria-label={showKey ? "Hide key" : "Show key"}
							className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
						>
							{showKey ? (
								<EyeOff className="size-3.5" />
							) : (
								<Eye className="size-3.5" />
							)}
						</button>
					</div>
				</Field>

				<Field
					label="Chat model"
					htmlFor="ai-model"
					hint={
						lists
							? modelsHint(lists)
							: "Type a model id, or load the provider's list."
					}
					trailing={
						<button
							type="button"
							onClick={() => void onLoadModels()}
							disabled={busy !== null}
							className="text-brand inline-flex items-center gap-1 text-[11px] hover:underline disabled:opacity-50"
						>
							{busy === "models" ? (
								<LoaderCircle className="size-3 animate-spin" />
							) : (
								<List className="size-3" />
							)}
							Load models
						</button>
					}
				>
					<Input
						id="ai-model"
						list={modelsId}
						value={current.model}
						onChange={(e) => update({ model: e.target.value })}
						placeholder={preset.defaultModel || "model-id"}
						spellCheck={false}
					/>
					<datalist id={modelsId}>
						{(lists?.chat ?? []).map((m) => (
							<option key={m.id} value={m.id} label={deprecatedLabel(m)} />
						))}
					</datalist>
					<DeprecationNotice
						kind="chat"
						id={current.model}
						settings={current}
						listed={lists?.byId.get(current.model.trim())}
						onUse={(model) => update({ model })}
					/>
				</Field>
				<Field
					label="Image model"
					htmlFor="ai-image-model"
					hint={
						preset.id === "openai"
							? "For the thumbnail generator. gpt-image-2.6-sunburst is the most detailed; gpt-image-2.6-flare is about 3× faster at the same price."
							: "For the thumbnail generator. Leave empty if your provider can't generate images."
					}
				>
					<Input
						id="ai-image-model"
						list={imageModelsId}
						value={current.imageModel}
						onChange={(e) => update({ imageModel: e.target.value })}
						placeholder={
							preset.defaultImageModel || "e.g. gpt-image-2.6-sunburst"
						}
						spellCheck={false}
					/>
					<datalist id={imageModelsId}>
						{imageOptions.map((m) => (
							<option key={m.id} value={m.id} label={deprecatedLabel(m)} />
						))}
					</datalist>
					<DeprecationNotice
						kind="image"
						id={current.imageModel}
						settings={current}
						listed={lists?.byId.get(current.imageModel.trim())}
						onUse={(imageModel) => update({ imageModel })}
					/>
				</Field>
			</div>

			<div className="grid gap-3 md:grid-cols-2">
				<Field
					label="Temperature"
					htmlFor="ai-temp"
					trailing={
						<span className="ovq-num text-[11px]">
							{current.temperature.toFixed(1)}
						</span>
					}
					hint="Lower = focused and consistent, higher = more creative (0.7 is a good default). Reasoning models (GPT-5/6, o-series) ignore it unless Reasoning effort is None; it's left out automatically when a model rejects it."
				>
					<input
						id="ai-temp"
						type="range"
						min={0}
						max={2}
						step={0.1}
						value={current.temperature}
						onChange={(e) => update({ temperature: Number(e.target.value) })}
						className="w-full max-w-sm"
					/>
				</Field>
				<Field
					label="Reasoning effort"
					htmlFor={effortId}
					hint="Only applies to reasoning models (GPT-6, gpt-oss, DeepSeek, Gemini 3…): lower is faster and cheaper. Values a model doesn't support are switched to the nearest one or dropped automatically."
				>
					<NativeSelect
						id={effortId}
						value={current.reasoningEffort}
						onChange={(e) =>
							update({
								reasoningEffort: isReasoningEffort(e.target.value)
									? e.target.value
									: "",
							})
						}
						className="max-w-sm"
					>
						{EFFORT_OPTIONS.map((o) => (
							<option key={o.value || "default"} value={o.value}>
								{o.label}
							</option>
						))}
					</NativeSelect>
				</Field>
			</div>

			{error ? (
				<ErrorNotice error={error} title="Couldn't finish that" />
			) : null}
			{testResult ? (
				<Notice tone="success" icon={CircleCheck} title="Connection works">
					{testResult}
				</Notice>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => void onSave()}
					disabled={busy !== null || !dirty}
				>
					{busy === "save" ? (
						<LoaderCircle className="animate-spin" />
					) : (
						<Save />
					)}
					Save
				</Button>
				<Button
					variant="outline"
					onClick={() => void onTest()}
					disabled={busy !== null}
				>
					{busy === "test" ? (
						<LoaderCircle className="animate-spin" />
					) : (
						<PlugZap />
					)}
					{dirty ? "Save & test" : "Test connection"}
				</Button>
				{dirty ? (
					<Button
						variant="ghost"
						onClick={() => {
							setDraft(saved);
							setError(null);
							setTestResult(null);
						}}
						disabled={busy !== null}
					>
						<RotateCcw /> Revert
					</Button>
				) : null}
				{dirty ? (
					<span className="text-[11px] text-amber-600 dark:text-amber-400">
						Unsaved changes
					</span>
				) : null}
			</div>
			<p className="text-muted-foreground text-[11px] leading-relaxed">
				Chrome asks once for permission to reach {origin ?? "the provider"} when
				you save. Requests go straight from your browser to the provider;
				open-vidiq has no server in between.
			</p>
		</Section>
	);
}

/** Warns when the chosen model is deprecated / shut down, with a one-click replacement. */
function DeprecationNotice({
	kind,
	id,
	settings,
	listed,
	onUse,
}: {
	kind: ModelKind;
	id: string;
	settings: AiProviderSettings;
	listed: AiModelInfo | undefined;
	onUse: (replacement: string) => void;
}) {
	const dep = findDeprecation(id, kind, settings, listed);
	if (!dep) return null;
	const model = id.trim();
	return (
		<Notice
			tone="warning"
			title={
				dep.status === "shutdown"
					? `"${model}" has been shut down`
					: `"${model}" is deprecated`
			}
			actions={
				dep.replacement ? (
					<Button
						size="xs"
						variant="outline"
						onClick={() => onUse(dep.replacement as string)}
					>
						Use {dep.replacement}
					</Button>
				) : null
			}
		>
			{dep.status === "shutdown"
				? `The provider retired it${dep.date ? ` on ${dep.date}` : ""}, so requests will fail.`
				: `The provider shuts it down on ${dep.date}.`}
			{dep.replacement
				? ` Suggested replacement: ${dep.replacement}.`
				: " Load models to pick a current one."}
		</Notice>
	);
}

export function StatusLine({
	loading,
	ready,
	text,
}: {
	loading: boolean;
	ready: boolean;
	text: string;
}) {
	return (
		<div
			className={cn(
				"flex items-center gap-2 px-2.5 py-1.5 text-xs",
				ready ? "bg-emerald-500/10" : "bg-amber-500/10",
			)}
		>
			{loading ? (
				<LoaderCircle className="text-muted-foreground size-3.5 animate-spin" />
			) : ready ? (
				<CircleCheck className="size-3.5 text-emerald-500" />
			) : (
				<span className="size-2 rounded-full bg-amber-500" />
			)}
			<span className="min-w-0 flex-1 truncate" title={text}>
				{text}
			</span>
		</div>
	);
}
