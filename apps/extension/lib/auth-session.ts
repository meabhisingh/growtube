/**
 * Account sessions with the GrowTube server. BACKGROUND ONLY.
 *
 * The server runs better-auth (email + password) with its bearer plugin:
 * sign-in / sign-up responses carry the session token in the
 * `set-auth-token` header, and every later request sends
 * `Authorization: Bearer <token>` with credentials "omit" (no cookies).
 *
 * Storage:
 * - The token `{ token, serverUrl }`: IndexedDB of the extension origin
 *   (lib/token-store.ts), read and written only here. Not storage.local,
 *   which content scripts can read. Never sent over runtime messaging,
 *   never exported.
 * - `local:authUser` (lib/auth.ts): the token-free user every UI gates on.
 * Saving writes the token first, then the user; clearing removes the token
 * first, then the user. A user left without a token is cleared by the next
 * check (`refreshSessionIfStale`), a token without a user is re-validated.
 */
import {
	AUTH_BASE_PATH,
	AUTH_TOKEN_RESPONSE_HEADER,
	type AuthUser,
} from "@growtube/shared/auth";
import { z } from "zod";
import { storage } from "#imports";

import {
	authUser,
	MAX_PASSWORD_LENGTH,
	MIN_PASSWORD_LENGTH,
	normalizeServerUrl,
	type SignedInUser,
} from "./auth";
import { hasOriginPermission, originOf } from "./permissions";
import { serverUrl } from "./settings";
import {
	deleteStoredToken,
	readStoredToken,
	type StoredToken,
	writeStoredToken,
} from "./token-store";

/** Re-validates the session about twice a day. */
export const AUTH_REFRESH_ALARM = "ovq:auth-refresh";
export const AUTH_REFRESH_MINUTES = 12 * 60;
/** storage.session: last validation (survives worker restarts, not browser restarts). */
const CHECKED_AT_KEY = "session:authCheckedAt";
const REQUEST_TIMEOUT_MS = 15_000;
const SIGN_OUT_TIMEOUT_MS = 5_000;

export type AuthErrorCode =
	| "AUTH_REQUIRED"
	| "BAD_CREDENTIALS"
	| "EMAIL_TAKEN"
	| "WEAK_PASSWORD"
	| "INVALID_EMAIL"
	| "INVALID_NAME"
	| "WRONG_PASSWORD"
	| "PERMISSION"
	| "NETWORK"
	| "RATE_LIMITED"
	| "ORIGIN"
	| "UNSUPPORTED"
	| "FORBIDDEN"
	| "HTTP"
	| "INVALID_RESPONSE";

/** `message` is user-presentable; `code` lets the UI branch. */
export class AuthError extends Error {
	readonly code: AuthErrorCode;
	readonly status: number | undefined;
	constructor(code: AuthErrorCode, message: string, status?: number) {
		super(message);
		this.name = "AuthError";
		this.code = code;
		this.status = status;
	}
}

// ---------------------------------------------------------------------------
// Stored session
// ---------------------------------------------------------------------------

let tokenCache: Promise<StoredToken | null> | null = null;
// Signed out from somewhere else (e.g. the options page's "Reset all data"
// fallback): read the token store again instead of trusting the cache.
authUser.watch((user) => {
	if (!user) tokenCache = null;
});

function loadToken(): Promise<StoredToken | null> {
	tokenCache ??= readStoredToken().catch(() => null);
	return tokenCache;
}

async function currentServer(): Promise<string> {
	return normalizeServerUrl(await serverUrl.getValue());
}

/** Bearer token for `base`, or null when signed out (or signed in elsewhere). */
export async function bearerFor(base: string): Promise<string | null> {
	const stored = await loadToken();
	return stored && stored.serverUrl === normalizeServerUrl(base)
		? stored.token
		: null;
}

/** Signed in to the configured server. */
export async function hasSession(): Promise<boolean> {
	return (await bearerFor(await currentServer())) != null;
}

/** Throws AUTH_REQUIRED unless signed in (gates every non-auth message). */
export async function assertSignedIn(): Promise<void> {
	if (!(await hasSession()))
		throw new AuthError(
			"AUTH_REQUIRED",
			"Sign in to GrowTube to use this. Open Settings → Account.",
		);
}

