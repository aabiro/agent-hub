/**
 * Device discovery, caching, and routing.
 *
 * iOS automation is split across three Apple/Meta tools with different scopes:
 *   - `xcrun simctl`    -> simulator lifecycle + screenshots (first-party, always present with Xcode)
 *   - `xcrun devicectl` -> physical device lifecycle (first-party, Xcode 15+)
 *   - `idb`             -> UI interaction (tap/swipe/type) on simulators and, with a
 *                          companion + WebDriverAgent, on physical devices (Meta, optional)
 *
 * This module normalizes both device sources into a single IosDevice[] and lets
 * the tool layer resolve a UDID to its kind so it can pick the right underlying CLI.
 */

import { runCommand, binaryExists } from "./shell.js";
import { DEVICE_CACHE_TTL_MS } from "../constants.js";
import type { IosDevice, DeviceKind } from "../types.js";

const IDB_INSTALL_HINT =
  "idb is required for UI interaction (tap/swipe/type). Install it with: " +
  "`brew tap facebook/fb && brew install idb-companion` then `pipx install fb-idb`. " +
  "For physical devices you must also run `idb_companion --udid <udid>` with the device tethered.";

// ---------------------------------------------------------------------------
// simctl (simulators)
// ---------------------------------------------------------------------------

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable?: boolean;
}

interface SimctlListOutput {
  devices: Record<string, SimctlDevice[]>; // keyed by runtime identifier
}

/** Convert a simctl runtime key like "com.apple.CoreSimulator.SimRuntime.iOS-17-5" to "iOS 17.5". */
function prettyRuntime(runtimeKey: string): string {
  const tail = runtimeKey.split(".").pop() ?? runtimeKey;
  const match = tail.match(/^([A-Za-z]+)-(.+)$/);
  if (!match) return tail;
  return `${match[1]} ${match[2].replace(/-/g, ".")}`;
}

async function listSimulators(): Promise<IosDevice[]> {
  const { stdout } = await runCommand("xcrun", [
    "simctl",
    "list",
    "devices",
    "available",
    "--json",
  ]);
  const parsed = JSON.parse(stdout) as SimctlListOutput;
  const devices: IosDevice[] = [];
  for (const [runtime, sims] of Object.entries(parsed.devices)) {
    for (const sim of sims) {
      devices.push({
        udid: sim.udid,
        name: sim.name,
        kind: "simulator",
        osVersion: prettyRuntime(runtime),
        state: sim.state,
        available: sim.isAvailable ?? true,
      });
    }
  }
  return devices;
}

// ---------------------------------------------------------------------------
// devicectl (physical devices, Xcode 15+)
// ---------------------------------------------------------------------------

interface DevicectlDeviceEntry {
  identifier?: string;
  hardwareProperties?: { udid?: string; marketingName?: string; productType?: string };
  deviceProperties?: { name?: string; osVersionNumber?: string };
  connectionProperties?: { tunnelState?: string; pairingState?: string };
}

interface DevicectlOutput {
  result?: { devices?: DevicectlDeviceEntry[] };
}

async function listPhysicalDevices(): Promise<IosDevice[]> {
  // devicectl only emits JSON to a file, so route it through a temp path.
  const tmp = `/tmp/ios-mcp-devicectl-${process.pid}-${Date.now()}.json`;
  try {
    await runCommand("xcrun", [
      "devicectl",
      "list",
      "devices",
      "--json-output",
      tmp,
    ]);
    const { readFile, unlink } = await import("node:fs/promises");
    const raw = await readFile(tmp, "utf8");
    await unlink(tmp).catch(() => undefined);
    const parsed = JSON.parse(raw) as DevicectlOutput;
    const entries = parsed.result?.devices ?? [];
    return entries.map((d): IosDevice => {
      const udid = d.hardwareProperties?.udid ?? d.identifier ?? "";
      const name =
        d.deviceProperties?.name ??
        d.hardwareProperties?.marketingName ??
        "Unknown device";
      const state = d.connectionProperties?.tunnelState ?? "unknown";
      return {
        udid,
        name,
        kind: "physical",
        osVersion: d.deviceProperties?.osVersionNumber
          ? `iOS ${d.deviceProperties.osVersionNumber}`
          : "",
        state,
        available: state === "connected" || state === "available",
      };
    });
  } catch {
    // No physical devices / devicectl unavailable is a soft failure: just return none.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cache + public API
// ---------------------------------------------------------------------------

let cache: { at: number; devices: IosDevice[] } | null = null;

/** List all known devices (simulators + physical), using a short-lived cache. */
export async function listDevices(forceRefresh = false): Promise<IosDevice[]> {
  const now = Date.now();
  if (!forceRefresh && cache && now - cache.at < DEVICE_CACHE_TTL_MS) {
    return cache.devices;
  }
  const [sims, phys] = await Promise.all([
    listSimulators().catch(() => [] as IosDevice[]),
    listPhysicalDevices(),
  ]);
  const devices = [...sims, ...phys];
  cache = { at: now, devices };
  return devices;
}

/** Invalidate the device cache (call after boot/shutdown so state reads fresh). */
export function invalidateDeviceCache(): void {
  cache = null;
}

/**
 * Resolve a UDID (or the literal "booted") to a concrete device.
 * Throws a descriptive Error listing candidates when the UDID is unknown.
 */
export async function resolveDevice(udid: string): Promise<IosDevice> {
  const devices = await listDevices();
  if (udid === "booted") {
    const booted = devices.find(
      (d) => d.kind === "simulator" && d.state === "Booted",
    );
    if (booted) return booted;
    throw new Error(
      "No booted simulator found. Boot one first with ios_boot_simulator, " +
        "or pass a specific UDID from ios_list_devices.",
    );
  }
  const match = devices.find((d) => d.udid === udid);
  if (match) return match;

  // Also allow matching by exact name for convenience.
  const byName = devices.filter((d) => d.name === udid);
  if (byName.length === 1) return byName[0];

  const known = devices
    .slice(0, 10)
    .map((d) => `${d.name} (${d.udid}, ${d.kind}, ${d.state})`)
    .join("; ");
  throw new Error(
    `No device found for '${udid}'. Call ios_list_devices to see valid UDIDs. ` +
      `Known devices: ${known || "(none)"}`,
  );
}

/** Ensure idb is installed; throw an actionable error otherwise. */
export async function requireIdb(): Promise<void> {
  if (!(await binaryExists("idb"))) {
    throw new Error(IDB_INSTALL_HINT);
  }
}

export { IDB_INSTALL_HINT };
export type { DeviceKind };
