import { ENV } from "../env.server";

const encoder = new TextEncoder();
let keyPromise: Promise<CryptoKey> | undefined;
let keySecret: string | undefined;

function hmacKey(secret: string): Promise<CryptoKey> {
	// A CryptoKey is not an I/O object, so it can be reused across requests.
	if (!keyPromise || keySecret !== secret) {
		keySecret = secret;
		keyPromise = crypto.subtle.importKey(
			"raw",
			encoder.encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
	}
	return keyPromise;
}

/**
 * HMAC-SHA256(BETTER_AUTH_SECRET, value) as the first 16 hex characters.
 * Used for Redis rate-limit keys and trending search cache keys, so no raw
 * IP, user id, email or search text is ever written to Redis.
 * Workers-friendly (Web Crypto).
 */
export async function opaqueId(value: string): Promise<string> {
	const key = await hmacKey(ENV.BETTER_AUTH_SECRET);
	const mac = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, encoder.encode(value)),
	);
	let hex = "";
	for (const byte of mac.subarray(0, 8))
		hex += byte.toString(16).padStart(2, "0");
	return hex;
}
