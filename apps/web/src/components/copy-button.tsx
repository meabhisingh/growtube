import { Button } from "@open-vidiq/ui/components/button";
import { cn } from "@open-vidiq/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface CopyButtonProps {
	value: string;
	/** Accessible label, e.g. "Copy command". */
	label?: string;
	className?: string;
	/** Show the label next to the icon. */
	showLabel?: boolean;
}

export function CopyButton({
	value,
	label = "Copy",
	className,
	showLabel = false,
}: CopyButtonProps) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1800);
		return () => window.clearTimeout(id);
	}, [copied]);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
		} catch {
			toast.error("Couldn't copy. Select the text and copy it manually.");
		}
	}

	const Icon = copied ? Check : Copy;
	return (
		<Button
			type="button"
			variant="ghost"
			size={showLabel ? "sm" : "icon-sm"}
			onClick={copy}
			aria-label={showLabel ? undefined : copied ? "Copied" : label}
			className={cn("shrink-0", className)}
		>
			<Icon aria-hidden="true" />
			{showLabel && (copied ? "Copied" : label)}
		</Button>
	);
}

interface CodeBlockProps {
	code: string;
	/** Small caption above the code, e.g. "Terminal" or a file name. */
	caption?: string;
	className?: string;
}

export function CodeBlock({ code, caption, className }: CodeBlockProps) {
	return (
		<div className={cn("bg-muted/40 min-w-0 border", className)}>
			<div className="flex items-center justify-between gap-2 border-b py-0.5 pr-0.5 pl-3">
				<span className="text-muted-foreground truncate text-[11px]">
					{caption ?? " "}
				</span>
				<CopyButton
					value={code}
					label={caption ? `Copy ${caption}` : "Copy code"}
				/>
			</div>
			<pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed">
				<code>{code}</code>
			</pre>
		</div>
	);
}

/** Inline monospace snippet with a copy button, for one-line values like URLs. */
export function CopyField({
	value,
	label,
	className,
}: {
	value: string;
	label: string;
	className?: string;
}) {
	return (
		<div
			className={cn("bg-muted/40 flex min-w-0 items-center border", className)}
		>
			<code
				className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-xs"
				title={value}
			>
				{value}
			</code>
			<CopyButton value={value} label={label} />
		</div>
	);
}
