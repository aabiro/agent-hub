/**
 * Inspection tools:
 *   browser_screenshot, browser_get_content, browser_evaluate.
 *
 * These are the agent's "eyes" on the page — a pixel view (screenshot), a
 * structural/text view (content), and an escape hatch (evaluate).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { browserManager } from "../services/browser.js";
import { textResult, imageResult, errorResult } from "../services/format.js";
import { CHARACTER_LIMIT } from "../constants.js";

const ScreenshotSchema = z
  .object({
    full_page: z
      .boolean()
      .default(false)
      .describe("Capture the full scrollable page (default: false = viewport only)."),
    selector: z
      .string()
      .min(1)
      .optional()
      .describe("Optional selector to screenshot a single element instead of the page."),
    output_path: z
      .string()
      .optional()
      .describe("Optional absolute path to also save the PNG."),
    include_image_data: z
      .boolean()
      .default(true)
      .describe("Return the PNG inline so the agent can view it (default: true)."),
  })
  .strict();

const GetContentSchema = z
  .object({
    format: z
      .enum(["aria", "text", "html"])
      .default("aria")
      .describe(
        "'aria' = accessibility tree (best for finding elements/selectors), 'text' = visible text, 'html' = raw HTML.",
      ),
    selector: z
      .string()
      .min(1)
      .optional()
      .describe("Optional selector to scope content to one element (default: whole page)."),
  })
  .strict();

const EvaluateSchema = z
  .object({
    expression: z
      .string()
      .min(1)
      .describe(
        "JavaScript evaluated in the page. Either a bare expression ('document.title', 'document.querySelectorAll(\"a\").length') or a function that is auto-invoked ('() => document.querySelector(\"#q\").value'). Both forms return their result.",
      ),
  })
  .strict();

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n…[truncated ${text.length - CHARACTER_LIMIT} chars. Scope with a 'selector' or use format='text' for less.]`
  );
}

export function registerInspectTools(server: McpServer): void {
  server.registerTool(
    "browser_screenshot",
    {
      title: "Screenshot Page",
      description: `Capture a PNG of the page (or one element) and return it inline so the agent can see it.

Args:
  - full_page (boolean): Whole scrollable page vs viewport (default: false).
  - selector (string, optional): Screenshot just this element.
  - output_path (string, optional): Also save the PNG here.
  - include_image_data (boolean): Return image inline (default: true).

Returns: An image block (when include_image_data) plus a caption.

Use when: Visually verifying state, or capturing evidence of a result.`,
      inputSchema: ScreenshotSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ScreenshotSchema>) => {
      try {
        const page = browserManager.getPage();
        let buffer: Buffer;
        if (params.selector) {
          buffer = await page.locator(params.selector).screenshot();
        } else {
          buffer = await page.screenshot({ fullPage: params.full_page });
        }
        if (params.output_path) {
          await writeFile(params.output_path, buffer);
        }
        const caption =
          `Screenshot of ${params.selector ?? page.url()}` +
          (params.output_path ? ` — saved to ${params.output_path}` : "");
        if (!params.include_image_data) {
          return textResult(caption);
        }
        return imageResult(buffer.toString("base64"), caption);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_get_content",
    {
      title: "Get Page Content",
      description: `Read the page's structure or text. Prefer 'aria' — a compact accessibility tree that reveals clickable roles/names to build selectors from, without a huge HTML dump.

Args:
  - format ('aria' | 'text' | 'html'): View to return (default: 'aria').
  - selector (string, optional): Scope to one element.

Returns: The requested content as text, truncated at ${CHARACTER_LIMIT} chars.

Use when: Deciding what to click/fill next, or extracting visible text. Start with 'aria', fall back to 'html' only if you need raw markup.`,
      inputSchema: GetContentSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof GetContentSchema>) => {
      try {
        const page = browserManager.getPage();
        const root = params.selector ? page.locator(params.selector) : page.locator("body");
        let content: string;
        if (params.format === "aria") {
          content = await root.ariaSnapshot();
        } else if (params.format === "text") {
          content = (await root.innerText()) ?? "";
        } else {
          content = params.selector
            ? ((await root.evaluate((el) => el.outerHTML)) as string)
            : await page.content();
        }
        return textResult(truncate(content));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_evaluate",
    {
      title: "Evaluate JavaScript",
      description: `Run JavaScript in the page context and return the JSON-serialized result. An escape hatch for reads/extractions the other tools don't cover.

Args:
  - expression (string): An expression or arrow function, e.g. '() => document.title' or 'window.location.href'.

Returns: The result serialized as JSON (functions/DOM nodes are not serializable and return null).

Use when: Extracting structured data, reading computed state, or checking a condition. Note: this can mutate the page if the code has side effects — keep expressions read-only unless you intend otherwise.`,
      inputSchema: EvaluateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof EvaluateSchema>) => {
      try {
        const page = browserManager.getPage();
        // Playwright treats a string as an expression and does NOT auto-invoke a
        // function form. Wrap so both a bare expression ('document.title') and a
        // function ('() => document.title') evaluate to their result.
        const wrapped = `(() => { const __r = (${params.expression}); return typeof __r === "function" ? __r() : __r; })()`;
        const result: unknown = await page.evaluate(wrapped);
        let text: string;
        try {
          text = JSON.stringify(result, null, 2) ?? String(result);
        } catch {
          text = String(result);
        }
        return textResult(truncate(text ?? "null"));
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
