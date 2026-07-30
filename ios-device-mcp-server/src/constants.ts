/**
 * Shared constants for the iOS Device MCP server.
 */

/** Maximum characters returned in a single text response before truncation. */
export const CHARACTER_LIMIT = 25000;

/** Default timeout (ms) for short shell commands (list, tap, launch, etc.). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 30000;

/** Longer timeout (ms) for slow operations (app install, boot). */
export const LONG_COMMAND_TIMEOUT_MS = 180000;

/** How long (ms) a cached device list is considered fresh before re-querying. */
export const DEVICE_CACHE_TTL_MS = 5000;
