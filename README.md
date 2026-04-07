# @olduvai-jp/codex-browser

Browser UI for Codex. This package starts a local bridge server, serves the web app, and connects the browser client to the local `codex` app server over stdio.

## Quick Start

Requirements:

- Node.js `^20.19.0 || >=22.12.0`
- [`codex`](https://github.com/openai/codex) installed and available in `PATH`

Run:

```sh
npx @olduvai-jp/codex-browser
```

What happens next:

- A local URL is printed, such as `http://127.0.0.1:8787/`
- The process keeps running until you stop it
- The browser does not open automatically unless you pass `--open`
- Launch fails if the `codex` command is not available

Common commands:

```sh
npx @olduvai-jp/codex-browser --open
npx @olduvai-jp/codex-browser --auth
npx @olduvai-jp/codex-browser --host 0.0.0.0 --port 9000
npx @olduvai-jp/codex-browser --help
```

CLI options:

- `--host <host>`: bind host (default `127.0.0.1`)
- `--port <port>`: use a fixed port and fail if it is already in use
- `--auth`: enable browser auth with a temporary password for this launch
- `--open`: open the browser after launch
- `--help`: show CLI help

## Optional Browser Auth

To require a login page before opening the UI, pass `--auth`:

```sh
npx @olduvai-jp/codex-browser --auth
```

When `--auth` is enabled:

- The CLI prints a temporary password in your terminal.
- You enter that password on `/login` in the browser.
- A new password is generated each time you launch; it is not persisted.

## Development

Install dependencies:

```sh
npm install
```

Start frontend and backend together:

```sh
npm run dev
```

`npm run dev` runs the public CLI entrypoint in development mode (`CODEX_BROWSER_DEV=1`) without requiring a frontend build. It starts bridge + Vite automatically, prints one browser URL (for example `http://127.0.0.1:8787/`), and proxies frontend HTTP traffic through bridge on that single URL.

In this CLI development mode, HMR is intentionally disabled. Use manual reload after frontend changes.

Run each side separately:

```sh
npm run dev:frontend
npm run dev:backend
```

If you need a fixed bridge port for `npm run dev`, pass `--port` to the CLI through npm:

```sh
npm run dev -- --port 8788
```

If you need standalone Vite behavior (including regular HMR), run `npm run dev:frontend` + `npm run dev:backend` separately.

Frontend bridge URL resolution order:

1. `bridgeUrl` query parameter, for example `http://localhost:5173/?bridgeUrl=ws://127.0.0.1:8787/bridge`
2. `VITE_BRIDGE_WS_URL`
3. `ws(s)://<current-host>/bridge` from the browser location
4. `ws://127.0.0.1:8787/bridge`

When using `npm run dev:frontend`, Vite proxies `/bridge` WebSocket traffic to `ws://127.0.0.1:${BRIDGE_PORT:-8787}`, so option 3 works in local development too.

## Tests and Checks

Build the app:

```sh
npm run build
```

Type-check:

```sh
npm run type-check
```

Run unit tests with [Vitest](https://vitest.dev/):

```sh
npm run test:unit
```

Run end-to-end tests with [Playwright](https://playwright.dev):

```sh
npx playwright install
npm run build
npm run test:e2e
npm run test:e2e -- --project=chromium
npm run test:e2e -- e2e/vue.spec.ts
npm run test:e2e -- --debug
```

Screenshot modes:

```sh
npm run test:e2e:screenshot
npm run test:e2e:screenshot:fail
npm run test:e2e:screenshot:off
npx cross-env PW_SCREENSHOT_MODE=only-on-failure npm run test:e2e
```

Lint with [ESLint](https://eslint.org/):

```sh
npm run lint
```

## Features

- Chat UI with timeline-based message display
- Thread history grouped by workspace
- Workspace selection and directory browsing
- Model selection and thinking-effort controls
- Tool call visibility and approval workflows
- Debug panel for logs, metrics, and tool calls

## Architecture

```text
Browser (Vue SPA)  <->  Bridge Server (Node.js)  <->  Codex Process
```

- `src/`: frontend application
- `server/`: bridge server that spawns and communicates with the Codex process

## Tech Stack

- Frontend: Vue 3 + TypeScript + Vite
- Styling: Tailwind CSS
- State: Pinia
- Bridge: Node.js WebSocket server (`ws`)
