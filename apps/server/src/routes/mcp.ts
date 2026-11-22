import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";

import { createMcpServer } from "../mcp/server";
import type { AppEnv } from "../types";

/**
 * Streamable HTTP MCP endpoint in stateless mode: no sessions, every POST is
 * self-contained and answered with plain JSON (no SSE stream to keep open).
 */
export const mcpRoutes = new Hono<AppEnv>()
	.post("/", async (c) => {
		const server = createMcpServer(c.var);
		const transport = new StreamableHTTPTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		try {
			const res = await transport.handleRequest(c);
			return res ?? c.body(null, 202);
		} finally {
			c.executionCtx.waitUntil(server.close().catch(() => {}));
		}
	})
	// Stateless: there is no server-initiated SSE stream and no session to delete.
	.on(["GET", "DELETE"], "/", (c) =>
		c.json(
			{
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message:
						"Method not allowed: this MCP server is stateless, send JSON-RPC via POST.",
				},
				id: null,
			},
			405,
			{ Allow: "POST, OPTIONS" },
		),
	);
