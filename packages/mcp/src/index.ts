#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer, makeApi } from "./server.js";

// Stdio MCP server for surfvps. Configured in an MCP host (Claude Desktop, Cursor, …):
//   { "mcpServers": { "surfvps": { "command": "npx", "args": ["-y", "surfvps-mcp"],
//       "env": { "SURFVPS_TOKEN": "sk_live_..." } } } }
async function main() {
  const token = process.env.SURFVPS_TOKEN;
  const apiBase = process.env.SURFVPS_API ?? "https://surfvps.com";
  if (!token) {
    // MCP speaks JSON-RPC over stdout, so diagnostics MUST go to stderr or they corrupt the stream.
    console.error("surfvps-mcp: SURFVPS_TOKEN is required (create one at surfvps.com → Settings → API tokens)");
    process.exit(1);
  }
  const server = buildServer(makeApi({ apiBase, token }));
  await server.connect(new StdioServerTransport());
  console.error(`surfvps-mcp ready (${apiBase})`);
}
main().catch((e) => { console.error("surfvps-mcp fatal:", e instanceof Error ? e.message : e); process.exit(1); });
