// T0 of plan 4, written into a run's evidence folder in the same form as the suites' tests, so the run's
// report lists them:
//   t0.1         the gate: the containers running, then lint, unit tests and build of the client and of the
//                admin pages, each part run on its own in its container (one failing part does not hide the
//                next, as the chained commands of plan 1.2 do)
//   t0.2 to t0.4 the offline tests in hubs test/unit/avatar (pose codec, interpolation buffer, body solver;
//                the plan names them by its stages B8, B6 and B5; here B8 and the checklist items V7 and V6),
//                one check per test, from the client's test:unit run of t0.1
// The output of every part is saved next to its result.
//   npx tsx report/preflight.ts [run-id]      # a new run id when none is given
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { request } from "@playwright/test";
import { BASE_URL, COMPOSE_ROOT } from "../lib/env";
import { runDir, runId, type Check, type FileRef, type Status, type TestResult } from "./evidence";

type Part = { service: "hubs-client" | "hubs-admin"; script: string; label: string };

const PARTS: Part[] = [
  { service: "hubs-client", script: "lint:js", label: "client lint:js" },
  { service: "hubs-client", script: "lint:html", label: "client lint:html" },
  { service: "hubs-client", script: "test:unit", label: "client test:unit" },
  { service: "hubs-client", script: "build", label: "client build" },
  { service: "hubs-admin", script: "lint:js", label: "admin lint:js" },
  { service: "hubs-admin", script: "lint:html", label: "admin lint:html" },
  { service: "hubs-admin", script: "build", label: "admin build" }
];

/** Errors of the target's lint known since step 2 (BASELINE.md, "Lint"): 53 of the client's 54 already on develop */
const KNOWN_LINT_ERRORS: Record<string, number> = { "hubs-client": 54, "hubs-admin": 2 };

/** Which offline test of plan 4 each test file of test/unit/avatar belongs to */
const OFFLINE = [
  { id: "t0.2", file: "pose-codec", title: "T0.2 pose codec v1: round trip, sequence wrap, late packets, resync, v0 decoding", covers: ["B8"] },
  { id: "t0.3", file: "interpolation-buffer", title: "T0.3 interpolation buffer behind a simulated network", covers: ["V7"] },
  { id: "t0.4", file: "solve-body", title: "T0.4 body solver on synthetic rigs", covers: ["V6"] }
];

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

function exec(args: string[], timeoutMs = 30 * 60_000) {
  const t0 = Date.now();
  const r = spawnSync("docker", args, { cwd: COMPOSE_ROOT, encoding: "utf8", maxBuffer: 256 * 2 ** 20, timeout: timeoutMs });
  const output = stripAnsi(`${r.stdout ?? ""}${r.stderr ?? ""}`)
    .split(/\r?\n/)
    .filter(l => !l.includes("the attribute `version` is obsolete"))
    .join("\n");
  return { code: r.status ?? -1, output, ms: Date.now() - t0, error: r.error?.message };
}

