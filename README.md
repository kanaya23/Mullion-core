# Mullion Core

One browser. One task. Wake up, execute, shut down. Mullion Core is a lightweight Node.js service that launches a stealth Playwright browser on demand, runs a stack (extension-like module), returns JSON results, and closes the browser.

## What Mullion Core Is

- A single HTTPS listener on a small VM (1GB RAM safe)
- One browser instance at a time, started only when a task is requested
- Extension-like runtime for stacks: cookies, storage, webRequest, tabs, inject
- No database, no queue, no containers, no WebSockets

## Architecture

```
Netlify (static UI) -> HTTPS -> Caddy -> Mullion Core
```

## Prerequisites

- Ubuntu Server 22.04 LTS VM
- Ports 22, 80, 443 open inbound
- A public DNS label for the VM (Azure provides one for free)

## Azure VM Preparation (One Time)

1. **Create the VM**
   - Image: Ubuntu Server 22.04 LTS (minimal)
   - Size: B2v2
   - Authentication: SSH key (no password)

2. **Open ports 22, 80, 443**
   - VM -> Networking -> NSG inbound rules
   - Port 80 is only for the initial Let's Encrypt challenge

3. **Assign a static public IP**
   - VM -> Public IP resource -> Allocation = Static

4. **Set a free DNS label**
   - VM -> Public IP resource -> DNS name label
   - Example: `mullion.eastus.cloudapp.azure.com`

That DNS label is your permanent public domain and works with Caddy + Let's Encrypt.

## VM Bootstrap

SSH into the VM and run:

```bash
git clone https://github.com/youruser/mullion-core.git
cd mullion-core
nano mullion.config.json
sudo bash setup.sh
```

### mullion.config.json

```json
{
  "domain": "mullion.eastus.cloudapp.azure.com",
  "port": 3000,
  "auth_token": "replace-with-strong-token",
  "max_wake_duration_seconds": 300,
  "log_retention_count": 50,
  "allowed_origin": "https://yoursite.netlify.app"
}
```

**Field meanings:**

- `domain`: your Azure DNS label
- `port`: internal listener port (Caddy proxies to this)
- `auth_token`: shared secret used by frontend calls
- `max_wake_duration_seconds`: hard timeout for a wake
- `log_retention_count`: how many JSON task logs to keep
- `allowed_origin`: Netlify site URL for CORS

### What setup.sh does

1. Validates Ubuntu version
2. Installs base dependencies (curl, git, unzip)
3. Creates the `mullion` system user
4. Ensures 512MB swap is present
5. Installs Node.js LTS
6. Runs `npm install`
7. Installs Playwright Chromium + system deps
8. Installs Caddy
9. Generates the Caddyfile from your config
10. Creates runtime directories (`/profiles`, `/stacks`, `/logs`, `/storage`)
11. Installs a systemd service for Mullion
12. Runs a health check

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | No | VM status, memory, busy/idle |
| POST | `/wake` | Yes | Trigger a stack, returns `task_id` |
| GET | `/task/:id` | Yes | Task status and result |
| GET | `/stacks` | Yes | List available stacks |

All authenticated requests must include `Authorization: Bearer <token>`.

## Stack System

### File structure

```
/stacks/my-stack
  stack.config.json
  main.js
  /content
    inject.js
```

### stack.config.json

```json
{
  "name": "my-stack",
  "description": "What this stack does",
  "profile": "my-stack",
  "entry_url": "https://example.com/dashboard",
  "timeout": 120,
  "permissions": {
    "origins": ["https://example.com/*"],
    "capabilities": ["cookies", "storage", "webRequest", "tabs"]
  },
  "content_scripts": [
    {
      "matches": ["https://example.com/app/*"],
      "js": ["content/inject.js"],
      "run_at": "document_idle"
    }
  ],
  "intercept_patterns": ["**/api/**"],
  "params": [
    {
      "name": "note",
      "label": "Optional note",
      "type": "text"
    }
  ]
}
```

### main.js contract

```js
module.exports = async function (mullion, params) {
  // use mullion.page, mullion.cookies, mullion.storage, etc.
  return { success: true };
};
```

Rules:
- Must export a single async function
- Must return JSON-serializable data
- Errors thrown are reported as task failures

### Profiles

Profiles persist login state per stack. Create them once, then reuse:

```bash
node cli/create-profile.js my-stack
```

A visible browser opens at `entry_url`. Log in, then close the window to save the profile.

### Stack storage

Each stack has a storage file at `/storage/<stack>.json` and can read/write via `mullion.storage`.

## Mullion API (Runtime)

- `mullion.page` / `mullion.context` — Playwright objects
- `mullion.request(url, options)` — cross-origin fetch (no CORS)
- `mullion.cookies` — get/set/remove cookies
- `mullion.storage` — persistent key-value store
- `mullion.intercept` — request/response interception
- `mullion.inject` — inject scripts/styles
- `mullion.tabs` — multi-page control
- `mullion.headers` — persistent headers
- `mullion.dom` — DOM helpers
- `mullion.wait` — wait helpers (`forSelector`, `forNetworkIdle`, `until`, `race`)

## Running a Stack Locally

```bash
node cli/test-stack.js example-stack '{"note":"hello"}'
```

## Netlify Frontend

1. Open `netlify-site/config.js` and set:
   - `MULLION_URL` to your Azure DNS label
   - `MULLION_TOKEN` to your auth token
2. Deploy the `netlify-site` folder to Netlify (drag-and-drop or repo connection)
3. Load the site. It will poll `/health` every 15 seconds and list stacks.

## Extension Porting Guide

### Step 1 — Map what your extension does

List the pages it visits, the DOM it touches, the network calls it makes, and the data it returns.

### Step 2 — Map Chrome APIs to Mullion APIs

| Chrome API | Mullion API |
|---|---|
| `chrome.tabs.create()` | `mullion.tabs.create()` |
| `chrome.tabs.query()` | `mullion.tabs.list()` |
| `chrome.tabs.update()` | `mullion.tabs.focus()` / `mullion.page.goto()` |
| `chrome.scripting.executeScript()` | `mullion.inject.script()` |
| `chrome.cookies.get()` | `mullion.cookies.get()` |
| `chrome.cookies.set()` | `mullion.cookies.set()` |
| `chrome.storage.local.get()` | `mullion.storage.get()` |
| `chrome.storage.local.set()` | `mullion.storage.set()` |
| `chrome.webRequest.onBeforeRequest` | `mullion.intercept.onRequest()` |
| `chrome.webRequest.onCompleted` | `mullion.intercept.onResponse()` |
| `fetch()` (cross-origin) | `mullion.request()` |

### Step 3 — Restructure the extension

Convert the extension into a stack folder with `stack.config.json`, `main.js`, and optional content scripts.

### Step 4 — Convert background logic

Replace event handlers with sequential calls inside `main.js`. Return a JSON object as your result.

## Testing

```bash
npm test
```

## Maintenance

```bash
sudo systemctl status mullion
journalctl -u mullion -f
sudo systemctl restart mullion
```
