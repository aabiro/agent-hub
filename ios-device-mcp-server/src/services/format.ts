/**
 * Helpers for building MCP tool responses and turning thrown errors into
 * clear, actionable text the calling agent can act on.
 */

import { CommandFailedError, MissingBinaryError } from "./shell.js";

/** MCP content block union used by these tools. */
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResponse {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  /** The SDK's tool-handler return type carries an index signature; mirror it. */
  [key: string]: unknown;
}

/** Build a plain-text success response, optionally attaching structured data. */
export function textResult(
  text: string,
  structured?: Record<string, unknown>,
): ToolResponse {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Build an image response (base64 PNG) with an accompanying caption. */
export function imageResult(
  base64Png: string,
  caption: string,
): ToolResponse {
  return {
    content: [
      { type: "text", text: caption },
      { type: "image", data: base64Png, mimeType: "image/png" },
    ],
  };
}

/** Convert any thrown value into an actionable error response. */
export function errorResult(error: unknown): ToolResponse {
  let text: string;
  if (error instanceof MissingBinaryError) {
    text = `Error: ${error.message}`;
  } else if (error instanceof CommandFailedError) {
    text = `Error: ${error.message}`;
  } else if (error instanceof Error) {
    text = `Error: ${error.message}`;
  } else {
    text = `Error: ${String(error)}`;
  }
  return { content: [{ type: "text", text }], isError: true };
}
