# vue-codex-client

A browser-based chat client for [Codex](https://github.com/openai/codex) AI, built with Vue 3 and connected via a WebSocket bridge server.

![Workspace sidebar](docs/image.png)

## Features

- Chat interface with timeline-based message display
- Thread history grouped by workspace
- Workspace selection and directory browsing
- Model selection and thinking effort controls
- Tool call visibility and approval workflows
- Advanced debug panel (logs, metrics, tool calls)

## Tech Stack

- **Frontend:** Vue 3 + TypeScript + Vite
- **Styling:** Tailwind CSS
- **State:** Pinia
- **Bridge:** Node.js WebSocket server (ws)

## Architecture

```
Browser (Vue SPA)  <──WebSocket──>  Bridge Server (Node.js)  <──stdio──>  Codex Process
```

- `src/` — Frontend application (components, composables, router)
- `server/` — WebSocket bridge server that spawns and communicates with the Codex process

## Project Setup

```sh
npm install
```

### Run in Development

```sh
npm run dev
```

`npm run dev` starts both frontend (Vite) and backend bridge server.
It auto-selects a bridge port, starting from `8787`, and uses the same `BRIDGE_PORT` for both processes.

You can also run each side separately:

```sh
npm run dev:frontend
npm run dev:backend
```

When running separately, pass the same `BRIDGE_PORT` to both commands if you need a non-default port.

The frontend resolves the bridge WebSocket URL automatically with this priority:

1. `bridgeUrl` query parameter (example: `http://localhost:5173/?bridgeUrl=ws://127.0.0.1:8787/bridge`)
2. `VITE_BRIDGE_WS_URL`
3. `ws(s)://<current-host>/bridge` from browser location
4. `ws://127.0.0.1:8787/bridge` (default)

When using `npm run dev:frontend`, Vite proxies `/bridge` websocket traffic to `ws://127.0.0.1:${BRIDGE_PORT:-8787}`, so priority 3 works in local development as well.

To force a specific bridge port instead of auto-selection, set `BRIDGE_PORT` explicitly:

```sh
BRIDGE_PORT=8788 npm run dev
```

### Type-Check, Compile and Minify for Production

```sh
npm run build
```

### Run Unit Tests with [Vitest](https://vitest.dev/)

```sh
npm run test:unit
```

### Run End-to-End Tests with [Playwright](https://playwright.dev)

```sh
# Install browsers for the first run
npx playwright install

# When testing on CI, must build the project first
npm run build

# Runs the end-to-end tests
npm run test:e2e
# Runs the tests only on Chromium
npm run test:e2e -- --project=chromium
# Runs the tests of a specific file
npm run test:e2e -- tests/example.spec.ts
# Runs the tests in debug mode
npm run test:e2e -- --debug

# Screenshot modes
npm run test:e2e:screenshot        # always save screenshots
npm run test:e2e:screenshot:fail   # save only on failure
npm run test:e2e:screenshot:off    # explicitly disable screenshots

# Or control via env var directly (cross-platform)
npx cross-env PW_SCREENSHOT_MODE=only-on-failure npm run test:e2e
```

### Lint with [ESLint](https://eslint.org/)

```sh
npm run lint
```
