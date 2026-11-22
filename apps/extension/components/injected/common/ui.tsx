/** Small presentational building blocks for the injected React UIs (styles/ui.css). */
import { AlertCircle, Info, RefreshCw } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";

import { errorMessage } from "./async";

export function Card({
	title,
	actions,
	children,
	className,
}: {
	title?: ReactNode;
	actions?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={className ? `ovq-card ${className}` : "ovq-card"}>
			{(title || actions) && (
				<div className="ovq-card-head">
					{title && (
						<h3 className="ovq-card-title" style={{ margin: 0 }}>
							{title}
						</h3>
					)}
					{actions && <div className="ovq-card-actions">{actions}</div>}
				</div>
			)}
			{children}
		</section>
	);
}

export function Skeleton({
	width = "100%",
	height = 14,
	style,
}: {
	width?: number | string;
	height?: number | string;
	style?: CSSProperties;
}) {
	return (
		<span
			className="ovq-skeleton"
			style={{ width, height, ...style }}
			aria-hidden="true"
		/>
	);
}

export function Spinner({ label = "Loading" }: { label?: string }) {
	return <span className="ovq-spinner" role="status" aria-label={label} />;
}

export function Note({
	tone = "info",
	children,
}: {
	tone?: "info" | "error" | "warn" | "good";
	children: ReactNode;
}) {
	const Icon = tone === "error" || tone === "warn" ? AlertCircle : Info;
	return (
		<div
			className={tone === "info" ? "ovq-note" : `ovq-note ${tone}`}
			role={tone === "error" ? "alert" : undefined}
		>
			<Icon size={14} aria-hidden="true" />
			<div>{children}</div>
		</div>
	);
}

export function ErrorNote({
	error,
	onRetry,
	prefix,
}: {
	error: unknown;
	onRetry?: () => void;
	prefix?: string;
}) {
	return (
		<Note tone="error">
			{prefix ? `${prefix} ` : ""}
			{errorMessage(error)}
			{onRetry && (
				<>
					{" "}
					<button type="button" className="ovq-link-btn" onClick={onRetry}>
						<RefreshCw size={12} aria-hidden="true" /> Retry
					</button>
				</>
			)}
		</Note>
	);
}

export type TabDef<T extends string> = { id: T; label: string };

/** Accessible tab list (arrow keys move between tabs). */
export function Tabs<T extends string>({
	tabs,
	value,
	onChange,
	label,
	idPrefix,
}: {
	tabs: readonly TabDef<T>[];
	value: T;
	onChange: (id: T) => void;
	label: string;
	idPrefix: string;
}) {
	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		e.preventDefault();
		const i = tabs.findIndex((t) => t.id === value);
		const next =
			tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
		if (next) onChange(next.id);
	};
	return (
		<div
			className="ovq-tabs"
			role="tablist"
			aria-label={label}
			onKeyDown={onKeyDown}
		>
			{tabs.map((t) => (
				<button
					key={t.id}
					type="button"
					role="tab"
					id={`${idPrefix}-tab-${t.id}`}
					aria-controls={`${idPrefix}-panel-${t.id}`}
					aria-selected={t.id === value}
					tabIndex={t.id === value ? 0 : -1}
					className="ovq-tab"
					onClick={() => onChange(t.id)}
				>
					{t.label}
				</button>
			))}
		</div>
	);
}

/** Pill-style segmented control (range pickers, toggles). */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	label,
}: {
	options: readonly { id: T; label: string }[];
	value: T;
	onChange: (id: T) => void;
	label: string;
}) {
	return (
		<fieldset
			className="ovq-seg"
			aria-label={label}
			style={{ border: 0, margin: 0, padding: 0 }}
		>
			{options.map((o) => (
				<button
					key={o.id}
					type="button"
					aria-pressed={o.id === value}
					onClick={() => onChange(o.id)}
				>
					{o.label}
				</button>
			))}
		</fieldset>
	);
}

export function Stat({
	label,
	value,
	hint,
	tone,
	loading,
	icon,
}: {
	label: string;
	value: ReactNode;
	hint?: string;
	tone?: string | null;
	loading?: boolean;
	icon?: ReactNode;
}) {
	return (
		<div className="ovq-stat" title={hint}>
			<div className="ovq-stat-label">
				{icon}
				{label}
			</div>
			{loading ? (
				<Skeleton width="70%" height={20} style={{ marginTop: 4 }} />
			) : (
				<div className={tone ? `ovq-stat-value ${tone}` : "ovq-stat-value"}>
					{value}
				</div>
			)}
		</div>
	);
}
