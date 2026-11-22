/** Form controls shared by the extension pages. */
import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@open-vidiq/ui/components/tooltip";
import { cn } from "@open-vidiq/ui/lib/utils";
import { Info, LoaderCircle, type LucideIcon, Search } from "lucide-react";
import {
	type ComponentProps,
	type FormEvent,
	type ReactNode,
	useId,
} from "react";

// ---------------------------------------------------------------------------
// Segmented control
// ---------------------------------------------------------------------------

export type SegmentOption<T extends string> = {
	value: T;
	label: ReactNode;
	icon?: LucideIcon;
	title?: string;
};

export function Segmented<T extends string>({
	value,
	onChange,
	options,
	className,
	size = "sm",
	ariaLabel,
}: {
	value: T;
	onChange: (value: T) => void;
	options: readonly SegmentOption<T>[];
	className?: string;
	size?: "xs" | "sm";
	ariaLabel?: string;
}) {
	return (
		<fieldset
			aria-label={ariaLabel}
			className={cn(
				"bg-muted inline-flex min-w-0 shrink-0 items-center gap-0.5 p-0.5",
				className,
			)}
		>
			{options.map((o) => {
				const active = o.value === value;
				const Icon = o.icon;
				return (
					<button
						key={o.value}
						type="button"
						aria-pressed={active}
						title={o.title}
						onClick={() => onChange(o.value)}
						className={cn(
							"focus-visible:ring-ring inline-flex items-center justify-center gap-1 px-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
							size === "xs" ? "h-6" : "h-7",
							active
								? "bg-background text-foreground dark:bg-accent shadow-xs"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{Icon ? <Icon className="size-3.5" aria-hidden /> : null}
						{o.label}
					</button>
				);
			})}
		</fieldset>
	);
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({
	checked,
	onCheckedChange,
	disabled,
	id,
	ariaLabel,
	className,
}: {
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	id?: string;
	ariaLabel?: string;
	className?: string;
}) {
	return (
		<button
			id={id}
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={ariaLabel}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				"focus-visible:ring-ring/60 relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-brand" : "bg-input dark:bg-input",
				className,
			)}
		>
			<span
				className={cn(
					"inline-block size-4 rounded-full bg-white shadow-sm transition-transform",
					checked ? "translate-x-4.5" : "translate-x-0.5",
				)}
			/>
		</button>
	);
}

/** Row with a title, description and a switch on the right. */
export function SwitchRow({
	title,
	description,
	checked,
	onCheckedChange,
	disabled,
	icon: Icon,
}: {
	title: ReactNode;
	description?: ReactNode;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
	icon?: LucideIcon;
}) {
	const id = useId();
	return (
		<div className="flex items-start gap-3 py-2.5">
			{Icon ? (
				<Icon
					className="text-muted-foreground mt-0.5 size-4 shrink-0"
					aria-hidden
				/>
			) : null}
			<label
				htmlFor={id}
				className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
			>
				<span className="text-xs font-medium">{title}</span>
				{description ? (
					<span className="text-muted-foreground text-xs leading-relaxed">
						{description}
					</span>
				) : null}
			</label>
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onCheckedChange}
				disabled={disabled}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Native select
// ---------------------------------------------------------------------------

export function NativeSelect({
	className,
	children,
	...props
}: ComponentProps<"select">) {
	return (
		<select
			className={cn(
				"border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground h-8 min-w-0 border px-2 text-xs outline-none focus-visible:ring-1 disabled:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
		</select>
	);
}

// ---------------------------------------------------------------------------
// Field wrapper
// ---------------------------------------------------------------------------

export function Field({
	label,
	hint,
	htmlFor,
	children,
	className,
	trailing,
}: {
	label: ReactNode;
	hint?: ReactNode;
	htmlFor?: string;
	children: ReactNode;
	className?: string;
	/** Right-aligned extra in the label row (counter, link…) */
	trailing?: ReactNode;
}) {
	return (
		<div className={cn("flex flex-col gap-1.5", className)}>
			<div className="flex items-center justify-between gap-2">
				<label htmlFor={htmlFor} className="text-xs font-medium">
					{label}
				</label>
				{trailing}
			</div>
			{children}
			{hint ? (
				<div className="text-muted-foreground text-[11px] leading-relaxed">
					{hint}
				</div>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------

/** Small (i) icon with an explanatory tooltip. */
export function InfoTip({
	children,
	label = "More info",
	className,
	side = "top",
}: {
	children: ReactNode;
	label?: string;
	className?: string;
	side?: "top" | "bottom" | "left" | "right";
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={label}
						className={cn(
							"text-muted-foreground hover:text-foreground focus-visible:text-foreground inline-flex size-4 shrink-0 items-center justify-center outline-none",
							className,
						)}
					/>
				}
			>
				<Info className="size-3.5" aria-hidden />
			</TooltipTrigger>
			<TooltipContent
				side={side}
				className="block max-w-72 text-left leading-relaxed whitespace-normal"
			>
				{children}
			</TooltipContent>
		</Tooltip>
	);
}

/** Icon-only button with a tooltip label (also its accessible name). */
export function IconButton({
	label,
	icon: Icon,
	onClick,
	disabled,
	variant = "ghost",
	size = "icon-sm",
	className,
	active,
	side = "bottom",
}: {
	label: string;
	icon: LucideIcon;
	onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
	disabled?: boolean;
	variant?: "ghost" | "outline" | "secondary" | "default" | "destructive";
	size?: "icon" | "icon-sm" | "icon-xs" | "icon-lg";
	className?: string;
	active?: boolean;
	side?: "top" | "bottom" | "left" | "right";
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant={variant}
						size={size}
						onClick={onClick}
						disabled={disabled}
						aria-label={label}
						aria-pressed={active}
						className={cn(active && "bg-muted text-foreground", className)}
					/>
				}
			>
				<Icon aria-hidden />
			</TooltipTrigger>
			<TooltipContent side={side}>{label}</TooltipContent>
		</Tooltip>
	);
}

// ---------------------------------------------------------------------------
// Search form
// ---------------------------------------------------------------------------

/** Input + submit button; submits on Enter. */
export function SearchForm({
	value,
	onChange,
	onSubmit,
	placeholder,
	buttonLabel = "Search",
	loading,
	disabled,
	icon: Icon = Search,
	autoFocus,
	className,
	inputLabel,
}: {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	placeholder?: string;
	buttonLabel?: ReactNode;
	loading?: boolean;
	disabled?: boolean;
	icon?: LucideIcon;
	autoFocus?: boolean;
	className?: string;
	inputLabel?: string;
}) {
	const submit = (e: FormEvent) => {
		e.preventDefault();
		const v = value.trim();
		if (v) onSubmit(v);
	};
	return (
		<form onSubmit={submit} className={cn("flex gap-1.5", className)}>
			<div className="relative min-w-0 flex-1">
				<Icon
					className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
					aria-hidden
				/>
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					aria-label={inputLabel ?? placeholder}
					className="h-8 pl-8"
					autoFocus={autoFocus}
				/>
			</div>
			<Button
				type="submit"
				disabled={disabled || loading || !value.trim()}
				className="h-8"
			>
				{loading ? <LoaderCircle className="animate-spin" /> : null}
				{buttonLabel}
			</Button>
		</form>
	);
}
