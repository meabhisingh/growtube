import { cn } from "@growtube/ui/lib/utils";

export interface SegmentedOption<T extends string> {
	value: T;
	label: string;
	/** Longer explanation shown as a native tooltip. */
	title?: string;
}

interface SegmentedProps<T extends string> {
	/** Accessible name of the group, e.g. "Time range". */
	label: string;
	value: T;
	options: readonly SegmentedOption<T>[];
	onChange: (value: T) => void;
	className?: string;
}

/** A compact row of toggle buttons where exactly one is pressed. */
export function Segmented<T extends string>({
	label,
	value,
	options,
	onChange,
	className,
}: SegmentedProps<T>) {
	return (
		<fieldset
			className={cn(
				"bg-muted/60 border-border/60 inline-flex max-w-full gap-0.5 overflow-x-auto rounded-xl border p-1",
				className,
			)}
		>
			<legend className="sr-only">{label}</legend>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<button
						key={option.value}
						type="button"
						aria-pressed={selected}
						title={option.title}
						onClick={() => {
							if (!selected) onChange(option.value);
						}}
						className={cn(
							"focus-visible:ring-ring/50 h-7 shrink-0 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition duration-150 ease-out outline-none focus-visible:ring-2 motion-safe:active:scale-[0.97]",
							selected
								? "bg-background text-foreground ring-foreground/5 dark:bg-foreground/10 dark:ring-foreground/10 shadow-sm ring-1"
								: "text-muted-foreground hover:text-foreground hover:bg-foreground/5",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}
