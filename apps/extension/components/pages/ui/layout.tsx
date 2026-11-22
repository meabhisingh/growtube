/** Layout building blocks: sections, stat tiles, collapsibles. */
import { cn } from "@open-vidiq/ui/lib/utils";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

/** Titled block inside a tool or settings page. */
export function Section({
	title,
	description,
	actions,
	children,
	className,
	icon: Icon,
	id,
	bodyClassName,
}: {
	title?: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	children?: ReactNode;
	className?: string;
	icon?: LucideIcon;
	id?: string;
	bodyClassName?: string;
}) {
	return (
		<section
			id={id}
			className={cn(
				"bg-card ring-foreground/8 flex flex-col gap-3 p-3 ring-1",
				className,
			)}
		>
			{title || actions ? (
				<header className="flex items-start justify-between gap-2">
					<div className="flex min-w-0 flex-col gap-0.5">
						{title ? (
							<h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
								{Icon ? (
									<Icon className="text-brand size-4" aria-hidden />
								) : null}
								{title}
							</h2>
						) : null}
						{description ? (
							<p className="text-muted-foreground text-xs leading-relaxed">
								{description}
							</p>
						) : null}
					</div>
					{actions ? (
						<div className="flex shrink-0 items-center gap-1">{actions}</div>
					) : null}
				</header>
			) : null}
			{children ? (
				<div className={cn("flex flex-col gap-3", bodyClassName)}>
					{children}
				</div>
			) : null}
		</section>
	);
}

export function StatTile({
	label,
	value,
	sub,
	className,
	title,
}: {
	label: ReactNode;
	value: ReactNode;
	sub?: ReactNode;
	className?: string;
	title?: string;
}) {
	return (
		<div
			className={cn(
				"bg-surface-2 flex min-w-0 flex-col gap-0.5 px-2.5 py-2",
				className,
			)}
			title={title}
		>
			<div className="text-muted-foreground truncate text-[11px]">{label}</div>
			<div className="ovq-num truncate text-sm font-semibold">{value}</div>
			{sub ? (
				<div className="text-muted-foreground truncate text-[11px]">{sub}</div>
			) : null}
		</div>
	);
}

export function StatGrid({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-1.5",
				className,
			)}
		>
			{children}
		</div>
	);
}

/** Disclosure with a header row; content mounts on first open. */
export function Collapsible({
	summary,
	children,
	defaultOpen = false,
	className,
}: {
	summary: ReactNode;
	children: ReactNode;
	defaultOpen?: boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(defaultOpen);
	const [mounted, setMounted] = useState(defaultOpen);
	return (
		<div className={cn("flex flex-col", className)}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => {
					setOpen((o) => !o);
					setMounted(true);
				}}
				className="text-muted-foreground hover:text-foreground focus-visible:text-foreground flex items-center gap-1.5 py-1 text-left text-xs outline-none"
			>
				<ChevronDown
					className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
					aria-hidden
				/>
				{summary}
			</button>
			{mounted ? (
				<div className={cn("pt-2", !open && "hidden")}>{children}</div>
			) : null}
		</div>
	);
}

/** Uppercase mini heading inside sections. */
export function Eyebrow({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"text-muted-foreground text-[10px] font-semibold tracking-wider uppercase",
				className,
			)}
		>
			{children}
		</div>
	);
}
