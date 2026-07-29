/**
 * Page interaction tools:
 *   browser_click, browser_fill, browser_type, browser_press_key, browser_wait_for.
 *
 * Selectors accept any Playwright selector engine: CSS ('button.submit'),
 * text ('text=Sign in'), role ('role=button[name="Sign in"]'), or XPath ('xpath=//...').
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { browserManager } from "../services/browser.js";
import { textResult, errorResult } from "../services/format.js";
import { DEFAULT_TIMEOUT_MS } from "../constants.js";

const selectorField = z
  .string()
  .min(1)
  .describe(
    "Playwright selector: CSS ('#email'), text ('text=Log in'), role ('role=button[name=\"Submit\"]'), or XPath ('xpath=//a').",
  );

const timeoutField = z
  .number()
  .int()
  .min(0)
  .max(120000)
  .default(DEFAULT_TIMEOUT_MS)
  .describe("Timeout in ms (default: 30000).");

const ClickSchema = z
  .object({
    selector: selectorField,
    timeout_ms: timeoutField,
  })
  .strict();

const FillSchema = z
  .object({
    selector: selectorField,
    value: z.string().describe("Value to set. Replaces any existing content in the field."),
    timeout_ms: timeoutField,
  })
  .strict();

const TypeSchema = z
  .object({
    selector: selectorField,
    text: z.string().min(1).describe("Text to type key-by-key (fires keydown/keyup for each char)."),
    delay_ms: z
      .number()
      .int()
      .min(0)
      .max(1000)
      .default(0)
      .describe("Delay between keystrokes in ms (default: 0). Use for inputs that debounce."),
    timeout_ms: timeoutField,
  })
  .strict();

const PressKeySchema = z
  .object({
    key: z
      .string()
      .min(1)
      .describe("Key or combo, e.g. 'Enter', 'Tab', 'Escape', 'Control+A', 'ArrowDown'."),
    selector: selectorField
      .optional()
      .describe("Optional selector to focus before pressing. Omit to press on the page."),
    timeout_ms: timeoutField,
  })
  .strict();

const WaitForSchema = z
  .object({
    selector: selectorField
      .optional()
      .describe("Wait for this element to reach the given state. Mutually primary over load_state."),
    state: z
      .enum(["attached", "detached", "visible", "hidden"])
      .default("visible")
      .describe("Element state to wait for when 'selector' is given (default: 'visible')."),
    load_state: z
      .enum(["load", "domcontentloaded", "networkidle"])
      .optional()
      .describe("Instead of a selector, wait for this page load state."),
    timeout_ms: timeoutField,
  })
  .strict();

export function registerInteractionTools(server: McpServer): void {
  server.registerTool(
    "browser_click",
    {
      title: "Click Element",
      description: `Click the first element matching a selector. Auto-waits for it to be actionable.

Args:
  - selector (string): Playwright selector (CSS/text/role/xpath).
  - timeout_ms (number): Timeout (default: 30000).

Returns: Confirmation.

Use when: Pressing buttons/links. If it times out, the element may be hidden or the selector wrong — use browser_get_content(format='aria') to inspect.`,
      inputSchema: ClickSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof ClickSchema>) => {
      try {
        const page = browserManager.getPage();
        await page.click(params.selector, { timeout: params.timeout_ms });
        return textResult(`Clicked ${params.selector}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_fill",
    {
      title: "Fill Input",
      description: `Set the value of an input/textarea/contenteditable in one shot (clears then fills).

Args:
  - selector (string): Selector for the field.
  - value (string): Value to set.
  - timeout_ms (number): Timeout (default: 30000).

Returns: Confirmation.

Use when: Populating form fields fast. Prefer this over browser_type unless you specifically need per-key events.`,
      inputSchema: FillSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof FillSchema>) => {
      try {
        const page = browserManager.getPage();
        await page.fill(params.selector, params.value, { timeout: params.timeout_ms });
        return textResult(`Filled ${params.selector}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_type",
    {
      title: "Type Text",
      description: `Type text into an element key-by-key, firing real keyboard events.

Args:
  - selector (string): Selector for the field.
  - text (string): Text to type.
  - delay_ms (number): Per-keystroke delay (default: 0).
  - timeout_ms (number): Timeout (default: 30000).

Returns: Confirmation.

Use when: An input reacts to individual keystrokes (autocomplete, masked inputs). Otherwise use browser_fill.`,
      inputSchema: TypeSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof TypeSchema>) => {
      try {
        const page = browserManager.getPage();
        await page.type(params.selector, params.text, {
          delay: params.delay_ms,
          timeout: params.timeout_ms,
        });
        return textResult(`Typed into ${params.selector}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_press_key",
    {
      title: "Press Key",
      description: `Press a key or key combination, optionally focusing an element first.

Args:
  - key (string): e.g. 'Enter', 'Tab', 'Escape', 'Control+A', 'ArrowDown'.
  - selector (string, optional): Focus this element before pressing.
  - timeout_ms (number): Timeout (default: 30000).

Returns: Confirmation.

Use when: Submitting a form with Enter, navigating with Tab/arrows, or issuing shortcuts.`,
      inputSchema: PressKeySchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof PressKeySchema>) => {
      try {
        const page = browserManager.getPage();
        if (params.selector) {
          await page.press(params.selector, params.key, { timeout: params.timeout_ms });
          return textResult(`Pressed ${params.key} on ${params.selector}.`);
        }
        await page.keyboard.press(params.key);
        return textResult(`Pressed ${params.key}.`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "browser_wait_for",
    {
      title: "Wait For Condition",
      description: `Wait for an element to reach a state, or for a page load state.

Args:
  - selector (string, optional): Element to wait for.
  - state ('attached' | 'detached' | 'visible' | 'hidden'): Element state (default: 'visible'). Used with selector.
  - load_state ('load' | 'domcontentloaded' | 'networkidle'): Wait for this page state instead. Used when selector is omitted.
  - timeout_ms (number): Timeout (default: 30000).

Returns: Confirmation of what was awaited.

Use when: Content loads asynchronously after a click/navigation and you need to sync before the next step.`,
      inputSchema: WaitForSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params: z.infer<typeof WaitForSchema>) => {
      try {
        const page = browserManager.getPage();
        if (params.selector) {
          await page.waitForSelector(params.selector, {
            state: params.state,
            timeout: params.timeout_ms,
          });
          return textResult(`'${params.selector}' is now ${params.state}.`);
        }
        if (params.load_state) {
          await page.waitForLoadState(params.load_state, { timeout: params.timeout_ms });
          return textResult(`Page reached load state '${params.load_state}'.`);
        }
        return errorResult(
          new Error("Provide either 'selector' (with optional 'state') or 'load_state'."),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
