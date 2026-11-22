/**
 * Value-free error summaries for logs.
 *
 * A drizzle query error's message ends with "\nparams: …" (every bound value:
 * titles, emails, password hashes…), and `console.error(err)` would also
 * print it through `err.stack`. Log `describeError(err)` instead.
 */

const MAX_MESSAGE_LENGTH = 300;

/**
 * Postgres SQLSTATE of a failed query (drizzle wraps the driver error in
 * `cause`), e.g. "22003" numeric value out of range.
 */
export function pgErrorCode(error: unknown): string | null {
	let current: unknown = error;
	for (let depth = 0; current && depth < 5; depth++) {
		const code = (current as { code?: unknown }).code;
		if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
		current = (current as { cause?: unknown }).cause;
	}
	return null;
}

/** Drops drizzle's "\nparams: …" part (the bound values) from a message. */
export function stripQueryParams(message: string): string {
	const at = message.search(/\n\s*params:/);
	return at === -1 ? message : message.slice(0, at);
}

function clip(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > MAX_MESSAGE_LENGTH
		? `${oneLine.slice(0, MAX_MESSAGE_LENGTH)}…`
		: oneLine;
}

/**
 * One line for logs: error name, Postgres code (if any) and message, never
 * bound SQL parameters, request bodies or stack traces.
 *
 * - Drizzle's "params:" part is removed; the SQL text itself only has `$n`
 *   placeholders.
 * - A query failure's reason is the driver error in `cause`, so its message
 *   comes first.
 * - Postgres data exceptions (SQLSTATE class 22) quote the offending value
 *   ("invalid input syntax for type integer: \"…\""), so quoted parts are
 *   blanked for them.
 * - JSON parse errors quote the input they choked on, so only their name is
 *   kept.
 */
export function describeError(error: unknown): string {
	if (!(error instanceof Error)) {
		if (typeof error === "string") return clip(stripQueryParams(error));
		return `non-Error value (${error === null ? "null" : typeof error})`;
	}
	const code = pgErrorCode(error);
	if (error.name === "SyntaxError") return "SyntaxError (message omitted)";

	let message = stripQueryParams(error.message);
	const cause = error.cause;
	if (cause instanceof Error && cause.message) {
		const reason = stripQueryParams(cause.message);
		if (!message.includes(reason))
			message = message ? `${reason} (${message})` : reason;
	}
	if (code?.startsWith("22")) message = message.replace(/"[^"]*"/g, '"…"');
	return `${error.name || "Error"}${code ? ` [${code}]` : ""}: ${clip(message)}`;
}
