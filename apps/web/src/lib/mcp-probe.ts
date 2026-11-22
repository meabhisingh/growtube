import { MCP_API_KEY_HEADER } from "@growtube/shared/auth";
import { z } from "zod";

import { MCP_URL } from "./api";

/**
 * Browser-side smoke test for the MCP endpoint: sends `initialize` and
 * `tools/list` over streamable HTTP with the given API key and reports what
 * came back. Cookies are left out on purpose, so only the key is tested; a
 * stateful server that insists on a session header just won't list tools.
 */

const rpcResponse = z.object({
	jsonrpc: z.literal("2.0"),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	result: z.unknown().optional(),
	error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const initializeResult = z.object({
	protocolVersion: z.string().optional(),
	serverInfo: z
		.object({
			name: z.string(),
			title: z.string().optional(),
			version: z.string().optional(),
		})
		.optional(),
});

const toolsListResult = z.object({
	tools: z.array(
		z.object({ name: z.string(), description: z.string().optional() }),
	),
});

export interface McpProbeResult {
	serverName: string | null;
	serverVersion: string | null;
	protocolVersion: string | null;
	tools: { name: string; description?: string }[] | null;
}

/** Picks the JSON-RPC message with the given id out of a JSON or SSE body. */
function extractMessage(
	body: string,
	contentType: string,
	id: number,
): unknown {
	if (!contentType.includes("text/event-stream")) return JSON.parse(body);
	for (const event of body.split(/\r?\n\r?\n/)) {
		const data = event
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trimStart())
			.join("\n");
		if (!data) continue;
		try {
			const message: unknown = JSON.parse(data);
			if (
				typeof message === "object" &&
				message &&
				"id" in message &&
				message.id === id
			)
				return message;
		} catch {
			// ignore non-JSON events
		}
	}
	throw new Error("The MCP endpoint's event stream had no response.");
}

async function rpc(
	method: string,
	params: unknown,
	id: number,
	apiKey: string,
	signal: AbortSignal,
): Promise<unknown> {
	const res = await fetch(MCP_URL, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			[MCP_API_KEY_HEADER]: apiKey,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
		credentials: "omit",
		signal,
	});
	if (res.status === 401 || res.status === 403)
		throw new Error(
			"The server rejected this API key. Check that you copied the whole key and that it hasn't been revoked.",
		);
	if (!res.ok)
		throw new Error(`The MCP endpoint answered with HTTP ${res.status}.`);
	const parsed = rpcResponse.safeParse(
		extractMessage(await res.text(), res.headers.get("content-type") ?? "", id),
	);
	if (!parsed.success)
		throw new Error("The MCP endpoint sent an invalid JSON-RPC response.");
	if (parsed.data.error)
		throw new Error(
			`MCP error ${parsed.data.error.code}: ${parsed.data.error.message}`,
		);
	return parsed.data.result;
}

export async function probeMcp(
	apiKey: string,
	timeoutMs = 10_000,
): Promise<McpProbeResult> {
	const signal = AbortSignal.timeout(timeoutMs);
	let init: unknown;
	try {
		init = await rpc(
			"initialize",
			{
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "growtube-web", version: "1.0.0" },
			},
			1,
			apiKey,
			signal,
		);
	} catch (error) {
		if (error instanceof DOMException && error.name === "TimeoutError") {
			throw new Error("The MCP endpoint didn't answer within 10 seconds.");
		}
		if (error instanceof TypeError) {
			throw new Error(
				"Couldn't reach the MCP endpoint. Is the server running and allowing this origin?",
			);
		}
		throw error;
	}
	const info = initializeResult.safeParse(init);

	let tools: McpProbeResult["tools"] = null;
	try {
		const listed = toolsListResult.safeParse(
			await rpc("tools/list", {}, 2, apiKey, signal),
		);
		if (listed.success) tools = listed.data.tools;
	} catch {
		// Stateful servers require a session header we can't send cross-origin.
	}

	// Prefer the display title ("GrowTube") over the machine name ("growtube").
	const serverInfo = info.success ? info.data.serverInfo : undefined;
	return {
		serverName: serverInfo?.title || serverInfo?.name || null,
		serverVersion: serverInfo?.version ?? null,
		protocolVersion: info.success ? (info.data.protocolVersion ?? null) : null,
		tools,
	};
}
