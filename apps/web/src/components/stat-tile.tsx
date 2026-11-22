import { Skeleton } from "@growtube/ui/components/skeleton";
import { cn } from "@growtube/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface StatTileProps {
	label: string;
	value: ReactNode;
	hint?: ReactNode;
	icon?: LucideIcon;
	loading?: boolean;
	/** Exact value for the native tooltip when `value` is abbreviated. */
	title?: string;
	className?: string;
}

export function StatTile({
	label,
	value,
	hint,
	icon: Icon,
	loading,
	title,
	className,
}: StatTileProps) {
	return (
		<div
			className={cn(
				"bg-card ring-foreground/8 flex min-w-0 flex-col gap-1 rounded-xl p-3.5 shadow-xs ring-1",
				className,
			)}
		>
			<div className="text-muted-foreground flex items-center gap-1.5 text-xs">
				{Icon && <Icon className="size-3.5 shrink-0" aria-hidden="true" />}
				<span className="truncate">{label}</span>
			</div>
			{loading ? (
				<Skeleton className="h-7 w-20 rounded-md" />
			) : (
				<div
					className="truncate text-xl font-semibold tracking-tight tabular-nums"
					title={title}
				>
					{value}
				</div>
			)}
			{hint && !loading && (
				<div className="text-muted-foreground truncate text-[11px]">{hint}</div>
			)}
		</div>
	);
}