class Writer {
  readonly checks: Check[] = [];
  readonly files: FileRef[] = [];
  readonly notes: string[] = [];
  readonly dir: string;
  readonly t0 = Date.now();
  constructor(
    readonly id: string,
    readonly title: string,
    readonly covers: string[]
  ) {
    this.dir = path.join(runDir(), id);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  check(name: string, covers: string[], status: Status, summary: string, data?: unknown) {
    this.checks.push({ name, covers, status, summary, data, atMs: Date.now() - this.t0 });
  }
  log(name: string, text: string, label: string) {
    fs.writeFileSync(path.join(this.dir, name), text);
    this.files.push({ file: name, kind: "log", label });
  }
  finish(): TestResult {
    const status: Status = this.checks.some(c => c.status === "NG") ? "NG" : this.checks.some(c => c.status === "invalid") ? "invalid" : "OK";
    const result: TestResult = {
      id: this.id,
      title: this.title,
      covers: this.covers,
      status,
      startedAt: new Date(this.t0).toISOString(),
      durationMs: Date.now() - this.t0,
      clients: [],
      checks: this.checks,
      files: this.files,
      notes: this.notes
    };
    fs.writeFileSync(path.join(this.dir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  }
}

/** Every service of both compose files running; each health check passing, or the reason it does not */
async function containersCheck(w: Writer) {
  const ps = exec(["compose", "-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml", "ps", "--all", "--format", "json"], 60_000);
  w.log("containers.log", ps.output, "docker compose ps (both compose files)");
  const rows = ps.output
    .split("\n")
    .filter(l => l.trim().startsWith("{"))
    .map(l => JSON.parse(l) as { Service: string; State: string; Health: string; Status: string });
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  const meta = await api
    .get(`${BASE_URL}/api/v1/meta`)
    .then(r => r.status())
    .catch(() => 0);
  await api.dispose();
  const notRunning = rows.filter(r => r.State !== "running");
  const unhealthy = rows.filter(r => r.Health && r.Health !== "healthy");
  // reticulum's dev image probes http://localhost:4000, which is ::1 in its container, where the dev server does
  // not listen; the API answering on hubs.local:4000 is what the tests need
  const reticulumOnlyByProbe = unhealthy.length === 1 && unhealthy[0].Service === "reticulum" && meta === 200;
  if (reticulumOnlyByProbe) {
    const health = exec(["inspect", "--format", "{{json .State.Health}}", "chutvrc-hubs-compose-reticulum-1"], 30_000).output;
    const last = /"Output":"([^"]*)"\}\]\}\s*$/.exec(health.trim())?.[1]?.replace(/\\n/g, " ").trim();
    w.notes.push(
      `reticulum's image health check fails${last ? ` ("${last}")` : ""}: it probes localhost:4000, which resolves to ::1 in the container, where the dev server does not listen; ${BASE_URL}/api/v1/meta answers ${meta}`
    );
  }
  const ok = rows.length > 0 && notRunning.length === 0 && (unhealthy.length === 0 || reticulumOnlyByProbe);
  w.check(
    "Containers running and healthy",
    ["checklist-1"],
    ok ? "OK" : "NG",
    `${rows.length - notRunning.length} of ${rows.length} services running` +
      (notRunning.length ? `; not running: ${notRunning.map(r => `${r.Service} (${r.State})`).join(", ")}` : "") +
      (unhealthy.length
        ? `; health check failing: ${unhealthy.map(r => r.Service).join(", ")}${reticulumOnlyByProbe ? ` (its probe uses ::1; the API answers ${meta})` : ""}`
        : "; every health check passing") +
      `; reticulum API ${meta}`,
    rows.map(r => ({ service: r.Service, state: r.State, health: r.Health || "(none)", status: r.Status }))
  );
}

function lintSummary(output: string) {
  const m = /✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/.exec(output);
  const rules: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const r = /^\s+\d+:\d+\s+(error|warning)\s+.*\s{2,}(\S+)\s*$/.exec(line);
    if (r) rules[r[2]] = (rules[r[2]] ?? 0) + 1;
  }
  return { problems: m ? +m[1] : 0, errors: m ? +m[2] : 0, warnings: m ? +m[3] : 0, rules };
}

function buildSummary(output: string) {
  const compiled = /compiled (successfully|with (\d+) warnings?)/.exec(output);
  return {
    compiled: compiled ? compiled[0] : null,
    warnings: compiled?.[2] ? +compiled[2] : 0,
    errors: (output.match(/^ERROR\b/gm) ?? []).length,
    exportNotFound: (output.match(/was not found in/g) ?? []).length
  };
}

type UnitTest = { file: string; title: string; ok: boolean; info: string[]; ms: number | null };

/** ava's default reporter: a check mark, "avatar > pose-codec > title (806ms)", indented info lines under it */
function unitTests(output: string): { tests: UnitTest[]; passed: number; failed: number; known: number } {
  const tests: UnitTest[] = [];
  for (const line of output.split("\n")) {
    const t = /^\s*(✔|✘|✖)\s+(?:\[[^\]]+\]\s+)?(.+?)(?:\s+\((\d+(?:\.\d+)?)(ms|s)\))?\s*$/.exec(line);
    if (t) {
      const parts = t[2].split(" › ");
      tests.push({
        file: parts.length > 1 ? parts[parts.length - 2] : "",
        title: parts[parts.length - 1],
        ok: t[1] === "✔",
        info: [],
        ms: t[3] ? Math.round(+t[3] * (t[4] === "s" ? 1000 : 1)) : null
      });
      continue;
    }
    const info = /^\s+ℹ\s+(.*)$/.exec(line);
    if (info && tests.length) tests[tests.length - 1].info.push(info[1]);
  }
  const n = (re: RegExp) => +(re.exec(output)?.[1] ?? 0);
  return { tests, passed: n(/(\d+) tests? passed/), failed: n(/(\d+) tests? failed/), known: n(/(\d+) known failures?/) };
}

