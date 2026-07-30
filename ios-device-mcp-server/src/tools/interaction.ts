/**
 * UI interaction tools: ios_tap, ios_swipe, ios_input_text, ios_press_button.
 *
 * All of these drive the on-screen UI via Meta's `idb` (iOS Development Bridge).
 * idb talks to simulators directly. For a physical device you must have an
 * `idb_companion` running against a tethered, WebDriverAgent-provisioned device —
 * the tools surface that requirement in their errors when idb is missing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCommand } from "../services/shell.js";
import { resolveDevice, requireIdb } from "../services/devices.js";
import { textResult, errorResult } from "../services/format.js";

const coordinate = (name: string) =>
  z.number().min(0).describe(`${name} in screen points (origin is top-left).`);

const TapSchema = z
  .object({
    udid: z.string().min(1).describe("Device UDID, or 'booted' for the active simulator."),
    x: coordinate("X coordinate"),
    y: coordinate("Y coordinate"),
  })
  .strict();

const SwipeSchema = z
  .object({
    udid: z.string().min(1).describe("Device UDID, or 'booted'."),
    start_x: coordinate("Start X"),
    start_y: coordinate("Start Y"),
    end_x: coordinate("End X"),
    end_y: coordinate("End Y"),
    duration_seconds: z
      .number()
      .min(0)
      .max(10)
      .default(0.3)
      .describe("Swipe duration in seconds (default 0.3). Larger = slower drag."),
  })
  .strict();

const InputTextSchema = z
  .object({
    udid: z.string().min(1).describe("Device UDID, or 'booted'."),
    text: z
      .string()
      .min(1)
      .describe("Text to type into the currently focused field. Tap the field first."),
  })
  .strict();

const HardwareButton = z.enum(["HOME", "LOCK", "SIRI", "APPLE_PAY", "SIDE_BUTTON"]);

const PressButtonSchema = z
  .object({
    udid: z.string().min(1).describe("Device UDID, or 'booted'."),
    button: HardwareButton.describe(
      "Hardware button to press: HOME, LOCK, SIRI, APPLE_PAY, or SIDE_BUTTON.",
    ),
  })
  .strict();

export function registerInteractionTools(server: McpServer): void {
  server.registerTool(
    "ios_tap",
    {
      title: "Tap Screen",
      description: `Tap at absolute screen coordinates (points, top-left origin) via idb.

Requires idb: \`brew tap facebook/fb && brew install idb-companion\` then \`pipx install fb-idb\`. Physical devices additionally require a running \`idb_companion\` + WebDriverAgent.

Args:
  - udid (string): Device UDID, or 'booted'.
  - x, y (number): Coordinates in points. Take an ios_screenshot first to find targets; note the image is in pixels, so divide by the device scale factor (usually 2 or 3) to get points.

Returns: Confirmation text.

Use when: Pressing a button/field at a known location. Pair with ios_screenshot before and after to verify.`,
      inputSchema: TapSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof TapSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        await requireIdb();
        await runCommand("idb", [
          "ui",
          "tap",
          String(params.x),
          String(params.y),
          "--udid",
          device.udid,
        ]);
        return textResult(`Tapped (${params.x}, ${params.y}) on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ios_swipe",
    {
      title: "Swipe / Drag",
      description: `Swipe or drag from one point to another via idb.

Args:
  - udid (string): Device UDID, or 'booted'.
  - start_x, start_y, end_x, end_y (number): Endpoints in points.
  - duration_seconds (number): Drag duration (default 0.3).

Returns: Confirmation text.

Use when: Scrolling a list, dismissing a sheet, or dragging a control. For a scroll-down, swipe from a lower Y to a higher Y.`,
      inputSchema: SwipeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof SwipeSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        await requireIdb();
        await runCommand("idb", [
          "ui",
          "swipe",
          String(params.start_x),
          String(params.start_y),
          String(params.end_x),
          String(params.end_y),
          "--duration",
          String(params.duration_seconds),
          "--udid",
          device.udid,
        ]);
        return textResult(
          `Swiped (${params.start_x}, ${params.start_y}) -> (${params.end_x}, ${params.end_y}) on ${device.name}.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ios_input_text",
    {
      title: "Type Text",
      description: `Type text into the currently focused input field via idb.

Args:
  - udid (string): Device UDID, or 'booted'.
  - text (string): The text to enter. Focus the field first with ios_tap.

Returns: Confirmation text (does not echo the typed value for long strings).

Use when: Filling a text field after tapping it. If nothing appears, the field likely was not focused — tap it and retry.`,
      inputSchema: InputTextSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof InputTextSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        await requireIdb();
        await runCommand("idb", ["ui", "text", params.text, "--udid", device.udid]);
        const preview =
          params.text.length > 20 ? `${params.text.slice(0, 20)}…` : params.text;
        return textResult(`Typed "${preview}" on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "ios_press_button",
    {
      title: "Press Hardware Button",
      description: `Press a hardware button (Home, Lock, Siri, Apple Pay, Side button) via idb.

Args:
  - udid (string): Device UDID, or 'booted'.
  - button (enum): HOME | LOCK | SIRI | APPLE_PAY | SIDE_BUTTON.

Returns: Confirmation text.

Use when: Backgrounding the app (HOME), locking the screen (LOCK), or testing button-triggered flows.`,
      inputSchema: PressButtonSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof PressButtonSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        await requireIdb();
        await runCommand("idb", ["ui", "button", params.button, "--udid", device.udid]);
        return textResult(`Pressed ${params.button} on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
