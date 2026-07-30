/**
 * App & device lifecycle tools:
 *   ios_boot_simulator, ios_shutdown_simulator,
 *   ios_install_app, ios_uninstall_app,
 *   ios_launch_app, ios_terminate_app,
 *   ios_open_url
 *
 * Simulator lifecycle -> `xcrun simctl`.
 * Physical lifecycle   -> `xcrun devicectl` (Xcode 15+). Some operations
 * (e.g. terminate by bundle id) are simulator-only; those report a clear,
 * actionable limitation instead of silently failing.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runCommand } from "../services/shell.js";
import { resolveDevice, invalidateDeviceCache } from "../services/devices.js";
import { textResult, errorResult } from "../services/format.js";
import { LONG_COMMAND_TIMEOUT_MS } from "../constants.js";

const UdidOnly = {
  udid: z
    .string()
    .min(1)
    .describe("Device UDID from ios_list_devices, or 'booted' for the active simulator."),
};

const BootSchema = z.object({ ...UdidOnly }).strict();
const ShutdownSchema = z.object({ ...UdidOnly }).strict();

const InstallSchema = z
  .object({
    ...UdidOnly,
    app_path: z
      .string()
      .min(1)
      .describe(
        "Absolute path to a .app bundle (simulator) or .app/.ipa (physical device).",
      ),
  })
  .strict();

const BundleSchema = z
  .object({
    ...UdidOnly,
    bundle_id: z
      .string()
      .min(1)
      .describe("App bundle identifier, e.g. 'com.example.MyApp'."),
  })
  .strict();

const OpenUrlSchema = z
  .object({
    ...UdidOnly,
    url: z
      .string()
      .min(1)
      .describe("URL or custom deep-link scheme to open, e.g. 'https://x.ai' or 'myapp://path'."),
  })
  .strict();

export function registerLifecycleTools(server: McpServer): void {
  // --- boot (simulator only) ---
  server.registerTool(
    "ios_boot_simulator",
    {
      title: "Boot iOS Simulator",
      description: `Boot a simulator so it can receive apps and interactions. No-op-safe: booting an already-booted simulator succeeds.

Args:
  - udid (string): Simulator UDID from ios_list_devices.

Returns: Confirmation text. Physical devices cannot be "booted" and will return an error.

Use when: A simulator shows state 'Shutdown' and you need it running. Tip: also run \`open -a Simulator\` on the Mac if you want the window visible.`,
      inputSchema: BootSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof BootSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind !== "simulator") {
          return errorResult(
            new Error(
              `'${device.name}' is a physical device and cannot be booted. Physical devices are ready when tethered and unlocked.`,
            ),
          );
        }
        if (device.state === "Booted") {
          return textResult(`Simulator ${device.name} is already booted.`);
        }
        await runCommand("xcrun", ["simctl", "boot", device.udid]);
        invalidateDeviceCache();
        return textResult(`Booted simulator ${device.name} (${device.udid}).`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- shutdown (simulator only) ---
  server.registerTool(
    "ios_shutdown_simulator",
    {
      title: "Shut Down iOS Simulator",
      description: `Shut down a running simulator.

Args:
  - udid (string): Simulator UDID, or 'booted' for the active one.

Returns: Confirmation text. Physical devices return an error.

Use when: Freeing resources or resetting to a clean state between test runs.`,
      inputSchema: ShutdownSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ShutdownSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind !== "simulator") {
          return errorResult(
            new Error(`'${device.name}' is a physical device and cannot be shut down via this tool.`),
          );
        }
        await runCommand("xcrun", ["simctl", "shutdown", device.udid]);
        invalidateDeviceCache();
        return textResult(`Shut down simulator ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- install ---
  server.registerTool(
    "ios_install_app",
    {
      title: "Install iOS App",
      description: `Install an app onto a simulator or physical device.

Routing: simulators use \`simctl install\` (.app bundle); physical devices use \`devicectl device install app\` (.app or signed .ipa). Physical installs require a valid provisioning profile / signing.

Args:
  - udid (string): Target device UDID.
  - app_path (string): Absolute path to the .app (simulator) or .app/.ipa (physical).

Returns: Confirmation text. On signing/provisioning failures the underlying error is surfaced verbatim.

Use when: Deploying a fresh build before launching it.`,
      inputSchema: InstallSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof InstallSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind === "simulator") {
          await runCommand("xcrun", ["simctl", "install", device.udid, params.app_path], {
            timeoutMs: LONG_COMMAND_TIMEOUT_MS,
          });
        } else {
          await runCommand(
            "xcrun",
            ["devicectl", "device", "install", "app", "--device", device.udid, params.app_path],
            { timeoutMs: LONG_COMMAND_TIMEOUT_MS },
          );
        }
        return textResult(`Installed ${params.app_path} on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- uninstall ---
  server.registerTool(
    "ios_uninstall_app",
    {
      title: "Uninstall iOS App",
      description: `Uninstall an app by bundle id from a simulator or physical device.

Routing: \`simctl uninstall\` (simulator) or \`devicectl device uninstall app\` (physical).

Args:
  - udid (string): Target device UDID.
  - bundle_id (string): e.g. 'com.example.MyApp'.

Returns: Confirmation text.

Use when: Cleaning up between installs or resetting app state fully.`,
      inputSchema: BundleSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof BundleSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind === "simulator") {
          await runCommand("xcrun", ["simctl", "uninstall", device.udid, params.bundle_id]);
        } else {
          await runCommand("xcrun", [
            "devicectl",
            "device",
            "uninstall",
            "app",
            "--device",
            device.udid,
            params.bundle_id,
          ]);
        }
        return textResult(`Uninstalled ${params.bundle_id} from ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- launch ---
  server.registerTool(
    "ios_launch_app",
    {
      title: "Launch iOS App",
      description: `Launch an installed app by bundle id.

Routing: \`simctl launch\` (simulator) or \`devicectl device process launch\` (physical).

Args:
  - udid (string): Target device UDID.
  - bundle_id (string): e.g. 'com.example.MyApp'.

Returns: Confirmation text (includes the launched process PID for simulators when available).

Use when: Starting the app under test. Follow with ios_screenshot to confirm it is on screen.`,
      inputSchema: BundleSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof BundleSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        let out = "";
        if (device.kind === "simulator") {
          const res = await runCommand("xcrun", ["simctl", "launch", device.udid, params.bundle_id]);
          out = res.stdout.trim();
        } else {
          const res = await runCommand("xcrun", [
            "devicectl",
            "device",
            "process",
            "launch",
            "--device",
            device.udid,
            params.bundle_id,
          ]);
          out = res.stdout.trim();
        }
        return textResult(
          `Launched ${params.bundle_id} on ${device.name}.` + (out ? ` ${out}` : ""),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- terminate ---
  server.registerTool(
    "ios_terminate_app",
    {
      title: "Terminate iOS App",
      description: `Terminate a running app by bundle id.

Routing: \`simctl terminate\` (simulator). For physical devices, terminating by bundle id is not reliably supported by devicectl across Xcode versions; this tool reports that limitation rather than failing silently.

Args:
  - udid (string): Target device UDID.
  - bundle_id (string): e.g. 'com.example.MyApp'.

Returns: Confirmation text, or a clear limitation notice for physical devices.

Use when: Forcing a clean relaunch of the app under test.`,
      inputSchema: BundleSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof BundleSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind !== "simulator") {
          return textResult(
            `Note: terminating '${params.bundle_id}' by bundle id on physical device '${device.name}' is not supported by devicectl. ` +
              `Relaunch the app to replace the running instance, or terminate it manually on-device.`,
          );
        }
        await runCommand("xcrun", ["simctl", "terminate", device.udid, params.bundle_id]);
        return textResult(`Terminated ${params.bundle_id} on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  // --- open url / deep link ---
  server.registerTool(
    "ios_open_url",
    {
      title: "Open URL / Deep Link",
      description: `Open a URL or custom deep-link scheme on the device (routes to Safari or the app registered for the scheme).

Routing: \`simctl openurl\` (simulator) or \`devicectl device open-url\` where available; falls back to a clear error on unsupported physical setups.

Args:
  - udid (string): Target device UDID.
  - url (string): 'https://...' or 'myapp://...'.

Returns: Confirmation text.

Use when: Testing universal links / deep links, or opening a web page for a browser-based flow.`,
      inputSchema: OpenUrlSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof OpenUrlSchema>) => {
      try {
        const device = await resolveDevice(params.udid);
        if (device.kind === "simulator") {
          await runCommand("xcrun", ["simctl", "openurl", device.udid, params.url]);
        } else {
          await runCommand("xcrun", [
            "devicectl",
            "device",
            "open-url",
            "--device",
            device.udid,
            params.url,
          ]);
        }
        return textResult(`Opened ${params.url} on ${device.name}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
