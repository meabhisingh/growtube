/** Saved AI Coach conversations: open, rename, delete. */
import { formatRelative } from "@growtube/shared/format";
import { Button } from "@growtube/ui/components/button";
import { Input } from "@growtube/ui/components/input";
import { cn } from "@growtube/ui/lib/utils";
import {
	Check,
	MessagesSquare,
	Pencil,
	Plus,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { AiConversation } from "@/lib/settings";

import { IconButton } from "../../../ui/controls";
import { EmptyState } from "../../../ui/feedback";

export function ConversationList({
	conversations,
	activeId,
	onOpen,
	onNew,
	onRename,
	onDelete,
	onClearAll,
}: {
	conversations: AiConversation[];
	activeId: string | null;
	onOpen: (conversation: AiConversation) => void;
	onNew: () => void;
	onRename: (id: string, title: string) => void;
	onDelete: (id: string) => void;
	onClearAll: () => void;
}) {
	const [query, setQuery] = useState("");
	const [confirmClear, setConfirmClear] = useState(false);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
		if (!q) return sorted;
		return sorted.filter(
			(c) =>
				c.title.toLowerCase().includes(q) ||
				c.messages.some((m) => m.content.toLowerCase().includes(q)),
		);
	}, [conversations, query]);

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center gap-1.5 border-b p-2">
				<div className="relative min-w-0 flex-1">
					<Search
						className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
						aria-hidden
					/>
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search conversations"
						aria-label="Search conversations"
						className="pl-8"
					/>
				</div>
				<Button size="sm" onClick={onNew}>
					<Plus /> New
				</Button>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-2">
				{filtered.length === 0 ? (
					<EmptyState
						icon={MessagesSquare}
						title={query ? "No matches" : "No conversations yet"}
					>
						{query
							? "Try another word."
							: "Your chats with the coach are saved here, in this browser only."}
					</EmptyState>
				) : (
					<ul className="flex flex-col gap-0.5">
						{filtered.map((c) => (
							<ConversationRow
								key={c.id}
								conversation={c}
								active={c.id === activeId}
								onOpen={() => onOpen(c)}
								onRename={(title) => onRename(c.id, title)}
								onDelete={() => onDelete(c.id)}
							/>
						))}
					</ul>
				)}
			</div>
			{conversations.length > 0 ? (
				<div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-[11px]">
					<span>
						{conversations.length} conversation
						{conversations.length === 1 ? "" : "s"} · stored locally
					</span>
					{confirmClear ? (
						<span className="flex items-center gap-1">
							Delete all?
							<Button
								size="xs"
								variant="destructive"
								onClick={() => {
									onClearAll();
									setConfirmClear(false);
								}}
							>
								Delete
							</Button>
							<Button
								size="xs"
								variant="ghost"
								onClick={() => setConfirmClear(false)}
							>
								Cancel
							</Button>
						</span>
					) : (
						<Button
							size="xs"
							variant="ghost"
							onClick={() => setConfirmClear(true)}
						>
							Clear all
						</Button>
					)}
				</div>
			) : null}
		</div>
	);
}

function ConversationRow({
	conversation,
	active,
	onOpen,
	onRename,
	onDelete,
}: {
	conversation: AiConversation;
	active: boolean;
	onOpen: () => void;
	onRename: (title: string) => void;
	onDelete: () => void;
}) {
	const [editing, setEditing] = useState(false);
	const [title, setTitle] = useState(conversation.title);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const count = conversation.messages.filter((m) => m.role === "user").length;

	if (editing) {
		const save = () => {
			const t = title.trim();
			if (t) onRename(t);
			setEditing(false);
		};
		return (
			<li className="flex items-center gap-1 px-1 py-1">
				<Input
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") save();
						if (e.key === "Escape") setEditing(false);
					}}
					aria-label="Conversation title"
					autoFocus
				/>
				<IconButton label="Save" icon={Check} onClick={save} />
				<IconButton label="Cancel" icon={X} onClick={() => setEditing(false)} />
			</li>
		);
	}

	return (
		<li
			className={cn(
				"group flex items-center gap-1 rounded-lg pr-1 transition-colors duration-150",
				active ? "bg-brand-soft" : "hover:bg-muted",
			)}
		>
			<button
				type="button"
				onClick={onOpen}
				className="focus-visible:ring-ring/50 flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg px-2 py-2 text-left outline-none focus-visible:ring-2"
			>
				<span className="truncate text-xs font-medium">
					{conversation.title}
				</span>
				<span className="text-muted-foreground text-[11px]">
					{formatRelative(conversation.updatedAt)} · {count} message
					{count === 1 ? "" : "s"}
				</span>
			</button>
			{confirmDelete ? (
				<>
					<Button size="xs" variant="destructive" onClick={onDelete}>
						Delete
					</Button>
					<IconButton
						label="Keep"
						icon={X}
						size="icon-xs"
						onClick={() => setConfirmDelete(false)}
					/>
				</>
			) : (
				<div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
					<IconButton
						label="Rename"
						icon={Pencil}
						size="icon-xs"
						onClick={() => {
							setTitle(conversation.title);
							setEditing(true);
						}}
					/>
					<IconButton
						label="Delete"
						icon={Trash2}
						size="icon-xs"
						onClick={() => setConfirmDelete(true)}
					/>
				</div>
			)}
		</li>
	);
}
