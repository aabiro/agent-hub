# Chat Export: Networked Agent Hub Architecture
**Date:** July 29, 2026
**Participants:** User (`aaryn.biro@xcelsior.ca`) & Gemini CLI

## 1. Architectural Shift: Networked Hub vs. Local Hub
We determined that the standard Model Context Protocol (MCP) using `stdio` (standard input/output) is designed for local execution (the client spawns the server as a background process). Therefore, placing a central `mcp_config.json` in a Cloud Shell environment will not allow local apps (like Claude Desktop on a laptop) to execute cloud tools natively without a bridge.

To achieve a globally accessible, cross-network architecture, we are shifting to an **Advanced Networked Hub**.

## 2. Networked Architecture (MCP over SSE)
We will build a centralized hub that can be accessed globally by various applications.

1.  **The Core Server (GCP):** We will build a Node.js Express application running on a GCP Virtual Machine (or Cloud Run). This app uses the official MCP SDK to expose a **Server-Sent Events (SSE)** endpoint over HTTP/HTTPS.
2.  **The Hosted Tools:** Tools like GCP MCP, GitHub MCP, Playwright, and custom Agent-Forge integrations will be installed on the GCP VM and exposed through the single SSE endpoint.
3.  **The Clients (Global):** Any client (laptop, Claude Desktop, custom apps) connects to this single HTTP endpoint.
4.  **Security:** We will implement authentication and granular routing logic within the Node.js server to control access.

## 3. Hybrid Approach for Local-Only Tools
Tools that require specific local hardware/OS (like the iOS Simulator requiring a Mac) will remain local. Client configurations will connect to both local servers (via stdio) and the remote hub (via SSE).

-   **Server 1 (Local):** `ios-sim-mcp` (runs on Mac, connects via stdio).
-   **Server 2 (Remote):** `https://hub.xcelsior.ca/mcp` (connects to GCP VM via SSE for GitHub, GCP, Agent-Forge).

## 4. Next Steps for Implementation
1.  Initialize a new Node.js project.
2.  Install MCP SDKs (`@modelcontextprotocol/sdk`, `express`).
3.  Write the core `server.js` establishing the SSE transport layer.
