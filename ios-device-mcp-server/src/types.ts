/**
 * Shared TypeScript types for the iOS Device MCP server.
 */

/** Whether a target is a booted-in-software simulator or a real, tethered device. */
export type DeviceKind = "simulator" | "physical";

/** A normalized view of an iOS device (simulator or physical). */
export interface IosDevice {
  /** Stable unique identifier (UDID). Use this for every other tool call. */
  udid: string;
  /** Human-readable name, e.g. "iPhone 15 Pro". */
  name: string;
  /** simulator or physical. */
  kind: DeviceKind;
  /** Runtime / OS version string, e.g. "iOS 17.5". May be empty for physical. */
  osVersion: string;
  /**
   * Lifecycle state.
   * Simulators: "Booted" | "Shutdown" | "Creating" | ...
   * Physical: "connected" | "unavailable" | ...
   */
  state: string;
  /** True when the device is usable for commands right now. */
  available: boolean;
}

/** Result of running an external command. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  /** Process exit code. 0 means success. null if the process was killed. */
  code: number | null;
}