async function saveSession(
	base: string,
	token: string,
	user: AuthUser,
): Promise<SignedInUser> {
	const signedIn: SignedInUser = {
		id: user.id,
		name: user.name,
		email: user.email,
		serverUrl: base,
	};
	const stored: StoredToken = { token, serverUrl: base };
	tokenCache = Promise.resolve(stored);
	await writeStoredToken(stored);
	await authUser.setValue(signedIn);
	return signedIn;
}

/** Forgets the session locally: the token first, then the user. */
export async function clearSession(): Promise<void> {
	tokenCache = Promise.resolve(null);
	await deleteStoredToken().catch(() => {});
	await authUser.removeValue().catch(() => {});
}

async function markChecked(): Promise<void> {
	await storage.setItem(CHECKED_AT_KEY, Date.now()).catch(() => {});
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const userSchema = z.object({
	id: z.string().min(1),
	name: z.string().catch(""),
	email: z.string(),
});

type AuthResponse = { res: Response; body: unknown };

async function authFetch(
	base: string,
	path: string,
	init: {
		method: "GET" | "POST";
		body?: unknown;
		token?: string;
		timeoutMs?: number;
	},
): Promise<AuthResponse> {
	if (!(await hasOriginPermission(base))) {
		throw new AuthError(
			"PERMISSION",
			`GrowTube needs permission to reach ${originOf(base) ?? base}. Save the server URL in Settings → Server to grant it, then try again.`,
		);
	}
	const headers: Record<string, string> = { Accept: "application/json" };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (init.token) headers.Authorization = `Bearer ${init.token}`;
	let res: Response;
	try {
		res = await fetch(`${base}${AUTH_BASE_PATH}${path}`, {
			method: init.method,
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			credentials: "omit",
			cache: "no-store",
			signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
		});
	} catch {
		throw new AuthError(
			"NETWORK",
			`Can't reach the GrowTube server at ${base}. Check your connection and Settings → Server URL.`,
		);
	}
	const text = await res.text().catch(() => "");
	let body: unknown = null;
	try {
		body = text ? JSON.parse(text) : null;
	} catch {
		body = null;
	}
	return { res, body };
}

type Action = "signIn" | "signUp" | "delete" | "session";

/** better-auth `{ code, message }` (or a rate-limit / proxy response) -> friendly error. */
function toAuthError(res: Response, body: unknown, action: Action): AuthError {
	const b = (body && typeof body === "object" ? body : {}) as {
		code?: unknown;
		message?: unknown;
		error?: unknown;
	};
	const code = typeof b.code === "string" ? b.code : "";
	const serverMessage =
		typeof b.message === "string"
			? b.message
			: typeof b.error === "string"
				? b.error
				: "";
	const status = res.status;
	switch (code) {
		case "INVALID_EMAIL_OR_PASSWORD":
			return new AuthError(
				"BAD_CREDENTIALS",
				"Wrong email or password.",
				status,
			);
		case "USER_ALREADY_EXISTS":
		case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
			return new AuthError(
				"EMAIL_TAKEN",
				"An account with this email already exists. Sign in instead.",
				status,
			);
		case "PASSWORD_TOO_SHORT":
			return new AuthError(
				"WEAK_PASSWORD",
				`That password is too short. Use at least ${MIN_PASSWORD_LENGTH} characters.`,
				status,
			);
		case "PASSWORD_TOO_LONG":
			return new AuthError(
				"WEAK_PASSWORD",
				`That password is too long. Use at most ${MAX_PASSWORD_LENGTH} characters.`,
				status,
			);
		case "PASSWORD_COMPROMISED":
			return new AuthError(
				"WEAK_PASSWORD",
				"That password appears in known data breaches. Choose a different one.",
				status,
			);
		case "INVALID_EMAIL":
			return new AuthError(
				"INVALID_EMAIL",
				"Enter a valid email address.",
				status,
			);
		case "INVALID_PASSWORD":
			return new AuthError("WRONG_PASSWORD", "Wrong password.", status);
		case "EMAIL_NOT_VERIFIED":
			return new AuthError(
				"FORBIDDEN",
				"Confirm your email address first (check your inbox), then sign in.",
				status,
			);
		case "INVALID_ORIGIN":
		case "MISSING_OR_NULL_ORIGIN":
			return new AuthError(
				"ORIGIN",
				"This server doesn't accept sign-ins from the extension. If you run it yourself, add this extension's origin (chrome-extension://…) to its trusted origins.",
				status,
			);
	}
	if (status === 429)
		return new AuthError(
			"RATE_LIMITED",
			"Too many attempts. Wait a minute, then try again.",
			status,
		);
	if (status === 401)
		return new AuthError(
			"AUTH_REQUIRED",
			"Your session has ended. Sign in again.",
			status,
		);
	if (status === 404)
		return new AuthError(
			"UNSUPPORTED",
			action === "delete"
				? "This server doesn't support deleting accounts from the extension."
				: "This server has no GrowTube accounts (it may be outdated). Check Settings → Server URL.",
			status,
		);
	if (status >= 500)
		return new AuthError(
			"HTTP",
			`The GrowTube server had a problem (HTTP ${status}). Try again in a minute.`,
			status,
		);
	return new AuthError(
		"HTTP",
		serverMessage || `The server answered HTTP ${status}.`,
		status,
	);
}

/** Token from the `set-auth-token` header (or the body, as a fallback) + the user. */
function readLogin(
	res: Response,
	body: unknown,
): { token: string; user: AuthUser } | null {
	const b = (body && typeof body === "object" ? body : {}) as {
		token?: unknown;
		user?: unknown;
	};
	const header = res.headers.get(AUTH_TOKEN_RESPONSE_HEADER)?.trim();
	const token =
		header || (typeof b.token === "string" && b.token ? b.token : null);
	const user = userSchema.safeParse(b.user);
	if (!user.success) {
		throw new AuthError(
			"INVALID_RESPONSE",
			"Unexpected answer from the GrowTube server. Check Settings → Server URL.",
			res.status,
		);
	}
	return token ? { token, user: user.data } : null;
}

// ---------------------------------------------------------------------------
// Input checks (the server checks again)
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(email: string): string {
	const value = String(email ?? "").trim();
	if (!EMAIL_RE.test(value) || value.length > 254)
		throw new AuthError("INVALID_EMAIL", "Enter a valid email address.");
	return value;
}

function checkPassword(password: string, forSignUp: boolean): string {
	const value = String(password ?? "");
	if (!value) throw new AuthError("WEAK_PASSWORD", "Enter your password.");
	if (forSignUp && value.length < MIN_PASSWORD_LENGTH)
		throw new AuthError(
			"WEAK_PASSWORD",
			`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
		);
	if (value.length > MAX_PASSWORD_LENGTH)
		throw new AuthError(
			"WEAK_PASSWORD",
			`Use at most ${MAX_PASSWORD_LENGTH} characters for your password.`,
		);
	return value;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Best-effort server-side sign-out of an old token (never throws). */
async function revokeRemote(stored: StoredToken): Promise<void> {
	try {
		await authFetch(stored.serverUrl, "/sign-out", {
			method: "POST",
			body: {},
			token: stored.token,
			timeoutMs: SIGN_OUT_TIMEOUT_MS,
		});
	} catch {
		// Offline / no permission: the token expires on its own.
	}
}

/** Replaces any older session after a successful login. */
async function finishLogin(
	base: string,
	login: { token: string; user: AuthUser },
): Promise<SignedInUser> {
	const previous = await loadToken();
	const user = await saveSession(base, login.token, login.user);
	await markChecked();
	if (previous && previous.token !== login.token) void revokeRemote(previous);
	return user;
}

export async function signIn(input: {
	email: string;
	password: string;
}): Promise<SignedInUser> {
	const base = await currentServer();
	const email = cleanEmail(input.email);
	const password = checkPassword(input.password, false);
	const { res, body } = await authFetch(base, "/sign-in/email", {
		method: "POST",
		body: { email, password },
	});
	if (!res.ok) throw toAuthError(res, body, "signIn");
	const login = readLogin(res, body);
	if (!login)
		throw new AuthError(
			"INVALID_RESPONSE",
			"The server signed you in but returned no login token. It needs the better-auth bearer plugin.",
			res.status,
		);
	return finishLogin(base, login);
}

export async function signUp(input: {
	name: string;
	email: string;
	password: string;
}): Promise<SignedInUser> {
	const base = await currentServer();
	const name = String(input.name ?? "").trim();
	if (!name || name.length > 100)
		throw new AuthError(
			"INVALID_NAME",
			"Enter your name (up to 100 characters).",
		);
	const email = cleanEmail(input.email);
	const password = checkPassword(input.password, true);
	const { res, body } = await authFetch(base, "/sign-up/email", {
		method: "POST",
		body: { name, email, password },
	});
	if (!res.ok) throw toAuthError(res, body, "signUp");
	const login = readLogin(res, body);
	// No token: the server doesn't sign new accounts in automatically.
	return login ? finishLogin(base, login) : signIn({ email, password });
}

/** Signs out locally right away, then revokes the session on the server. */
export async function signOut(): Promise<void> {
	const stored = await loadToken();
	await clearSession();
	if (stored) await revokeRemote(stored);
}

/**
 * Deletes the account on the server (password confirmation). The server
 * removes the user, their sessions and their API keys.
 */
export async function deleteAccount(input: {
	password: string;
}): Promise<{ deleted: boolean; emailConfirmation: boolean }> {
	const base = await currentServer();
	const token = await bearerFor(base);
	if (!token)
		throw new AuthError(
			"AUTH_REQUIRED",
			"Sign in first, then delete your account.",
		);
	const password = String(input.password ?? "");
	if (!password)
		throw new AuthError("WRONG_PASSWORD", "Enter your password to confirm.");
	const { res, body } = await authFetch(base, "/delete-user", {
		method: "POST",
		body: { password },
		token,
	});
	if (res.status === 401) {
		await clearSession();
		throw new AuthError(
			"AUTH_REQUIRED",
			"Your session has ended. Sign in again, then delete your account.",
			401,
		);
	}
	if (!res.ok) throw toAuthError(res, body, "delete");
	const message = (body as { message?: unknown } | null)?.message;
	if (message === "Verification email sent")
		return { deleted: false, emailConfirmation: true };
	await clearSession();
	return { deleted: true, emailConfirmation: false };
}

let refreshing: Promise<SignedInUser | null> | null = null;

/**
 * Asks the server whether the session is still valid. A null session signs
 * the user out; network problems and server errors keep the local state.
 */
export function refreshSession(): Promise<SignedInUser | null> {
	refreshing ??= (async () => {
		try {
			const base = await currentServer();
			const stored = await loadToken();
			if (!stored) {
				if (await authUser.getValue()) await clearSession();
				return null;
			}
			if (stored.serverUrl !== base) {
				await clearSession();
				void revokeRemote(stored);
				return null;
			}
			let response: AuthResponse;
			try {
				response = await authFetch(base, "/get-session", {
					method: "GET",
					token: stored.token,
				});
			} catch {
				return authUser.getValue(); // offline / no permission: keep
			}
			const { res, body } = response;
			if (res.status === 401 || (res.ok && body == null)) {
				if ((await loadToken())?.token === stored.token) await clearSession();
				return null;
			}
			if (!res.ok) return authUser.getValue(); // 429 / 5xx: try later
			const user = userSchema.safeParse((body as { user?: unknown }).user);
			if (!user.success) return authUser.getValue();
			// The session may have been replaced meanwhile (sign-out / new login).
			if ((await loadToken())?.token !== stored.token)
				return authUser.getValue();
			const token =
				res.headers.get(AUTH_TOKEN_RESPONSE_HEADER)?.trim() || stored.token;
			const current = await authUser.getValue();
			const changed =
				token !== stored.token ||
				!current ||
				current.id !== user.data.id ||
				current.name !== user.data.name ||
				current.email !== user.data.email;
			const signedIn = changed
				? await saveSession(base, token, user.data)
				: current;
			await markChecked();
			return signedIn;
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

/**
 * Validates once per browser session (and when the last check is > 12 h
 * old), and whenever the token and the user item disagree.
 */
export async function refreshSessionIfStale(): Promise<void> {
	const user = await authUser.getValue().catch(() => null);
	if (!(await loadToken())) {
		if (user) await clearSession();
		return;
	}
	const checkedAt = await storage
		.getItem<number>(CHECKED_AT_KEY)
		.catch(() => null);
	if (
		user &&
		checkedAt &&
		Date.now() - checkedAt < AUTH_REFRESH_MINUTES * 60_000
	)
		return;
	await refreshSession().catch(() => null);
}

/** A new server URL ends the session that belonged to the old one. */
export async function onServerUrlChanged(next: string): Promise<void> {
	const stored = await loadToken();
	if (!stored || stored.serverUrl === normalizeServerUrl(next)) return;
	await clearSession();
	void revokeRemote(stored);
}

/**
 * The server answered 401 AUTH_REQUIRED for `token`: forget it, unless a
 * newer session has replaced it meanwhile.
 */
export async function onSessionRejected(token: string): Promise<void> {
	if ((await loadToken())?.token === token) await clearSession();
}
