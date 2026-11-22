/** Loading, empty and error states for the extension pages. */
import { Button } from "@open-vidiq/ui/components/button";
import { Skeleton } from "@open-vidiq/ui/components/skeleton";
import { cn } from "@open-vidiq/ui/lib/utils";
import {
	CircleAlert,
	Info,
	LoaderCircle,
	LogIn,
	type LucideIcon,
	RefreshCw,
	Settings,
	TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { ACCOUNT_SECTION } from "@/lib/auth";
import { ext } from "@/lib/client";

import { describeError } from "../utils";

export function Spinner({ className }: { className?: string }) {
	return (
		<LoaderCircle
			className={cn("text-muted-foreground size-4 animate-spin", className)}
			aria-label="Loading"
		/>
	);
}

/** Centered spinner with a caption, for whole-section loads. */
export function LoadingBlock({
	label = "Loading…",
	className,
}: {
	label?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"text-muted-foreground flex items-center justify-center gap-2 py-8 text-xs",
				className,
			)}
			role="status"
		>
			<Spinner />
			<span>{label}</span>
		</div>
	);
}

/** Placeholder rows shaped like a video list. */
export function SkeletonList({
	rows = 4,
	thumb = true,
}: {
	rows?: number;
	thumb?: boolean;
}) {
	return (
		<div className="flex flex-col gap-3" aria-hidden>
			{Array.from({ length: rows }, (_, i) => (
				<div key={i} className="flex gap-2.5">
					{thumb ? <Skeleton className="aspect-video w-28 shrink-0" /> : null}
					<div className="flex flex-1 flex-col gap-1.5 py-0.5">
						<Skeleton className="h-3 w-11/12" />
						<Skeleton className="h-3 w-2/3" />
						<Skeleton className="h-2.5 w-1/3" />
					</div>
				</div>
			))}
		</div>
	);
}

type NoticeTone = "info" | "warning" | "error" | "success";

const NOTICE: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
	info: {
		icon: Info,
		className: "border-sky-500/30 bg-sky-500/8 text-foreground",
	},
	warning: {
		icon: TriangleAlert,
		className: "border-amber-500/35 bg-amber-500/8 text-foreground",
	},
	error: {
		icon: CircleAlert,
		className: "border-red-500/35 bg-red-500/8 text-foreground",
	},
	success: {
		icon: Info,
		className: "border-emerald-500/35 bg-emerald-500/8 text-foreground",
	},
};

const ICON_COLOR: Record<NoticeTone, string> = {
	info: "text-sky-600 dark:text-sky-400",
	warning: "text-amber-600 dark:text-amber-400",
	error: "text-red-600 dark:text-red-400",
	success: "text-emerald-600 dark:text-emerald-400",
};

export function Notice({
	tone = "info",
	title,
	children,
	actions,
	className,
	icon,
}: {
	tone?: NoticeTone;
	title?: ReactNode;
	children?: ReactNode;
	actions?: ReactNode;
	className?: string;
	icon?: LucideIcon;
}) {
	const Icon = icon ?? NOTICE[tone].icon;
	return (
		<div
			className={cn(
				"flex gap-2.5 border px-3 py-2.5 text-xs",
				NOTICE[tone].className,
				className,
			)}
			role={tone === "error" ? "alert" : "status"}
		>
			<Icon
				className={cn("mt-0.5 size-4 shrink-0", ICON_COLOR[tone])}
				aria-hidden
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				{title ? <div className="font-medium">{title}</div> : null}
				{children ? (
					<div className="text-muted-foreground leading-relaxed [overflow-wrap:anywhere]">
						{children}
					</div>
				) : null}
				{actions ? (
					<div className="flex flex-wrap gap-1.5 pt-0.5">{actions}</div>
				) : null}
			</div>
		</div>
	);
}

/**
 * Error from `@/lib/client` with the fix it implies: open AI / server
 * settings, reload, or retry.
 */
export function ErrorNotice({
	error,
	onRetry,
	title,
	className,
}: {
	error: unknown;
	onRetry?: () => void;
	title?: ReactNode;
	className?: string;
}) {
	if (!error) return null;
	const info = describeError(error);
	return (
		<Notice
			tone="error"
			title={title ?? defaultTitle(info.action)}
			className={className}
			actions={
				<>
					{info.action === "ai-settings" ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => void ext.openOptions("ai")}
						>
							<Settings /> AI settings
						</Button>
					) : null}
					{info.action === "server-settings" ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => void ext.openOptions("server")}
						>
							<Settings /> Server settings
						</Button>
					) : null}
					{info.action === "sign-in" ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => void ext.openOptions(ACCOUNT_SECTION)}
						>
							<LogIn /> Sign in
						</Button>
					) : null}
					{info.action === "reload" ? (
						<Button
							size="xs"
							variant="outline"
							onClick={() => window.location.reload()}
						>
							<RefreshCw /> Reload
						</Button>
					) : null}
					{onRetry && info.action !== "reload" ? (
						<Button size="xs" variant="ghost" onClick={onRetry}>
							<RefreshCw /> Try again
						</Button>
					) : null}
				</>
			}
		>
			{info.message}
		</Notice>
	);
}

function defaultTitle(action: ReturnType<typeof describeError>["action"]) {
	switch (action) {
		case "ai-settings":
			return "AI provider needs attention";
		case "server-settings":
			return "Can't reach the open-vidiq server";
		case "sign-in":
			return "Sign in to open-vidiq";
		case "reload":
			return "open-vidiq was updated";
		default:
			return "Something went wrong";
	}
}

export function EmptyState({
	icon: Icon,
	title,
	children,
	action,
	className,
}: {
	icon?: LucideIcon;
	title: ReactNode;
	children?: ReactNode;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center gap-2 border border-dashed px-4 py-8 text-center",
				className,
			)}
		>
			{Icon ? (
				<div className="bg-brand-soft text-brand mb-1 flex size-9 items-center justify-center">
					<Icon className="size-4.5" aria-hidden />
				</div>
			) : null}
			<div className="text-sm font-medium">{title}</div>
			{children ? (
				<div className="text-muted-foreground max-w-xs text-xs leading-relaxed">
					{children}
				</div>
			) : null}
			{action ? <div className="mt-2 flex gap-2">{action}</div> : null}
		</div>
	);
}
