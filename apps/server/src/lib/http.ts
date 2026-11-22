import type { Context } from "hono";
import type { core } from "zod";

/**
 * Client IP for rate limiting: Cloudflare's `cf-connecting-ip`, else "local".
 * Only ever used as HMAC input (see `rateLimitPerIp`), never stored or
 * logged.
 *
 * `X-Forwarded-For` is not read: off Cloudflare nothing vouches for it, and
 * any client can set it to get a fresh budget per request. On Cloudflare,
 * `cf-connecting-ip` is set by the edge and can't be forged by the client.
 *
 * IPv6 addresses are bucketed by /64 (see `ipBucket`): one host usually
 * owns the whole /64, so per-address budgets would be trivial to rotate
 * around.
 */
export function clientIp(c: Context): string {
	return ipBucket(c.req.header("cf-connecting-ip") ?? "");
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The rate-limit bucket of an address: an IPv4 address as is, an IPv6
 * address as its /64 prefix (`2001:db8:1:2::/64`), an IPv4-mapped IPv6
 * address as the IPv4 address, anything unparsable as "local".
 */
export function ipBucket(raw: string): string {
	const ip = raw
		.trim()
		.replace(/^\[|\]$/g, "")
		.replace(/%.*$/, "")
		.toLowerCase();
	if (IPV4_RE.test(ip)) return ip;
	if (!ip.includes(":") || ip.length > 64) return "local";
	const hextets = expandIpv6(ip);
	if (!hextets) return "local";
	// ::ffff:a.b.c.d (IPv4-mapped): the IPv4 address is the client.
	if (
		hextets.slice(0, 5).every((h) => h === 0) &&
		hextets[5] === 0xffff &&
		hextets[6] !== undefined &&
		hextets[7] !== undefined
	) {
		return [
			hextets[6] >> 8,
			hextets[6] & 255,
			hextets[7] >> 8,
			hextets[7] & 255,
		]
			.map(String)
			.join(".");
	}
	return `${hextets
		.slice(0, 4)
		.map((h) => h.toString(16))
		.join(":")}::/64`;
}

/** Eight 16-bit groups, or null when `ip` is not an IPv6 address. */
function expandIpv6(ip: string): number[] | null {
	let text = ip;
	// A trailing dotted IPv4 part (e.g. ::ffff:192.0.2.1) is two groups.
	const v4 = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
	if (v4?.[1]) {
		const octets = v4[1].split(".").map(Number);
		if (octets.some((o) => o > 255)) return null;
		const [a = 0, b = 0, c = 0, d = 0] = octets;
		text = `${text.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part: string | undefined) =>
		part ? part.split(":") : ([] as string[]);
	const head = parse(halves[0]);
	const tail = parse(halves[1]);
	const missing = 8 - head.length - tail.length;
	if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
	const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
	const out: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
		out.push(Number.parseInt(group, 16));
	}
	return out;
}

/** Compact, client-friendly zod issues for `{ error, details }` 400s. */
export function formatZodIssues(error: core.$ZodError) {
	return error.issues.map((issue) => ({
		path: issue.path.map(String).join("."),
		code: issue.code,
		message: issue.message,
	}));
}

/**
 * `Cache-Control` for GET responses. The data is the same for every user,
 * but the API needs a session, so only the caller's own browser may cache it:
 * a shared cache ("public" / s-maxage) would serve it without one.
 */
export function clientCache(seconds: number): string {
	return `private, max-age=${seconds}`;
}
