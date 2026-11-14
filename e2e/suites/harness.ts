// The `test` every suite uses: Playwright's, with an `evidence` fixture that gives the test its folder
// under evidence/<run-id>/ and, when the test ends, takes failure screenshots, closes the clients
// (saving their videos and console logs) and writes result.json.
// A test names itself and the checklist items it covers with annotations:
//   test("T1 smoke on Dialog", { annotation: [{ type: "id", description: "t1-smoke-dialog" },
//                                             { type: "covers", description: "B1 B2 B3 B5 B6" }] }, ...)
import { test as base, expect } from "@playwright/test";
import { Evidence, testMeta } from "../report/evidence";

export const test = base.extend<{ evidence: Evidence }>({
  evidence: async ({}, use, info) => {
    const meta = testMeta(info.annotations, info.title);
    const evidence = new Evidence(meta.id, info.title, meta.covers);
    await use(evidence);
    await evidence.finish(info);
  }
});

export { expect };
