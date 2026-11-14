// A Playwright reporter that completes the evidence of each test and builds report.html at the end.
// Tests that never started their evidence fixture (skipped before it, or failed in a hook) still get a
// result.json from what Playwright knows; a Playwright failure the fixture did not see (a timeout, an
// error after the fixture's teardown) turns the test's status to NG.
import fs from "node:fs";
import path from "node:path";
import type { FullResult, Reporter, TestCase, TestResult as PlaywrightResult } from "@playwright/test/reporter";
import { evidenceId, runDir, statusOf, testMeta, type TestResult } from "./evidence";
import { buildReport } from "./build-report";

export default class EvidenceReporter implements Reporter {
  private ended = 0;

  onTestEnd(test: TestCase, result: PlaywrightResult) {
    this.ended++;
    const meta = testMeta(test.annotations, test.title);
    const file = path.join(runDir(), evidenceId(meta.id, test.repeatEachIndex), "result.json");
    const error = result.errors.map(e => e.message?.split("\n")[0]).filter(Boolean).join("; ") || undefined;
    const annotations = [...test.annotations, ...((result as { annotations?: typeof test.annotations }).annotations ?? [])];
    const skipReason = annotations.find(a => a.type === "skip" || a.type === "fixme")?.description;

    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const minimal: TestResult = {
        id: evidenceId(meta.id, test.repeatEachIndex),
        title: test.title,
        covers: meta.covers,
        status: statusOf(result.status, [], meta.knownLimitation),
        startedAt: result.startTime.toISOString(),
        durationMs: result.duration,
        error,
        clients: [],
        checks: [],
        files: [],
        notes: skipReason ? [skipReason] : []
      };
      fs.writeFileSync(file, JSON.stringify(minimal, null, 2));
      return;
    }
    const written: TestResult = JSON.parse(fs.readFileSync(file, "utf8"));
    let changed = false;
    if (result.status !== "passed" && result.status !== "skipped" && written.status !== "NG" && written.status !== "known limitation") {
      written.status = "NG";
      changed = true;
    }
    if (result.status === "skipped" && written.status !== "skipped") {
      written.status = "skipped";
      if (skipReason) written.notes.push(skipReason);
      changed = true;
    }
    if (error && !written.error) {
      written.error = error;
      changed = true;
    }
    if (changed) fs.writeFileSync(file, JSON.stringify(written, null, 2));
  }

  onEnd(_result: FullResult) {
    // Nothing ran (e.g. --list): no report
    if (!this.ended) return;
    try {
      const report = buildReport(runDir());
      console.log(`report: ${report}`);
    } catch (e) {
      console.error(`report not built: ${(e as Error).message}`);
    }
  }

  printsToStdio() {
    return false;
  }
}
