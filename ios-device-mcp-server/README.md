# ios-device-mcp-server

An MCP server for driving **iOS simulators and tethered physical devices** — device discovery, app lifecycle, UI interaction, and screenshots. Built for agentic use (e.g. an ADK agent controlling a device on the same Mac).

Transport is **stdio**: your MCP client spawns this as a subprocess. That's the right model here because the server drives local hardware (Xcode / the tethered device live on the same machine).

## What it wraps

iOS automation is split across three tools with different scopes. This server normalizes them behind one clean tool surface:

| Concern | Underlying tool | Notes |
|---|---|---|
| Simulator lifecycle + screenshots | `xcrun simctl` | First-party, ships with Xcode |
| Physical device lifecycle (install/launch/list) | `xcrun devicectl` | First-party, **Xcode 15+** |
| UI interaction (tap/swipe/type/buttons) | `idb` (Meta) | Optional; required for interaction tools |

## Requirements

- **macOS + Xcode** (with command-line tools: `xcode-select --install`).
- **idb** — only needed for `ios_tap`, `ios_swipe`, `ios_input_text`, `ios_press_button`, and physical-device screenshots:
  ```bash
  brew tap facebook/fb
  brew install idb-companion
  pipx install fb-idb   # provides the `idb` CLI
  ```

### ⚠️ Physical-device UI interaction is the hard part

Install / launch / uninstall / open-url / list on **physical** devices work through first-party `devicectl`. But **tapping, swiping, and typing on a physical device** require `idb` talking to a running **`idb_companion`** against a device that has **WebDriverAgent** provisioned — a non-trivial setup that needs a signing identity. Simulators need none of this: `idb` drives them directly. So: simulator UI automation is easy; physical UI automation requires the WDA/companion stack. The tools surface a clear error telling you what's missing rather than failing silently.

## Install & build

```bash
npm install
npm run build
node dist/index.js   # runs on stdio; prints a banner to stderr
```

## MCP client configuration

```json
{
  "mcpServers": {
    "ios-device": {
      "command": "node",
      "args": ["/absolute/path/to/ios-device-mcp-server/dist/index.js"]
    }
  }
}
```

## Tools (13)

**Discovery & capture**
- `ios_list_devices` — list simulators + physical devices with UDIDs and states.
- `ios_screenshot` — PNG returned inline (the agent's "eyes"); simulators via `simctl`, physical via `idb`.

**Lifecycle**
- `ios_boot_simulator` / `ios_shutdown_simulator` — simulator power (no-op-safe).
- `ios_install_app` / `ios_uninstall_app` — `.app` (sim) or `.app`/`.ipa` (device).
- `ios_launch_app` / `ios_terminate_app` — by bundle id (terminate is simulator-only; physical reports the limitation).
- `ios_open_url` — open a URL or deep link.

**UI interaction** (require `idb`)
- `ios_tap` — tap at (x, y) in points.
- `ios_swipe` — drag between two points.
- `ios_input_text` — type into the focused field.
- `ios_press_button` — HOME / LOCK / SIRI / APPLE_PAY / SIDE_BUTTON.

Every tool takes a `udid` from `ios_list_devices`, or the literal `"booted"` for the active simulator.

## A note on coordinates

Screenshots are in **pixels**; taps are in **points**. Divide pixel coordinates by the device scale factor (usually 2 or 3) before tapping. A future enhancement could return the scale factor alongside each screenshot to remove that manual step.

## Typical agent loop

1. `ios_list_devices` → pick a UDID
2. `ios_boot_simulator`
3. `ios_install_app` → `ios_launch_app`
4. `ios_screenshot` → read the screen
5. `ios_tap` / `ios_input_text` → act
6. `ios_screenshot` → verify

## Extending

- Tools live one-per-domain in `src/tools/`; register new ones in `src/index.ts`.
- Routing between `simctl`/`devicectl`/`idb` lives in `src/services/devices.ts`.
- All shell-outs go through `src/services/shell.ts` (timeouts, injection-safe arg arrays, typed errors).
