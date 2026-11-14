import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Placeholder until the first suite (t1-smoke) exists: keeps the test list non-empty
// and checks that the harness folders are in place.
test("the harness folders exist", () => {
  const root = path.join(import.meta.dirname, "..");
  for (const folder of ["clients", "probes", "motions", "suites", "report", "assets"]) {
    expect(fs.statSync(path.join(root, folder)).isDirectory(), folder).toBe(true);
  }
});
