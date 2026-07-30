#!/usr/bin/env node
/**
 * iOS Device MCP Server.
 *
 * Exposes tools for controlling iOS simulators and tethered physical devices:
 * device discovery, lifecycle (boot/install/launch/…), UI interaction
 * (tap/swipe/type/buttons), and screenshots.
 *
 * Transport: stdio (spawned as a subprocess by the MCP client). This is the
 * right model for a tool that drives local hardware — the client and server
 * share the same machine as Xcode / the tethered device.
 *
 * Requires macOS with Xcode command-line tools. UI interaction and physical-
 * device screenshots additionally require Meta's `idb`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerCaptureTools } from "./tools/capture.js";
import { registerLifecycleTools } from "./tools/lifecycle.js";
import { registerInteractionTools } from "./tools/interaction.js";

async function main(): Promise<void> {
  const server = new McpServer({
    name: "ios-device-mcp-server",
    version: "1.0.0",
  });

  registerCaptureTools(server);
  registerLifecycleTools(server);
  registerInteractionTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Logs must go to stderr; stdout is reserved for the MCP protocol.
  console.error("ios-device-mcp-server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting ios-device-mcp-server:", error);
  process.exit(1);
});
