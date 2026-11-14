import path from "node:path";
import { defineConfig } from "@playwright/test";

const root = import.meta.dirname;

// Local settings (OBS WebSocket, LAN address). Copied from .env.local.example; git-ignored.
try {
  process.loadEnvFile(path.join(root, ".env.local"));
} catch {
  // No .env.local yet: tests that need OBS or the LAN address check for it themselves.
}

// One id per run, shared with the worker processes through the environment, so every
// file of a run lands in evidence/<run-id>/.
process.env.E2E_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join(root, "evidence", process.env.E2E_RUN_ID);

export default defineConfig({
  testDir: "suites",
  outputDir: path.join(runDir, "test-results"),

  // The clients of one test share the PC's GPU, the media servers and the rooms,
  // so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,

  // Several browsers start together and rooms take a while to enter. Long tests
  // (T2.15 runs 40 minutes) raise their own limit with test.setTimeout().
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },

  // Checks the stack and writes run.json before any test
  globalSetup: "./suites/global-setup.ts",

  // report/reporter.ts completes each test's result.json and builds evidence/<run-id>/report.html
  reporter: [["list"], ["json", { outputFile: path.join(runDir, "results.json") }], ["./report/reporter.ts"]],

  use: {
    baseURL: "https://hubs.local:4000",
    // The local stack uses mkcert certificates, which Playwright's own browsers may not trust.
    ignoreHTTPSErrors: true,
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
    // Traces only when a failed test is re-run (plan 3.3); clients record their own video.
    trace: "off",
    video: "off",
    screenshot: "off"
  }
});
