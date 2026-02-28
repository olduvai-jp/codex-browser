import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

function isEnvEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true'
}

function resolveWebServerPort(): number {
  const raw = process.env.PW_WEB_SERVER_PORT?.trim()
  if (!raw) {
    return 4173
  }

  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4173
}

type ScreenshotMode = 'off' | 'on' | 'only-on-failure'

function resolveScreenshotMode(): ScreenshotMode {
  const envValue = process.env.PW_SCREENSHOT_MODE?.trim()
  const raw = envValue?.toLowerCase()
  if (!raw) {
    return 'off'
  }

  if (raw === '1' || raw === 'true' || raw === 'on') {
    return 'on'
  }

  if (raw === '0' || raw === 'false' || raw === 'off') {
    return 'off'
  }

  if (raw === 'only-on-failure') {
    return 'only-on-failure'
  }

  // Warn once during config evaluation when env is set but invalid.
  console.warn(
    `[playwright.config] Invalid PW_SCREENSHOT_MODE="${envValue}". Falling back to "off". ` +
      'Allowed values: off, on, only-on-failure (also accepts 0/1/false/true).',
  )
  return 'off'
}

const isCi = Boolean(process.env.CI)
const usePreviewServer = isCi || isEnvEnabled('PW_USE_PREVIEW_SERVER')
const webServerHost = process.env.PW_WEB_SERVER_HOST?.trim() || '127.0.0.1'
const webServerPort = resolveWebServerPort()
const screenshotMode = resolveScreenshotMode()
const defaultWebServerCommand = usePreviewServer
  ? `npm run build-only && npm run preview -- --host ${webServerHost} --port ${webServerPort} --strictPort`
  : `npm run dev:frontend -- --host ${webServerHost} --port ${webServerPort} --strictPort`
const webServerCommand = process.env.PW_WEB_SERVER_COMMAND?.trim() || defaultWebServerCommand
const reuseExistingServer = !isCi && isEnvEnabled('PW_REUSE_EXISTING_SERVER')

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  /* Maximum time one test can run for. */
  timeout: 30 * 1000,
  expect: {
    /**
     * Maximum time expect() should wait for the condition to be met.
     * For example in `await expect(locator).toHaveText();`
     */
    timeout: 5000,
  },
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Maximum time each action such as `click()` can take. Defaults to 0 (no limit). */
    actionTimeout: 0,
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: `http://${webServerHost}:${webServerPort}`,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Collect screenshots based on PW_SCREENSHOT_MODE: off/on/only-on-failure */
    screenshot: screenshotMode,

    /* Run all E2E tests in headless mode by default */
    headless: true,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
      },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //   },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: {
    //     ...devices['iPhone 12'],
    //   },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: {
    //     channel: 'msedge',
    //   },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: {
    //     channel: 'chrome',
    //   },
    // },
  ],

  /* Folder for test artifacts such as screenshots, videos, traces, etc. */
  // outputDir: 'test-results/',

  /* Run your local dev server before starting the tests */
  webServer: {
    /**
     * Use preview server on CI.
     * Keep local re-use disabled by default to avoid accidentally attaching to unrelated processes.
     * Set PW_REUSE_EXISTING_SERVER=1 when explicit reuse is desired.
     */
    command: webServerCommand,
    port: webServerPort,
    reuseExistingServer,
  },
})
