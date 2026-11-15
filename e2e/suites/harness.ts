// The `test` every suite uses: Playwright's, with an `evidence` fixture that gives the test its folder
// under evidence/<run-id>/ and, when the test ends, takes failure screenshots, closes the clients
// (saving their videos and console logs) and writes result.json.
// A test names itself and the checklist items it covers with annotations:
//   test("T1 smoke on Dialog", { annotation: [{ type: "id", description: "t1-smoke-dialog" },
//                                             { type: "covers", description: "B1 B2 B3 B5 B6" }] }, ...)
import { test as base, expect } from "@playwright/test";
import { Evidence, evidenceId, testMeta } from "../report/evidence";
import { guardServerClock } from "./server-clock";

export const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({}, use, info) => {
    const meta = testMeta(info.annotations, info.title);
    // --repeat-each: each repetition gets its own folder (t2.1-dialog, t2.1-dialog-repeat2, ...)
    const id = evidenceId(meta.id, info.repeatEachIndex);
    const evidence = new Evidence(id, info.repeatEachIndex ? `${info.title} (repetition ${info.repeatEachIndex + 1})` : info.title, meta.covers);
    // A long run outlasts reticulum's clock (suites/server-clock.ts); measured every few minutes, restarted when behind
    const clock = await guardServerClock();
    if (clock) evidence.note(clock);
    await use(evidence);
    await evidence.finish(info);
  }
});

export { expect };
