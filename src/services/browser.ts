/**
 * Stateful browser session manager.
 *
 * The MCP server process holds a single live browser + context + page so that
 * a sequence of tool calls (launch -> navigate -> click -> screenshot) operates
 * on the same session. This mirrors how a human drives one browser window.
 *
 * A single active page keeps the mental model simple for the calling agent.
 * Extend with a page map if you later need multiple tabs.
 */

import { chromium, firefox, webkit } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

export type BrowserName = "chromium" | "firefox" | "webkit";

const ENGINES = { chromium, firefox, webkit } as const;

class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private active: BrowserName | null = null;

  /** Launch a fresh browser, replacing any existing session. */
  async launch(name: BrowserName, headless: boolean): Promise<void> {
    await this.close();
    const engine = ENGINES[name];
    this.browser = await engine.launch({ headless });
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.active = name;
  }

  /** Get the active page, or throw an actionable error if none is launched. */
  getPage(): Page {
    if (!this.page) {
      throw new Error(
        "No browser session is open. Call browser_launch first (e.g. browser='chromium', headless=true).",
      );
    }
    return this.page;
  }

  isLaunched(): boolean {
    return this.page !== null;
  }

  activeBrowser(): BrowserName | null {
    return this.active;
  }

  /** Close and reset the session. Safe to call when nothing is open. */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => undefined);
    }
    this.browser = null;
    this.context = null;
    this.page = null;
    this.active = null;
  }
}

/** Module-level singleton shared by all tools. */
export const browserManager = new BrowserManager();
