/**
 * Session & navigation tools:
 *   browser_launch, browser_navigate, browser_get_url, browser_close.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser.js";
import { textResult, errorResult } from "../services/format.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";

const LaunchSchema = z
  .object({
    browser: z
      .enum(["chromium", "firefox", "webkit"])
      .default("chromium")
      .describe("Browser engine to launch (default: chromium)."),
    headless: z
      .boolean()
      .default(true)
      .describe("Run without a visible window (default: true). Set false to watch it run."),
  })
  .strict();

const WaitUntil = z
  .enum(["load", "domcontentloaded", "networkidle", "commit"])
  .describe("When to consider navigation finished (default: 'load').");

const NavigateSchema = z
  .object({
    url: z.string().min(1).describe("Absolute URL to open, e.g. 'https://example.com'."),
    wait_until: WaitUntil.default("load"),
    timeout_ms: z
      .number()
      .int()
      .min(0)
      .max(120000)
      .default(DEFAULT_TIMEOUT_MS)
      .describe("Navigation timeout in ms (default: 30000)."),
  })
  .strict();

const EmptySchema = z.object({}).strict();

export function registerNavigationTools(server: McpServer): void {
  server.registerTool(
    "browser_launch",
    {
      title: "Launch Browser",
      description: `Start a fresh browser session. Replaces any existing session (old one is closed first).

Args:
  - browser ('chromium' | 'firefox' | 'webkit'): Engine (default: chromium).
  - headless (boolean): Headless mode (default: true).

Returns: Confirmation of the launched engine.

Use when: Beginning any browser flow. Must be called before navigate/click/etc.`,
      inputSchema: LaunchSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof LaunchSchema>) => {
      try {
        await browserManager.launch(params.browser, params.headless);
        return textResult(
          `Launched ${params.browser} (headless=${params.headless}). Ready to navigate.`,
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_navigate",
    {
      title: "Navigate To URL",
      description: `Navigate the active page to a URL.

Args:
  - url (string): Absolute URL.
  - wait_until ('load' | 'domcontentloaded' | 'networkidle' | 'commit'): Completion condition (default: 'load'). Use 'networkidle' for SPA-heavy pages.
  - timeout_ms (number): Timeout (default: 30000).

Returns: Final URL and page title after navigation.

Use when: Loading a page. Requires an open session (browser_launch).`,
      inputSchema: NavigateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof NavigateSchema>) => {
      try {
        const page = browserManager.getPage();
        await page.goto(params.url, {
          waitUntil: params.wait_until,
          timeout: params.timeout_ms,
        });
        const title = await page.title();
        return textResult(`Loaded ${page.url()} — "${title}"`, {
          url: page.url(),
          title,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_get_url",
    {
      title: "Get Current URL",
      description: `Return the active page's current URL and title.

Returns: { url, title }.

Use when: Confirming where the browser ended up after a click or redirect.`,
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const page = browserManager.getPage();
        const title = await page.title();
        return textResult(`${page.url()} — "${title}"`, { url: page.url(), title });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_close",
    {
      title: "Close Browser",
      description: `Close the active browser session and free resources.

Returns: Confirmation. Safe to call even if nothing is open.

Use when: Finished with a flow, or resetting before a clean launch.`,
      inputSchema: EmptySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const wasOpen = browserManager.isLaunched();
        await browserManager.close();
        return textResult(wasOpen ? "Browser closed." : "No browser was open.");
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
