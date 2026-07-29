#!/usr/bin/env node
/**
 * Playwright MCP Server.
 *
 * Browser automation tools: launch/navigate, click/fill/type/press/wait, and
 * screenshot/content/evaluate. The server holds one live browser session across
 * calls so a sequence of tools drives a single window.
 *
 * Transport: stdio (spawned as a subprocess by the MCP client).
 *
 * Requires the Playwright browsers to be installed (handled by `npm install`
 * via the postinstall `playwright install chromium`; run `npx playwright install`
 * for firefox/webkit).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerNavigationTools } from "./tools/navigation.js";
import { registerInteractionTools } from "./tools/interaction.js";
import { registerInspectTools } from "./tools/inspect.js";
import { browserManager } from "./services/browser.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "playwright-mcp-server",
    version: "1.0.0",
  });

  registerNavigationTools(server);
  registerInteractionTools(server);
  registerInspectTools(server);

  // Ensure the browser is torn down cleanly on shutdown.
  const shutdown = async (): Promise<void> => {
    await browserManager.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("playwright-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting playwright-mcp-server:", error);
  process.exit(1);
});
