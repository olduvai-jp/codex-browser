# vue-codex-client

This template should help get you started developing with Vue 3 in Vite.

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Vue (Official)](https://marketplace.visualstudio.com/items?itemName=Vue.volar) (and disable Vetur).

## Recommended Browser Setup

- Chromium-based browsers (Chrome, Edge, Brave, etc.):
  - [Vue.js devtools](https://chromewebstore.google.com/detail/vuejs-devtools/nhdogjmejiglipccpnnnanhbledajbpd)
  - [Turn on Custom Object Formatter in Chrome DevTools](http://bit.ly/object-formatters)
- Firefox:
  - [Vue.js devtools](https://addons.mozilla.org/en-US/firefox/addon/vue-js-devtools/)
  - [Turn on Custom Object Formatter in Firefox DevTools](https://fxdx.dev/firefox-devtools-custom-object-formatters/)

## Type Support for `.vue` Imports in TS

TypeScript cannot handle type information for `.vue` imports by default, so we replace the `tsc` CLI with `vue-tsc` for type checking. In editors, we need [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) to make the TypeScript language service aware of `.vue` types.

## Customize configuration

See [Vite Configuration Reference](https://vite.dev/config/).

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
