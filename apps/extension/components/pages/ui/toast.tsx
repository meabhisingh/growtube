/**
 * Minimal toasts for the extension pages (the shared sonner Toaster's
 * `toast()` isn't a dependency of the extension).
 *
 *   toast("Removed MrBeast", { action: { label: "Undo", onClick: restore } });
 *   <Toasts />  // once per page
 */
import { cn } from "@open-vidiq/ui/lib/utils";
import { CircleCheck, CircleX, Info, X } from "lucide-react";
import { useEffect, useState } from "react";

type ToastTone = "info" | "success" | "error";

export type ToastItem = {
	id: number;
	message: string;
	tone: ToastTone;
	action?: { label: string; onClick: () => void };
	durationMs: number;
};

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
	for (const l of listeners) l(items);
}

export function dismissToast(id: number) {
	items = items.filter((t) => t.id !== id);
	emit();
}

export function toast(
	message: string,
	opts: {
		tone?: ToastTone;
		action?: ToastItem["action"];
		durationMs?: number;
	} = {},
): number {
	const id = ++seq;
	items = [
		...items.slice(-3),
		{
			id,
			message,
			tone: opts.tone ?? "info",
			action: opts.action,
			durationMs: opts.durationMs ?? (opts.action ? 6_000 : 3_500),
		},
	];
	emit();
	return id;
}

const ICONS = { info: Info, success: CircleCheck, error: CircleX } as const;

export function Toasts() {
	const [list, setList] = useState<ToastItem[]>(items);
	useEffect(() => {
		listeners.add(setList);
		return () => {
			listeners.delete(setList);
		};
	}, []);
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-1.5 px-3"
		>
			{list.map((t) => (
				<ToastView key={t.id} item={t} />
			))}
		</div>
	);
}

function ToastView({ item }: { item: ToastItem }) {
	useEffect(() => {
		const timer = setTimeout(() => dismissToast(item.id), item.durationMs);
		return () => clearTimeout(timer);
	}, [item.id, item.durationMs]);
	const Icon = ICONS[item.tone];
	return (
		<div
			role="status"
			className="animate-in bg-popover text-popover-foreground ring-foreground/10 fade-in-0 slide-in-from-bottom-2 pointer-events-auto flex w-full max-w-sm items-center gap-2 px-3 py-2 text-xs shadow-lg ring-1"
		>
			<Icon
				className={cn(
					"size-4 shrink-0",
					item.tone === "success" && "text-emerald-500",
					item.tone === "error" && "text-red-500",
					item.tone === "info" && "text-muted-foreground",
				)}
				aria-hidden
			/>
			<span className="min-w-0 flex-1">{item.message}</span>
			{item.action ? (
				<button
					type="button"
					onClick={() => {
						item.action?.onClick();
						dismissToast(item.id);
					}}
					className="text-brand shrink-0 font-semibold hover:underline"
				>
					{item.action.label}
				</button>
			) : null}
			<button
				type="button"
				onClick={() => dismissToast(item.id)}
				aria-label="Dismiss"
				className="text-muted-foreground hover:text-foreground shrink-0"
			>
				<X className="size-3.5" />
			</button>
		</div>
	);
}