export async function preflight() {
  const w = new Writer("t0.1", "T0.1 preflight: containers, lint, unit tests and build of the client and the admin pages", ["checklist-1", "checklist-2"]);
  await containersCheck(w);
  let unitOutput = "";
  for (const part of PARTS) {
    console.log(`T0.1: ${part.label} ...`);
    const args = ["compose", "exec", "-T", part.service, "npm", "run", part.script];
    let r = exec(args);
    const logName = `${part.label.replace(/[^A-Za-z0-9]+/g, "-")}.log`;
    // The admin build failed once with ENOENT on an emitted image and passed on the second try (TRIALS.md, T0.1 gate)
    if (r.code !== 0 && part.script === "build" && /ENOENT/.test(r.output)) {
      w.log(logName.replace(".log", "-first-try.log"), r.output, `${part.label}, first try (ENOENT)`);
      w.notes.push(`${part.label}: the first try failed with ENOENT (a race of the production build with the running dev server seen in step 2, TRIALS.md); run once more`);
      r = exec(args);
    }
    w.log(logName, r.output, `npm run ${part.script} in ${part.service} (exit ${r.code}, ${Math.round(r.ms / 1000)} s)`);
    const took = `${Math.round(r.ms / 1000)} s`;
    if (part.script === "lint:js") {
      const s = lintSummary(r.output);
      const known = KNOWN_LINT_ERRORS[part.service];
      const sameAsKnown = s.errors === known && (part.service !== "hubs-client" || s.rules["no-dupe-keys"] === 1);
      w.check(
        part.label,
        ["checklist-2"],
        r.code === 0 ? "OK" : "NG",
        r.code === 0
          ? `no errors (${took})`
          : `${s.errors} errors, ${s.warnings} warnings (${Object.entries(s.rules)
              .map(([k, v]) => `${k} ${v}`)
              .join(", ")})` + (sameAsKnown ? `; the same as in step 2 and step 5 (BASELINE.md "Lint")` : `; step 2 and step 5 had ${known}`),
        { exit: r.code, ...s }
      );
    } else if (part.script === "lint:html") {
      w.check(
        part.label,
        ["checklist-2"],
        r.code === 0 ? "OK" : "NG",
        r.code === 0 ? `passes (${took})` : `exit ${r.code}: ${r.output.trim().split("\n").slice(-3).join(" / ")}`,
        { exit: r.code }
      );
    } else if (part.script === "test:unit") {
      unitOutput = r.output;
      const u = unitTests(r.output);
      w.check(
        part.label,
        ["checklist-2"],
        r.code === 0 && u.failed === 0 ? "OK" : "NG",
        `${u.passed} passed, ${u.failed} failed, ${u.known} known failure${u.known === 1 ? "" : "s"} (${took})`,
        { exit: r.code, passed: u.passed, failed: u.failed, known: u.known }
      );
    } else {
      const b = buildSummary(r.output);
      const ok = r.code === 0 && b.errors === 0 && b.exportNotFound === 0;
      w.check(
        part.label,
        ["checklist-2"],
        ok ? "OK" : "NG",
        `${r.code === 0 ? "passes" : `exit ${r.code}`}: ${b.compiled ?? "no webpack summary"}; ${b.errors} ERROR, ${b.exportNotFound} "export ... was not found" (${took})`,
        { exit: r.code, ...b }
      );
    }
  }
  const gate = w.finish();
  console.log(`T0.1 ${gate.status}`);

  const u = unitTests(unitOutput);
  for (const o of OFFLINE) {
    const ow = new Writer(o.id, o.title, o.covers);
    ow.log("test-unit.log", unitOutput, "the client's npm run test:unit (all offline tests)");
    const mine = u.tests.filter(t => t.file === o.file);
    if (!mine.length) ow.check("Tests of the file", o.covers, "NG", `no test of test/unit/avatar/${o.file}.test.js in the output`);
    for (const t of mine) {
      const knownFailure = /^known failure/i.test(t.title);
      const status: Status = !t.ok ? "NG" : knownFailure ? "known limitation" : "OK";
      ow.check(
        t.title,
        o.covers,
        status,
        (knownFailure ? "expected to fail (ava test.failing), and it does; BASELINE.md #22. " : "") +
          (t.info.length ? t.info.slice(0, 3).join("; ") + (t.info.length > 3 ? `; ${t.info.length - 3} more lines in test-unit.log` : "") : t.ok ? "passes" : "fails"),
        { ms: t.ms, info: t.info }
      );
    }
    const r = ow.finish();
    console.log(`${o.id} ${r.status} (${mine.length} tests)`);
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("report/preflight.ts")) {
  if (process.argv[2]) process.env.E2E_RUN_ID = process.argv[2];
  console.log(`run ${runId()}: ${runDir()}`);
  await preflight();
}
