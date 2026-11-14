// T6.8 and T6.10 over a whole run (plan 4): every client of every test leaves its console log and the hosts
// it sent requests to in the test's folder (clients/launch.ts saveRecords). After the run this reads them
// all and writes two results of their own, t6.8-whole-run and t6.10-whole-run:
//   T6.8   no request of any client went to a reticulum.io host;
//   T6.10  no console error, uncaught exception or failed request outside the reviewed allow-list
//          (suites/console-allowlist.ts). Allowances a single test makes for a known failure it is about are
//          not applied here: such entries show up, with the tests they came from.
// The reporter (report/reporter.ts) calls it before building report.html; by hand:
//   npx tsx report/run-scans.ts [run-id]
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";
import { CONSOLE_ALLOW_LIST } from "../suites/console-allowlist";
import type { Check, FileRef, TestResult } from "./evidence";

const SCAN_IDS = ["t6.8-whole-run", "t6.10-whole-run"];
const ERROR_TYPES = new Set(["error", "pageerror", "requestfailed"]);
const KNOWN_TYPES = "log|debug|info|error|warning|pageerror|requestfailed|request|trace|dir|table|assert|count|timeEnd|startGroup|startGroupCollapsed|endGroup|clear|profile|profileEnd";
const ENTRY = new RegExp(`^\\s*(\\d+\\.\\d{3}) (${KNOWN_TYPES})\\s+(.*)$`);

type Entry = { t: number; type: string; text: string; url?: string };

/** Parses a console log written by clients/launch.ts formatLog: one entry per line, texts may run over several */
export function parseConsoleLog(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(ENTRY);
    if (m) entries.push({ t: Number(m[1]), type: m[2], text: m[3] });
    else if (entries.length && line) entries[entries.length - 1].text += `\n${line}`;
  }
  for (const e of entries) {
    const u = e.text.match(/ {2}<([^>\n]*)>$/);
    if (u) {
      e.url = u[1];
      e.text = e.text.slice(0, u.index);
    }
  }
  return entries;
}

type ClientRecords = { test: string; client: string; hosts: Record<string, number> | null; entries: Entry[] | null };

function readRecords(dir: string): { records: ClientRecords[]; tests: string[]; withoutRecords: string[] } {
  const records: ClientRecords[] = [];
  const tests: string[] = [];
  const withoutRecords: string[] = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || SCAN_IDS.includes(d.name) || !fs.existsSync(path.join(dir, d.name, "result.json"))) continue;
    const files = fs.readdirSync(path.join(dir, d.name));
    const clients = new Set(files.filter(f => f.endsWith(".console.log")).map(f => f.slice(0, -".console.log".length)));
    for (const f of files.filter(f => f.endsWith(".hosts.json"))) clients.add(f.slice(0, -".hosts.json".length));
    if (!clients.size) continue;
    tests.push(d.name);
    let hostsSeen = false;
    for (const client of clients) {
      const hostsFile = path.join(dir, d.name, `${client}.hosts.json`);
      const logFile = path.join(dir, d.name, `${client}.console.log`);
      const hosts = fs.existsSync(hostsFile) ? JSON.parse(fs.readFileSync(hostsFile, "utf8")) : null;
      if (hosts) hostsSeen = true;
      records.push({ test: d.name, client, hosts, entries: fs.existsSync(logFile) ? parseConsoleLog(fs.readFileSync(logFile, "utf8")) : null });
    }
    if (!hostsSeen) withoutRecords.push(d.name);
  }
  return { records, tests, withoutRecords };
}

function writeResult(dir: string, result: TestResult, data: Record<string, unknown>) {
  const folder = path.join(dir, result.id);
  fs.mkdirSync(folder, { recursive: true });
  const files: FileRef[] = [];
  for (const [name, value] of Object.entries(data)) {
    fs.writeFileSync(path.join(folder, name), JSON.stringify(value, null, 2));
    files.push({ file: name, kind: "data", label: name.replace(/\.json$/, "").replace(/-/g, " ") });
  }
  fs.writeFileSync(path.join(folder, "result.json"), JSON.stringify({ ...result, files }, null, 2));
}

