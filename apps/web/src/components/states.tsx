import { Button } from "@open-vidiq/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@open-vidiq/ui/components/empty";
import { cn } from "@open-vidiq/ui/lib/utils";
import { type LucideIcon, RefreshCw, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { errorMessage } from "@/lib/api";

interface EmptyStateProps {
	icon: LucideIcon;
	title: string;
	description?: ReactNode;
	children?: ReactNode;
	className?: string;
	role?: "alert" | "status";
}

export function EmptyState({
	icon: Icon,
	title,
	description,
	children,
	className,
	role,
}: EmptyStateProps) {
	return (
		<Empty role={role} className={cn("border", className)}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<Icon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				{description && <EmptyDescription>{description}</EmptyDescription>}
			</EmptyHeader>
			{children && (
				<EmptyContent className="flex-row flex-wrap justify-center">
					{children}
				</EmptyContent>
			)}
		</Empty>
	);
}

interface ErrorStateProps {
	title?: string;
	error: unknown;
	onRetry?: () => void;
	retrying?: boolean;
	className?: string;
}

export function ErrorState({
	title = "Couldn't load this data",
	error,
	onRetry,
	retrying,
	className,
}: ErrorStateProps) {
	return (
		<EmptyState
			role="alert"
			icon={TriangleAlert}
			title={title}
			description={errorMessage(error)}
			className={className}
		>
			{onRetry && (
				<Button variant="outline" onClick={onRetry} disabled={retrying}>
					<RefreshCw
						className={cn(retrying && "animate-spin")}
						aria-hidden="true"
					/>
					Try again
				</Button>
			)}
		</EmptyState>
	);
}

/** Thin inline banner for a failed background refresh while stale data stays visible. */
export function StaleBanner({
	error,
	onRetry,
}: {
	error: unknown;
	onRetry: () => void;
}) {
	return (
		<div
			role="status"
			className="border-destructive/30 bg-destructive/5 flex flex-wrap items-center justify-between gap-2 border px-3 py-2 text-xs"
		>
			<span className="text-destructive flex items-center gap-2">
				<TriangleAlert className="size-3.5" aria-hidden="true" />
				Couldn't refresh: {errorMessage(error)}
			</span>
			<Button size="xs" variant="outline" onClick={onRetry}>
				Retry
			</Button>
		</div>
	);
}
