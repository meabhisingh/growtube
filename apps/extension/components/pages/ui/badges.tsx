/** Colored metric badges (scores, outliers, VPH). */
import { formatCompact, formatOutlier } from "@open-vidiq/shared/format";
import { outlierTier } from "@open-vidiq/shared/metrics";
import { cn } from "@open-vidiq/ui/lib/utils";
import { Flame, Zap } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export type Tone =
	| "neutral"
	| "brand"
	| "emerald"
	| "green"
	| "amber"
	| "orange"
	| "red"
	| "sky"
	| "violet";

const TONES: Record<Tone, string> = {
	neutral: "bg-muted text-muted-foreground ring-foreground/10",
	brand: "bg-brand-soft text-brand ring-brand/25",
	emerald:
		"bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300",
	green: "bg-lime-500/15 text-lime-700 ring-lime-500/30 dark:text-lime-300",
	amber: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-300",
	orange:
		"bg-orange-500/15 text-orange-700 ring-orange-500/30 dark:text-orange-300",
	red: "bg-red-500/15 text-red-700 ring-red-500/30 dark:text-red-300",
	sky: "bg-sky-500/15 text-sky-700 ring-sky-500/30 dark:text-sky-300",
	violet:
		"bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-300",
};

export function Badge({
	tone = "neutral",
	className,
	children,
	...props
}: ComponentProps<"span"> & { tone?: Tone }) {
	return (
		<span
			className={cn(
				"ovq-num inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px] leading-none font-medium ring-1 ring-inset",
				TONES[tone],
				className,
			)}
			{...props}
		>
			{children}
		</span>
	);
}

/** Tone for a 0–100 score where higher is better. */
export function scoreTone(score: number | null | undefined): Tone {
	if (score == null || !Number.isFinite(score)) return "neutral";
	if (score >= 80) return "emerald";
	if (score >= 60) return "green";
	if (score >= 40) return "amber";
	if (score >= 20) return "orange";
	return "red";
}

export function scoreLabel(score: number | null | undefined): string {
	if (score == null) return "Unknown";
	if (score >= 80) return "Excellent";
	if (score >= 60) return "Good";
	if (score >= 40) return "Fair";
	if (score >= 20) return "Poor";
	return "Very poor";
}

/** Level label for a 0–100 magnitude (volume, competition). */
export function levelLabel(score: number | null | undefined): string {
	if (score == null) return "Unknown";
	if (score >= 80) return "Very high";
	if (score >= 60) return "High";
	if (score >= 40) return "Medium";
	if (score >= 20) return "Low";
	return "Very low";
}

/**
 * 0–100 score badge. `invert` colors low values green (e.g. competition,
 * where lower is better).
 */
export function ScoreBadge({
	score,
	invert,
	loading,
	className,
	title,
	suffix,
}: {
	score: number | null | undefined;
	invert?: boolean;
	loading?: boolean;
	className?: string;
	title?: string;
	suffix?: ReactNode;
}) {
	if (loading) {
		return (
			<Badge className={cn("w-9 animate-pulse justify-center", className)}>
				…
			</Badge>
		);
	}
	const tone =
		score == null ? "neutral" : scoreTone(invert ? 100 - score : score);
	return (
		<Badge
			tone={tone}
			className={cn("min-w-9 justify-center", className)}
			title={title}
		>
			{score == null ? "–" : Math.round(score)}
			{suffix}
		</Badge>
	);
}

const OUTLIER_TONES: Record<
	NonNullable<ReturnType<typeof outlierTier>>,
	Tone
> = {
	low: "red",
	normal: "neutral",
	good: "green",
	great: "emerald",
	viral: "violet",
};

/** "3.2x" outlier badge (views ÷ channel median), colored by tier. */
export function OutlierBadge({
	score,
	loading,
	className,
}: {
	score: number | null | undefined;
	loading?: boolean;
	className?: string;
}) {
	if (loading)
		return (
			<Badge className={cn("animate-pulse", className)} title="Outlier score">
				…x
			</Badge>
		);
	if (score == null) return null;
	const tier = outlierTier(score);
	return (
		<Badge
			tone={tier ? OUTLIER_TONES[tier] : "neutral"}
			className={className}
			title="Outlier score: views compared with the channel's median video"
		>
			{tier === "viral" || tier === "great" ? (
				<Zap className="size-3" aria-hidden />
			) : null}
			{formatOutlier(score)}
		</Badge>
	);
}

/** Views-per-hour badge; hot videos (1K+/h) get a flame. */
export function VphBadge({
	vph,
	className,
	label = "/h",
}: {
	vph: number | null | undefined;
	className?: string;
	label?: string;
}) {
	if (vph == null || !Number.isFinite(vph)) return null;
	const hot = vph >= 1_000;
	return (
		<Badge
			tone={hot ? "orange" : vph >= 100 ? "amber" : "neutral"}
			className={className}
			title="Views per hour since upload"
		>
			{hot ? <Flame className="size-3" aria-hidden /> : null}
			{formatCompact(vph, vph < 10 ? 1 : 0)}
			{label}
		</Badge>
	);
}
