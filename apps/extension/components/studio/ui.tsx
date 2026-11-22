/** Small building blocks for the Studio panel (plain CSS classes, see style.css). */
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { BackgroundError, ext } from "@/lib/client";

export function cx(...parts: (string | false | null | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

export function Spinner({ size = 14 }: { size?: number }) {
	return <Loader2 size={size} className="ovq-spin" aria-hidden="true" />;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: "primary" | "default" | "ghost";
	small?: boolean;
	loading?: boolean;
	icon?: ReactNode;
};

export function Btn({
	variant = "default",
	small,
	loading,
	icon,
	children,
	className,
	disabled,
	...rest
}: BtnProps) {
	return (
		<button
			type="button"
			className={cx(
				"ovq-btn",
				`ovq-btn-${variant}`,
				small && "ovq-btn-sm",
				className,
			)}
			disabled={disabled || loading}
			{...rest}
		>
			{loading ? <Spinner size={small ? 12 : 14} /> : icon}
			{children ? <span>{children}</span> : null}
		</button>
	);
}

export function Section({
	id,
	title,
	badge,
	open,
	onToggle,
	children,
	actions,
}: {
	id: string;
	title: ReactNode;
	badge?: ReactNode;
	open: boolean;
	onToggle: (id: string, open: boolean) => void;
	children: ReactNode;
	actions?: ReactNode;
}) {
	const Chevron = open ? ChevronDown : ChevronRight;
	return (
		<section className={cx("ovq-section", open && "ovq-open")}>
			<div className="ovq-section-head">
				<button
					type="button"
					className="ovq-section-toggle"
					aria-expanded={open}
					aria-controls={`ovq-sec-${id}`}
					onClick={() => onToggle(id, !open)}
				>
					<Chevron size={14} aria-hidden="true" />
					<span className="ovq-section-title">{title}</span>
					{badge != null ? (
						<span className="ovq-section-badge">{badge}</span>
					) : null}
				</button>
				{actions ? <div className="ovq-section-actions">{actions}</div> : null}
			</div>
			{open ? (
				<div className="ovq-section-body" id={`ovq-sec-${id}`}>
					{children}
				</div>
			) : null}
		</section>
	);
}

export type NoticeKind = "info" | "ok" | "warn" | "error";

export function Notice({
	kind = "info",
	children,
	action,
}: {
	kind?: NoticeKind;
	children: ReactNode;
	action?: ReactNode;
}) {
	return (
		<div
			className={cx("ovq-notice", `ovq-notice-${kind}`)}
			role={kind === "error" ? "alert" : "status"}
		>
			<div className="ovq-notice-text">{children}</div>
			{action ? <div className="ovq-notice-action">{action}</div> : null}
		</div>
	);
}

/** Error message + the right follow-up button for AI/background errors. */
export function ErrorNotice({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry?: () => void;
}) {
	const code = error instanceof BackgroundError ? error.code : undefined;
	const message =
		error instanceof Error ? error.message : String(error ?? "Unknown error");
	const needsSetup = code === "NOT_CONFIGURED" || code === "PERMISSION";
	const invalidated = code === "CONTEXT_INVALIDATED";
	return (
		<Notice
			kind="error"
			action={
				needsSetup ? (
					<Btn small onClick={() => void ext.openOptions("ai").catch(() => {})}>
						Set up AI
					</Btn>
				) : invalidated ? (
					<Btn small onClick={() => location.reload()}>
						Reload
					</Btn>
				) : onRetry ? (
					<Btn small onClick={onRetry}>
						Retry
					</Btn>
				) : null
			}
		>
			{invalidated
				? "GrowTube was updated. Save your changes in Studio, then reload this tab."
				: message}
		</Notice>
	);
}

export function Meter({
	value,
	max,
	state,
}: {
	value: number;
	max: number;
	state: "ok" | "warn" | "bad";
}) {
	const pct = Math.max(0, Math.min(100, (value / max) * 100));
	return (
		<div className="ovq-meter" aria-hidden="true">
			<div
				className={cx("ovq-meter-fill", `ovq-${state}`)}
				style={{ width: `${pct}%` }}
			/>
		</div>
	);
}

export function scoreTone(score: number): "good" | "ok" | "warn" | "bad" {
	if (score >= 80) return "good";
	if (score >= 60) return "ok";
	if (score >= 40) return "warn";
	return "bad";
}

export function scoreLabel(score: number): string {
	if (score >= 80) return "Excellent";
	if (score >= 60) return "Good";
	if (score >= 40) return "Fair";
	return "Needs work";
}

export function ScoreRing({
	score,
	size = 76,
}: {
	score: number;
	size?: number;
}) {
	const stroke = 7;
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const tone = scoreTone(score);
	return (
		<div className="ovq-ring" style={{ width: size, height: size }}>
			<svg
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				aria-hidden="true"
			>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					className="ovq-ring-track"
					strokeWidth={stroke}
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					className={cx("ovq-ring-value", `ovq-tone-${tone}`)}
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={`${(score / 100) * c} ${c}`}
					transform={`rotate(-90 ${size / 2} ${size / 2})`}
				/>
			</svg>
			<div className="ovq-ring-label">
				<span className="ovq-ring-score">{score}</span>
				<span className="ovq-ring-max">/100</span>
			</div>
		</div>
	);
}

/** Small chip (tags, suggestions). */
export function Chip({
	children,
	onClick,
	title,
	active,
	tone,
}: {
	children: ReactNode;
	onClick?: () => void;
	title?: string;
	active?: boolean;
	tone?: "muted" | "accent";
}) {
	const className = cx(
		"ovq-chip",
		active && "ovq-chip-active",
		tone && `ovq-chip-${tone}`,
	);
	return onClick ? (
		<button type="button" className={className} onClick={onClick} title={title}>
			{children}
		</button>
	) : (
		<span className={className} title={title}>
			{children}
		</span>
	);
}

/** Runs a promise with a timeout; resolves `fallback` on timeout/failure. */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	fallback: T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((resolve) => {
				timer = setTimeout(() => resolve(fallback), ms);
			}),
		]);
	} catch {
		return fallback;
	} finally {
		if (timer) clearTimeout(timer);
	}
}
