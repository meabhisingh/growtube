import { cn } from "@open-vidiq/ui/lib/utils";

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
				"bg-muted/40 inline-flex max-w-full overflow-x-auto border p-0.5",
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
							"focus-visible:ring-ring h-7 shrink-0 px-2.5 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-1",
							selected
								? "bg-background text-foreground ring-foreground/10 shadow-xs ring-1"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}
