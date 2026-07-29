# playwright-mcp-server

A custom MCP server for **browser automation via Playwright** — navigate, click, fill, type, wait, screenshot, read the accessibility tree, and evaluate JS. It holds **one live browser session** across tool calls, so a sequence of tools drives a single window like a human would.

Transport is **stdio**: your MCP client spawns it as a subprocess.

> **Why custom instead of `@playwright/mcp`?** Microsoft ships an official Playwright MCP server, and it's excellent if you want batteries-included. This one is deliberately lean and fully yours to extend — a good base to bake into your agent platform. If you'd rather not maintain it, the official one is a drop-in alternative; the tool shapes here are intentionally similar.

## Requirements

- Node 18+.
- Playwright browsers. `npm install` runs `playwright install chromium` for you via `postinstall`. For the other engines:
  ```bash
  npx playwright install firefox webkit
  ```

## Install & build

```bash
npm install         # installs deps + chromium
npm run build
node dist/index.js  # runs on stdio
```

## MCP client configuration

```json
{
  "mcpServers": {
    "playwright": {
      "command": "node",
      "args": ["/absolute/path/to/playwright-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools (12)

**Session & navigation**
- `browser_launch` — start chromium / firefox / webkit (headless toggle). Replaces any existing session.
- `browser_navigate` — go to a URL with a `wait_until` condition.
- `browser_get_url` — current URL + title.
- `browser_close` — tear down the session.

**Interaction**
- `browser_click` — click by selector (auto-waits for actionability).
- `browser_fill` — set an input value in one shot.
- `browser_type` — type key-by-key (for inputs that react to keystrokes).
- `browser_press_key` — press a key/combo, optionally focusing an element first.
- `browser_wait_for` — wait for an element state or a page load state.

**Inspection**
- `browser_screenshot` — PNG returned inline (page, viewport, or a single element).
- `browser_get_content` — `aria` (accessibility tree — best for finding what to click), `text`, or `html`. Truncated at 25k chars.
- `browser_evaluate` — run JS in the page. Accepts a bare expression *or* a function form (auto-invoked).

## Selectors

Any Playwright selector engine works:
- CSS — `#email`, `button.primary`
- Text — `text=Sign in`
- Role — `role=button[name="Submit"]`
- XPath — `xpath=//a[@href]`

**Recommended agent flow:** `browser_get_content(format='aria')` first to see roles/names, then target elements by role or text. It's far more robust than guessing CSS from raw HTML.

## Typical agent loop

1. `browser_launch`
2. `browser_navigate` → your URL
3. `browser_get_content(format='aria')` → understand the page
4. `browser_fill` / `browser_click` → act
5. `browser_wait_for` → sync on async content
6. `browser_screenshot` → verify / capture evidence

## Design notes

- **State**: a single `BrowserManager` singleton (`src/services/browser.ts`) holds browser + context + page. Every tool calls `getPage()`, which throws an actionable error if nothing is launched yet. Extend with a page/tab map if you need multiple tabs.
- **Context efficiency**: prefer the `aria` snapshot over `html`; both are truncated at `CHARACTER_LIMIT` (25k) with a note to scope via `selector`.
- **`browser_evaluate`** is powerful — it can mutate the page if your code has side effects. Keep expressions read-only unless you mean otherwise.
- Tools are grouped by domain in `src/tools/`; register new ones in `src/index.ts`.

## Verified

Launch → navigate → aria snapshot → fill → evaluate → click → screenshot → error handling were run end-to-end against real Chromium.
# gcp-mcp-hub
