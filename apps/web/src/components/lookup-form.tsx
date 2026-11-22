import { Button } from "@open-vidiq/ui/components/button";
import { Input } from "@open-vidiq/ui/components/input";
import { cn } from "@open-vidiq/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { ApiError, errorMessage, resolveChannelHandle } from "@/lib/api";
import { resolveLookup } from "@/lib/lookup";

interface LookupFormProps {
	size?: "default" | "lg";
	autoFocus?: boolean;
	placeholder?: string;
	className?: string;
}

/**
 * Paste a YouTube video/channel URL or id and jump to its stats page. Plain
 * keywords fall through to a trending search.
 */
export function LookupForm({
	size = "default",
	autoFocus,
	placeholder = "Paste a YouTube video or channel link…",
	className,
}: LookupFormProps) {
	const navigate = useNavigate();
	const inputId = useId();
	const messageId = useId();
	const [value, setValue] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [resolving, setResolving] = useState(false);

	async function openHandle(handle: string) {
		setMessage(null);
		setResolving(true);
		try {
			const channel = await resolveChannelHandle(handle);
			setValue("");
			navigate({
				to: "/channel/$channelId",
				params: { channelId: channel.channelId },
				state: { channelTitle: channel.title ?? channel.handle ?? undefined },
			});
		} catch (error) {
			setMessage(
				error instanceof ApiError && error.isNotFound
					? `open-vidiq hasn't seen ${handle} yet. Visit the channel on YouTube with the extension installed, or paste its /channel/UC… link (Share → Copy channel ID).`
					: errorMessage(error),
			);
		} finally {
			setResolving(false);
		}
	}

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (resolving) return;
		const target = resolveLookup(value);
		switch (target.kind) {
			case "video":
				setMessage(null);
				setValue("");
				navigate({
					to: "/video/$videoId",
					params: { videoId: target.videoId },
				});
				return;
			case "channel":
				setMessage(null);
				setValue("");
				navigate({
					to: "/channel/$channelId",
					params: { channelId: target.channelId },
				});
				return;
			case "search":
				setMessage(null);
				navigate({ to: "/trending", search: { q: target.query } });
				return;
			case "handle":
				void openHandle(target.handle);
				return;
			case "invalid":
				setMessage(target.reason);
				return;
		}
	}

	const large = size === "lg";

	return (
		<form onSubmit={onSubmit} className={cn("w-full", className)} noValidate>
			<label htmlFor={inputId} className="sr-only">
				YouTube video or channel link
			</label>
			<div className="flex gap-2">
				<div className="relative min-w-0 flex-1">
					<Search
						aria-hidden="true"
						className={cn(
							"text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2",
							large ? "size-4" : "size-3.5",
						)}
					/>
					<Input
						id={inputId}
						value={value}
						onChange={(event) => {
							setValue(event.target.value);
							if (message) setMessage(null);
						}}
						placeholder={placeholder}
						autoFocus={autoFocus}
						autoComplete="off"
						spellCheck={false}
						inputMode="url"
						aria-invalid={message ? true : undefined}
						aria-describedby={message ? messageId : undefined}
						className={cn(large ? "h-11 pl-9 text-sm md:text-sm" : "pl-8")}
					/>
				</div>
				<Button
					type="submit"
					size={large ? "lg" : "default"}
					className={cn(large && "h-11 px-4")}
					disabled={resolving}
					aria-busy={resolving || undefined}
				>
					{resolving ? "Looking up…" : "Look up"}
					<ArrowRight aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
			<p
				id={messageId}
				aria-live="polite"
				className={cn("text-destructive text-xs", message && "mt-2")}
			>
				{message}
			</p>
		</form>
	);
}
