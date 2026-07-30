/**
 * Capture & inspection tools: ios_list_devices, ios_screenshot.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, unlink } from "node:fs/promises";
import { runCommand } from "../services/shell.js";
import {
  listDevices,
  resolveDevice,
  requireIdb,
} from "../services/devices.js";
import { textResult, imageResult, errorResult } from "../services/format.js";
import type { IosDevice } from "../types.js";

const ListDevicesSchema = z
  .object({
    refresh: z
      .boolean()
      .default(false)
      .describe("Bypass the short-lived cache and re-query simctl/devicectl."),
  })
  .strict();

const ScreenshotSchema = z
  .object({
    udid: z
      .string()
      .min(1)
      .describe(
        "Target device UDID (from ios_list_devices), or the literal 'booted' for the active simulator.",
      ),
    output_path: z
      .string()
      .optional()
      .describe(
        "Optional absolute path to also save the PNG to (e.g. '/tmp/shot.png'). If omitted the image is only returned inline.",
      ),
    include_image_data: z
      .boolean()
      .default(true)
      .describe(
        "When true (default) the PNG is returned inline as an image block so the agent can view it. Set false to only save to output_path and save context.",
      ),
  })
  .strict();

function formatDeviceTable(devices: IosDevice[]): string {
  if (!devices.length) {
    return "No devices found. For simulators, ensure Xcode is installed. For physical devices, tether the device and trust the Mac.";
  }
  const sims = devices.filter((d) => d.kind === "simulator");
  const phys = devices.filter((d) => d.kind === "physical");
  const lines: string[] = [];
  const section = (title: string, list: IosDevice[]) => {
    lines.push(`# ${title} (${list.length})`);
    for (const d of list) {
      lines.push(`- ${d.name} — ${d.osVersion || "unknown OS"}`);
      lines.push(`  udid: ${d.udid}  |  state: ${d.state}  |  available: ${d.available}`);
    }
    lines.push("");
  };
  section("Simulators", sims);
  section("Physical devices", phys);
  return lines.join("\n").trim();
}

export function registerCaptureTools(server: McpServer): void {
  server.registerTool(
    "ios_list_devices",
    {
      title: "List iOS Devices",
      description: `List all available iOS simulators and tethered physical devices.

Merges output from \`xcrun simctl\` (simulators) and \`xcrun devicectl\` (physical devices, Xcode 15+) into one normalized list. Every other tool takes a \`udid\` from this list.

Args:
  - refresh (boolean): Bypass the 5s cache and re-query (default: false).

Returns: For each device — name, kind ('simulator' | 'physical'), osVersion, udid, state, and availability. Simulator states include 'Booted' and 'Shutdown'; physical states include 'connected'.

Use when: You need a UDID, or want to check whether a simulator is already booted.`,
      inputSchema: ListDevicesSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ListDevicesSchema>) => {
      try {
        const devices = await listDevices(params.refresh);
        return textResult(formatDeviceTable(devices), {
          count: devices.length,
          devices: devices as unknown as Record<string, unknown>[],
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ios_screenshot",
    {
      title: "Capture iOS Screenshot",
      description: `Capture a PNG screenshot of a simulator or physical device and return it inline so the agent can see the current screen.

Routing: simulators use first-party \`xcrun simctl io ... screenshot\` (no extra tools needed); physical devices use \`idb screenshot\` (requires idb — see ios_tap description for install).

Args:
  - udid (string): Device UDID, or 'booted' for the active simulator.
  - output_path (string, optional): Absolute path to also save the PNG.
  - include_image_data (boolean): Return the image inline (default: true). Set false to only save to output_path.

Returns: An image content block (when include_image_data) plus a text caption noting the device and any saved path.

Use when: You need to visually verify UI state before/after an interaction. This is the primary "eyes" for visual UI automation.`,
      inputSchema: ScreenshotSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ScreenshotSchema>) => {
      const tmp = `/tmp/ios-mcp-shot-${process.pid}-${Date.now()}.png`;
      try {
        const device = await resolveDevice(params.udid);
        const target = params.output_path ?? tmp;

        if (device.kind === "simulator") {
          await runCommand("xcrun", [
            "simctl",
            "io",
            device.udid,
            "screenshot",
            target,
          ]);
        } else {
          await requireIdb();
          await runCommand("idb", ["screenshot", "--udid", device.udid, target]);
        }

        const caption =
          `Screenshot of ${device.name} (${device.kind})` +
          (params.output_path ? ` — saved to ${params.output_path}` : "");

        if (!params.include_image_data) {
          if (!params.output_path) await unlink(tmp).catch(() => undefined);
          return textResult(caption);
        }

        const png = await readFile(target);
        if (!params.output_path) await unlink(tmp).catch(() => undefined);
        return imageResult(png.toString("base64"), caption);
      } catch (error) {
        await unlink(tmp).catch(() => undefined);
        return errorResult(error);
      }
    },
  );
}
