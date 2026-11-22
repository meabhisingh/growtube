import { formatRelative } from "@growtube/shared";
import { Button } from "@growtube/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@growtube/ui/components/card";
import { Input } from "@growtube/ui/components/input";
import { Label } from "@growtube/ui/components/label";
import { Skeleton } from "@growtube/ui/components/skeleton";
import { cn } from "@growtube/ui/lib/utils";
import {
	KeyRound,
	LoaderCircle,
	Plus,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { toast } from "sonner";

import { CopyField } from "@/components/copy-button";
import { EmptyState, ErrorState, StaleBanner } from "@/components/states";
import { notifyAuthRequired } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useApi } from "@/lib/use-api";

/** better-auth's default `maximumNameLength` for API keys. */
const MAX_NAME_LENGTH = 32;

/** The fields of an API key this page shows. The secret is never listed. */
interface ApiKeyRow {
	id: string;
	name: string | null;
	start: string | null;
	prefix: string | null;
	createdAt: Date | string;
	lastRequest: Date | string | null;
	expiresAt: Date | string | null;
	enabled: boolean;
}

interface ClientError {
	status?: number;
	message?: string;
	statusText?: string;
}

function clientErrorMessage(error: ClientError, fallback: string): string {
	if (error.status === 401) notifyAuthRequired();
	return error.message || error.statusText || fallback;
}

function time(value: Date | string | null): number {
	if (value == null) return 0;
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? 0 : t;
}

async function listApiKeys(signal: AbortSignal): Promise<ApiKeyRow[]> {
	const { data, error } = await authClient.apiKey.list({
		fetchOptions: { signal },
	});
	if (error) {
		throw new Error(clientErrorMessage(error, "Couldn't load your API keys."));
	}
	const keys: ApiKeyRow[] = data?.apiKeys ?? [];
	return [...keys].sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

function formatDate(value: Date | string | null): string {
	const t = time(value);
	return t ? dateFormat.format(t) : "—";
}

/** "gt_aB…" style hint: the stored first characters, or the prefix alone. */
function keyHint(key: ApiKeyRow): string {
	const visible = key.start ?? key.prefix;
	return visible ? `${visible}…` : "••••••";
}

/**
 * Prefix of keys made before the GrowTube rename. They still verify (see
 * `LEGACY_API_KEY_PREFIXES` in `@growtube/auth`, which is server-only).
 */
const LEGACY_KEY_PREFIX = "ovq_";

function isLegacyKey(key: ApiKeyRow): boolean {
	return (key.start ?? key.prefix ?? "").startsWith(LEGACY_KEY_PREFIX);
}

interface ApiKeysCardProps {
	userId: string;
	/** Called with a freshly created key so the page can offer to test it. */
	onCreated?: (key: string) => void;
}

/** Create, list and revoke the signed-in user's MCP API keys. */
export function ApiKeysCard({ userId, onCreated }: ApiKeysCardProps) {
	const keys = useApi(`api-keys:${userId}`, listApiKeys, { staleMs: 0 });
	const [revoked, setRevoked] = useState<ReadonlySet<string>>(new Set());
	const [created, setCreated] = useState<{ name: string; key: string } | null>(
		null,
	);

	const rows = (keys.data ?? []).filter((key) => !revoked.has(key.id));

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-sm">
					<KeyRound className="size-4" aria-hidden="true" />
					Your API keys
				</CardTitle>
				<CardDescription>
					MCP clients send one of these with every request. Create one per app
					so you can revoke them separately.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<CreateKeyForm
					onCreated={(name, key) => {
						setCreated({ name, key });
						onCreated?.(key);
						keys.refetch();
					}}
				/>

				{created && (
					<NewKeyNotice
						name={created.name}
						value={created.key}
						onDismiss={() => setCreated(null)}
					/>
				)}

				{keys.error && keys.data && (
					<StaleBanner error={keys.error} onRetry={keys.refetch} />
				)}

				{keys.isPending ? (
					<div className="flex flex-col gap-2" aria-busy="true">
						<Skeleton className="h-12 w-full rounded-lg" />
						<Skeleton className="h-12 w-full rounded-lg" />
					</div>
				) : keys.error && !keys.data ? (
					<ErrorState
						title="Couldn't load your API keys"
						error={keys.error}
						onRetry={keys.refetch}
						retrying={keys.isFetching}
					/>
				) : rows.length === 0 ? (
					<EmptyState
						icon={KeyRound}
						title="No API keys yet"
						description="Create a key above, then paste it into your MCP client's config."
					/>
				) : (
					<>
						<KeyList
							rows={rows}
							onRevoked={(id) => {
								setRevoked((prev) => new Set(prev).add(id));
								keys.refetch();
							}}
						/>
						{rows.some(isLegacyKey) && (
							<p className="text-muted-foreground text-xs">
								Keys starting with{" "}
								<code className="font-mono">{LEGACY_KEY_PREFIX}</code> were
								created before the rename to GrowTube and still work. New keys
								start with <code className="font-mono">gt_</code>.
							</p>
						)}
					</>
				)}
			</CardContent>
		</Card>
	);
}

