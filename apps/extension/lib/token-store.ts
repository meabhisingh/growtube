/**
 * Where the login token lives: IndexedDB of the extension's own origin
 * (`chrome-extension://<id>`). Read and written by the background
 * (lib/auth-session.ts); the options page only deletes it as a fallback.
 *
 * Not `chrome.storage.local`: Chrome lets content scripts read every
 * storage.local item, and ours run inside youtube.com's renderer process,
 * so a compromised YouTube renderer could read a token kept there. A
 * content script's `indexedDB` is the web page's, never the extension's,
 * so it can't reach this database. Unlike `storage.session`, it survives a
 * browser restart, so nobody has to sign in again after one.
 */
import { storage } from "#imports";

export type StoredToken = { token: string; serverUrl: string };

const DB_NAME = "ovq-auth";
const STORE = "kv";
const TOKEN_KEY = "authToken";
/**
 * Where older versions kept the token (storage.local). Only ever removed,
 * never read: content scripts can write storage.local too, so adopting a
 * value found there would let a compromised YouTube renderer sign the
 * extension into an account of its choosing. Such users sign in once more.
 */
const LEGACY_TOKEN_ITEM = "local:authToken";

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE))
				request.result.createObjectStore(STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error("token store blocked"));
	});
}

async function run<T>(
	mode: IDBTransactionMode,
	op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
	const db = await openDb();
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(STORE, mode);
			const request = op(tx.objectStore(STORE));
			let result: T;
			request.onsuccess = () => {
				result = request.result;
			};
			tx.oncomplete = () => resolve(result);
			tx.onerror = () => reject(tx.error ?? request.error);
			tx.onabort = () => reject(tx.error ?? new Error("token store aborted"));
		});
	} finally {
		db.close();
	}
}

function isStoredToken(value: unknown): value is StoredToken {
	return (
		!!value &&
		typeof value === "object" &&
		typeof (value as StoredToken).token === "string" &&
		(value as StoredToken).token.length > 0 &&
		typeof (value as StoredToken).serverUrl === "string"
	);
}

/** The stored token, or null (also when IndexedDB is unavailable). */
export async function readStoredToken(): Promise<StoredToken | null> {
	const value = await run("readonly", (s) => s.get(TOKEN_KEY));
	// A legacy copy in storage.local is dropped unread (see LEGACY_TOKEN_ITEM).
	await storage.removeItem(LEGACY_TOKEN_ITEM).catch(() => {});
	return isStoredToken(value) ? value : null;
}

export async function writeStoredToken(value: StoredToken): Promise<void> {
	await run("readwrite", (s) => s.put(value, TOKEN_KEY));
}

/** Deletes the token (and any legacy copy in storage.local). */
export async function deleteStoredToken(): Promise<void> {
	const [deleted] = await Promise.allSettled([
		run("readwrite", (s) => s.delete(TOKEN_KEY)),
		storage.removeItem(LEGACY_TOKEN_ITEM),
	]);
	if (deleted.status === "rejected") throw deleted.reason;
}