export function writeRunScans(dir: string) {
  const { records, tests, withoutRecords } = readRecords(dir);
  if (!tests.length) return;
  const now = new Date().toISOString();
  const base = { startedAt: now, durationMs: 0, clients: [], files: [] as FileRef[] };
  const note = withoutRecords.length
    ? [`${withoutRecords.length} test folder(s) have console logs but no host lists (written before the host lists were recorded): ${withoutRecords.join(", ")}; their requests are not scanned`]
    : [];

  // T6.8
  const reticulumIo: { test: string; client: string; host: string; requests: number }[] = [];
  let requests = 0;
  for (const r of records) {
    for (const [host, n] of Object.entries(r.hosts ?? {})) {
      requests += n;
      if (/(^|\.)reticulum\.io(:|$)/.test(host)) reticulumIo.push({ test: r.test, client: r.client, host, requests: n });
    }
  }
  const hostTotals: Record<string, number> = {};
  for (const r of records) for (const [h, n] of Object.entries(r.hosts ?? {})) hostTotals[h] = (hostTotals[h] ?? 0) + n;
  const t68: Check = {
    name: "No request of any client in the run went to a reticulum.io host",
    covers: ["T6.8"],
    status: reticulumIo.length ? "NG" : "OK",
    summary: `${requests} requests of ${records.filter(r => r.hosts).length} clients in ${tests.length - withoutRecords.length} tests to ${Object.keys(hostTotals).length} hosts; ${reticulumIo.length ? `to reticulum.io: ${reticulumIo.map(x => `${x.test} ${x.client} ${x.host} x${x.requests}`).join(", ")}` : "none to a reticulum.io host"}`,
    data: { hosts: hostTotals, reticulumIo },
    atMs: 0
  };
  writeResult(
    dir,
    { id: "t6.8-whole-run", title: "T6.8 every request of every client in the run (whole-run scan)", covers: ["T6.8", "upstream-intake"], status: t68.status, checks: [t68], notes: note, ...base },
    { "hosts.json": hostTotals, "reticulum-io.json": reticulumIo }
  );

  // T6.10
  const unexpected: Record<string, { count: number; type: string; text: string; where: Record<string, number> }> = {};
  const allowed: Record<string, number> = {};
  let errors = 0;
  for (const r of records) {
    for (const e of r.entries ?? []) {
      if (!ERROR_TYPES.has(e.type)) continue;
      errors++;
      const subject = `${e.text} ${e.url ?? ""}`;
      const rule = CONSOLE_ALLOW_LIST.find(a => (!a.types || a.types.includes(e.type)) && a.pattern.test(subject));
      if (rule) {
        allowed[rule.reason] = (allowed[rule.reason] ?? 0) + 1;
        continue;
      }
      const key = `${e.type}: ${e.text.split("\n")[0].slice(0, 200)}`;
      const u = (unexpected[key] ??= { count: 0, type: e.type, text: e.text.split("\n")[0].slice(0, 400) + (e.url ? ` <${e.url}>` : ""), where: {} });
      u.count++;
      u.where[`${r.test} ${r.client}`] = (u.where[`${r.test} ${r.client}`] ?? 0) + 1;
    }
  }
  const distinct = Object.values(unexpected).sort((a, b) => b.count - a.count);
  const t610: Check = {
    name: "No console error outside the allow-list in the whole run",
    covers: ["T6.10"],
    status: distinct.length ? "NG" : "OK",
    summary:
      `${errors} error entries of ${records.filter(r => r.entries).length} clients in ${tests.length} tests: ${errors - distinct.reduce((n, d) => n + d.count, 0)} allowed, ` +
      `${distinct.reduce((n, d) => n + d.count, 0)} outside the allow-list in ${distinct.length} distinct message(s)` +
      (distinct.length ? `; most frequent: ${distinct.slice(0, 5).map(d => `${d.text.slice(0, 120)} (x${d.count}, ${Object.keys(d.where).length} client(s))`).join(" | ")}` : ""),
    data: { unexpected: distinct.slice(0, 60), allowedByReason: allowed },
    atMs: 0
  };
  writeResult(
    dir,
    { id: "t6.10-whole-run", title: "T6.10 console errors of every client over the whole run (whole-run scan)", covers: ["T6.10"], status: t610.status, checks: [t610], notes: note, ...base },
    { "unexpected.json": distinct, "allowed-by-reason.json": allowed }
  );
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("report/run-scans.ts")) {
  const id =
    process.argv[2] ??
    fs
      .readdirSync(EVIDENCE_DIR)
      .filter(d => fs.existsSync(path.join(EVIDENCE_DIR, d, "run.json")))
      .sort()
      .pop();
  if (!id) throw new Error("no run with a run.json under evidence/");
  writeRunScans(path.join(EVIDENCE_DIR, id));
  console.log(`wrote the whole-run scans of ${id}`);
}