function CreateKeyForm({
	onCreated,
}: {
	onCreated: (name: string, key: string) => void;
}) {
	const inputId = useId();
	const messageId = useId();
	const [name, setName] = useState("");
	const [message, setMessage] = useState<string | null>(null);
	const [creating, setCreating] = useState(false);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (creating) return;
		const trimmed = name.trim();
		if (!trimmed) {
			setMessage("Give the key a name, like the app you'll use it in.");
			return;
		}
		setCreating(true);
		setMessage(null);
		const { data, error } = await authClient.apiKey.create({ name: trimmed });
		setCreating(false);
		if (error || !data?.key) {
			setMessage(
				error
					? clientErrorMessage(error, "Couldn't create the key.")
					: "The server didn't return a key. Try again.",
			);
			return;
		}
		setName("");
		onCreated(trimmed, data.key);
	}

	return (
		<form
			onSubmit={(event) => void onSubmit(event)}
			className="flex flex-col gap-2"
			noValidate
		>
			<Label htmlFor={inputId}>New key name</Label>
			<div className="flex gap-2">
				<Input
					id={inputId}
					value={name}
					maxLength={MAX_NAME_LENGTH}
					onChange={(event) => {
						setName(event.target.value);
						if (message) setMessage(null);
					}}
					placeholder="e.g. Claude Desktop"
					autoComplete="off"
					aria-invalid={message ? true : undefined}
					aria-describedby={message ? messageId : undefined}
					className="min-w-0 flex-1"
				/>
				<Button type="submit" disabled={creating}>
					{creating ? (
						<LoaderCircle className="animate-spin" aria-hidden="true" />
					) : (
						<Plus aria-hidden="true" />
					)}
					Create key
				</Button>
			</div>
			<p
				id={messageId}
				aria-live="polite"
				className={cn("text-destructive text-xs", !message && "sr-only")}
			>
				{message}
			</p>
		</form>
	);
}

function NewKeyNotice({
	name,
	value,
	onDismiss,
}: {
	name: string;
	value: string;
	onDismiss: () => void;
}) {
	return (
		<div
			role="status"
			className="flex flex-col gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs"
		>
			<div className="flex gap-2">
				<TriangleAlert
					className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400"
					aria-hidden="true"
				/>
				<div className="flex min-w-0 flex-col gap-1">
					<span className="font-medium">
						Copy your new key “{name}” now. It's shown only once.
					</span>
					<span className="text-muted-foreground">
						GrowTube stores only a hash of it, so nobody can show it to you
						again. Treat it like a password: anyone with it can use your access.
						If you lose it, revoke it and create a new one.
					</span>
				</div>
			</div>
			<CopyField value={value} label="Copy API key" className="bg-background" />
			<div>
				<Button size="sm" variant="outline" onClick={onDismiss}>
					I've saved it
				</Button>
			</div>
		</div>
	);
}

function KeyList({
	rows,
	onRevoked,
}: {
	rows: ApiKeyRow[];
	onRevoked: (id: string) => void;
}) {
	return (
		<div className="border-border/80 overflow-x-auto rounded-lg border">
			<table className="w-full min-w-[520px] text-left text-xs">
				<thead className="bg-muted/40 text-muted-foreground">
					<tr className="border-b">
						<th scope="col" className="px-3 py-2 font-medium">
							Name
						</th>
						<th scope="col" className="px-3 py-2 font-medium">
							Key
						</th>
						<th scope="col" className="px-3 py-2 font-medium">
							Created
						</th>
						<th scope="col" className="px-3 py-2 font-medium">
							Last used
						</th>
						<th scope="col" className="px-3 py-2 text-right font-medium">
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((key) => (
						<KeyRowView key={key.id} row={key} onRevoked={onRevoked} />
					))}
				</tbody>
			</table>
		</div>
	);
}

function KeyRowView({
	row,
	onRevoked,
}: {
	row: ApiKeyRow;
	onRevoked: (id: string) => void;
}) {
	const [confirming, setConfirming] = useState(false);
	const [revoking, setRevoking] = useState(false);
	const name = row.name?.trim() || "Unnamed key";
	const expired = row.expiresAt != null && time(row.expiresAt) < Date.now();

	async function revoke() {
		setRevoking(true);
		const { error } = await authClient.apiKey.delete({ keyId: row.id });
		setRevoking(false);
		if (error) {
			toast.error(clientErrorMessage(error, "Couldn't revoke the key."));
			return;
		}
		toast.success(`Revoked “${name}”`);
		onRevoked(row.id);
	}

	return (
		<tr className="hover:bg-muted/30 border-b transition-colors last:border-0">
			<th scope="row" className="px-3 py-2.5 font-medium">
				<span className="flex items-center gap-2">
					<span className="max-w-48 truncate" title={name}>
						{name}
					</span>
					{(!row.enabled || expired) && (
						<span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px] font-normal">
							{expired ? "Expired" : "Disabled"}
						</span>
					)}
				</span>
			</th>
			<td className="px-3 py-2.5">
				<code className="text-muted-foreground font-mono">{keyHint(row)}</code>
			</td>
			<td className="px-3 py-2.5" title={new Date(row.createdAt).toString()}>
				{formatDate(row.createdAt)}
			</td>
			<td
				className="text-muted-foreground px-3 py-2.5"
				title={
					row.lastRequest ? new Date(row.lastRequest).toString() : undefined
				}
			>
				{row.lastRequest ? formatRelative(row.lastRequest) : "Not used yet"}
			</td>
			<td className="py-2 pr-2 pl-3 text-right whitespace-nowrap">
				{confirming ? (
					<span className="inline-flex items-center gap-1">
						<Button
							size="sm"
							variant="destructive"
							onClick={() => void revoke()}
							disabled={revoking}
							aria-label={`Confirm revoking ${name}`}
						>
							{revoking && (
								<LoaderCircle className="animate-spin" aria-hidden="true" />
							)}
							Revoke
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => setConfirming(false)}
							disabled={revoking}
						>
							Cancel
						</Button>
					</span>
				) : (
					<Button
						size="sm"
						variant="ghost"
						onClick={() => setConfirming(true)}
						aria-label={`Revoke ${name}`}
					>
						<Trash2 aria-hidden="true" />
						Revoke
					</Button>
				)}
			</td>
		</tr>
	);
}
