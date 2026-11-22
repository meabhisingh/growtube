/** Copy-to-clipboard button with "Copied" feedback. Shadow-root safe. */
import { Check, Copy } from "lucide-react";
import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";

export type CopyButtonProps = {
	/** Text to copy (or a function computing it at click time) */
	text: string | (() => string);
	/** Visible label; omit for an icon-only button */
	label?: ReactNode;
	copiedLabel?: ReactNode;
	/** Accessible name for the icon-only variant */
	title?: string;
	size?: number;
	onCopied?: () => void;
	className?: string;
	style?: CSSProperties;
	disabled?: boolean;
};

/** Clipboard API with a textarea fallback (needed in some content-script contexts). */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		try {
			const ta = document.createElement("textarea");
			ta.value = text;
			ta.setAttribute("readonly", "");
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand("copy");
			ta.remove();
			return ok;
		} catch {
			return false;
		}
	}
}

export function CopyButton({
	text,
	label,
	copiedLabel = "Copied",
	title = "Copy",
	size = 14,
	onCopied,
	className,
	style,
	disabled,
}: CopyButtonProps) {
	const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	const onClick = async (e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const ok = await copyText(typeof text === "function" ? text() : text);
		setState(ok ? "copied" : "failed");
		if (ok) onCopied?.();
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setState("idle"), 1_500);
	};

	const Icon = state === "copied" ? Check : Copy;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={state === "failed" ? "Copy failed" : title}
			aria-label={label ? undefined : title}
			className={className}
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 6,
				padding: label ? "4px 10px" : 5,
				border: "1px solid var(--ovq-border, rgba(127,127,127,0.35))",
				borderRadius: 6,
				background: "transparent",
				color: "inherit",
				font: "inherit",
				fontSize: 12,
				lineHeight: 1,
				cursor: disabled ? "default" : "pointer",
				opacity: disabled ? 0.5 : 1,
				...style,
			}}
		>
			<Icon size={size} aria-hidden="true" />
			{label ? <span>{state === "copied" ? copiedLabel : label}</span> : null}
		</button>
	);
}

export default CopyButton;
