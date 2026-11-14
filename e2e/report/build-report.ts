// Builds evidence/<run-id>/report.html from run.json and every <test-id>/result.json of the run:
// each test with its status (OK, NG, skipped, known limitation, invalid, not applicable), the checklist
// items it covers, its checks with their numbers, screenshot thumbnails, and links to videos, logs and data.
// The header names the hubs branch and commit the run tested and which client API that build has.
// One HTML file with its styles inline; the evidence it links to sits next to it in the run folder.
// The reporter (report/reporter.ts) calls it after every run; by hand:
//   npx tsx report/build-report.ts [run-id]      # the newest run when no id is given
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";
import type { Check, FileRef, Status, TestResult } from "./evidence";

/** Names of the checklist items (chutvrc_verification_2026-11) and plan items the tests cite */
const ITEMS: Record<string, string> = {
  B1: "Entry and audio",
  B2: "Mute",
  B3: "Avatar sync",
  B4: "Grabbing media",
  B5: "Recording",
  B6: "Room move",
  L1: "Switching media server, state kept",
  L2: "LiveKit basics",
  L3: "LiveKit room move",
  L4: "Back to Dialog",
  F1: "Video",
  F2: "Public speaking",
  F3: "PDF and laser pointer",
  F4: "Block and kick",
  F5: "RTC panel",
  F6: "Admin pages",
  F7: "Spoke",
  F8: "External URLs",
  F9: "N-impro and libpeer",
  F10: "Memory",
  V1: "Full-body avatars",
  V2: "Re-entering",
  V3: "Own latency",
  V4: "Avatar change",
  V5: "NPC",
  V6: "New body solver",
  V7: "Interpolation",
  V8: "Bandwidth",
  V9: "Old build compatibility",
  A1a: "Reconnect after a Dialog host change",
  A1c: "Record Dialog messages only while recording",
  A1d: "Dispose the old LiveKit room before reconnecting",
  A1e: "Replace the microphone track instead of publishing it twice",
  A1f: "Relay queue only in public speaking receivers",
  A1g: "Force TCP option to the Dialog transport",
  A1i: "RTC panel follows the active adapter",
  A1j: "Dialog camera and screen producers",
  A1k: "No reconnect after an intentional LiveKit disconnect",
  A2: "SfuConfig",
  A5: "SfuSession and the connection contract",
  A6: "Clean-up of the transport layer",
  A7: "Transport fixes after review (media and recording carried over a switch)",
  B1a: "Re-entry: pose sync starts again",
  B8: "Pose format (isVR, tracked bits, animation state)",
  "mute-fix": "Mute toggle fix",
  "T6.8": "No request to a reticulum.io host",
  "T6.10": "No console errors outside the allow-list",
  "2.2": "Frame rate floor (plan 2.2)"
};

/** Plan 3.3: what only a real device can settle */
const REAL_DEVICE_ONLY = [
  "How the new body solver looks from inside a headset",
  "The Quest Browser's own WebXR and performance",
  "Safari on a real iPhone (media, WebRTC, autoplay and audio rules)",
  "Real microphones (echo cancellation, noise suppression on real speech) and real networks"
];

const STATUS_ORDER: Status[] = ["NG", "invalid", "known limitation", "OK", "not applicable", "skipped"];

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const href = (testId: string, file: string) => `${encodeURIComponent(testId)}/${file.split("/").map(encodeURIComponent).join("/")}`;
const statusClass = (s: Status) => `st-${s.replace(/\s+/g, "-").toLowerCase()}`;
const badge = (s: Status) => `<span class="badge ${statusClass(s)}">${esc(s)}</span>`;
const itemChip = (id: string) => `<span class="chip" title="${esc(ITEMS[id] ?? "")}">${esc(id)}</span>`;
const duration = (ms: number) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s` : `${Math.round(ms / 1000)} s`);

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** The client build the run tested: hubs branch, commit, and its API (report/evidence.ts hubsClientApi) */
function buildLine(run: any): string {
  const hubs = run?.repos?.hubs;
  if (!hubs) return "";
  if (hubs.error) return `<div class="build">hubs: <span class="muted">${esc(hubs.error)}</span></div>`;
  const api = run.hubsClientApi;
  const apiText = api
    ? api.kind === "session"
      ? `client API: APP.sfu is a session (data channel bus${api.poseStore ? ", pose store APP.avatarPoses" : ", no pose store"})`
      : "client API: APP.sfu is the media server adapter (no data channel bus, no pose store); checks that need them are not applicable"
    : "";
  return `<div class="build">hubs <b>${esc(hubs.branch)}</b> <code>${esc(hubs.commit?.slice(0, 10))}</code>${hubs.dirty ? ' <span class="chip warn">uncommitted changes</span>' : ""}${apiText ? ` · <span class="muted">${esc(apiText)}</span>` : ""}</div>`;
}

function runInfoSection(run: any): string {
  if (!run) return `<p class="muted">run.json is missing.</p>`;
  const repos = Object.entries(run.repos ?? {})
    .map(([name, r]: [string, any]) =>
      r.error
        ? `<tr><th>${esc(name)}</th><td colspan="2" class="muted">${esc(r.error)}</td></tr>`
        : `<tr><th>${esc(name)}</th><td><code>${esc(r.commit?.slice(0, 10))}</code>${r.dirty ? ' <span class="chip warn">uncommitted changes</span>' : ""}</td><td>${esc(r.branch)}</td></tr>`
    )
    .join("");
  const browsers = Object.entries(run.browsers ?? {})
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td colspan="2">${esc(v)}</td></tr>`)
    .join("");
  const lk = run.mediaServer?.liveKit;
  const media = lk
    ? `media server block: <b>${esc(run.mediaServer.block ?? "dialog")}</b>; LiveKit server setting: <b>${esc(lk.block)}</b>${lk.block === "local" ? ` (${esc(lk.url)})` : ""}` +
      (run.mediaServer.liveKitBeforeRun && run.mediaServer.liveKitBeforeRun !== lk.block ? ` (was ${esc(run.mediaServer.liveKitBeforeRun)} before the run)` : "") +
      `; server settings: ${esc(JSON.stringify(run.mediaServer.serverSettings ?? {}))}`
    : esc(JSON.stringify(run.mediaServer ?? {}));
  const m = run.machine ?? {};
  return `
  <div class="grid2">
    <table class="kv"><caption>Repositories</caption>${repos}</table>
    <table class="kv"><caption>Browsers</caption>${browsers}
      <tr><th>media server</th><td colspan="2">${media}</td></tr>
      <tr><th>LAN address</th><td colspan="2">${esc(run.lanAddress)}</td></tr>
      <tr><th>reticulum clock</th><td colspan="2">${run.reticulumClockBehindSeconds == null ? "not measured" : `${esc(run.reticulumClockBehindSeconds)} s behind this PC at the start (limit 60 s)`}</td></tr>
      <tr><th>machine</th><td colspan="2">${esc(`${m.cpu ?? ""}, ${m.cores ?? "?"} threads, ${m.memoryGb ?? "?"} GB, ${m.os ?? ""}`)}</td></tr>
    </table>
  </div>`;
}

function checksTable(checks: Check[]): string {
  if (!checks.length) return "";
  const rows = checks
    .map(
      c => `<tr>
        <td>${badge(c.status)}</td>
        <td>${esc(c.name)}</td>
        <td class="nowrap">${c.covers.map(itemChip).join(" ")}</td>
        <td>${esc(c.summary)}${c.data !== undefined ? `<details><summary>numbers</summary><pre>${esc(JSON.stringify(c.data, null, 2))}</pre></details>` : ""}</td>
      </tr>`
    )
    .join("");
  return `<table class="checks"><thead><tr><th>Status</th><th>Check</th><th>Covers</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function filesSection(t: TestResult): string {
  const sheets = t.files.filter(f => f.kind === "sheet");
  const shots = t.files.filter(f => f.kind === "screenshot");
  const videos = t.files.filter(f => f.kind === "video" || f.kind === "obs");
  const grids = t.files.filter(f => f.kind === "grid");
  const other = t.files.filter(f => !["screenshot", "video", "obs", "sheet", "grid"].includes(f.kind));
  // Contact sheets (T5) at full width, each folded open
  const sheetList = sheets
    .map(
      f => `<details class="sheet" open><summary>${esc(f.label)}</summary><a href="${href(t.id, f.file)}"><img loading="lazy" src="${href(t.id, f.file)}" alt="${esc(f.label)}"></a></details>`
    )
    .join("");
  // Who hears whom and who sees whom (T7): inline at their own size, side by side where they fit
  const gridList = grids.length
    ? `<div class="grids">${grids.map(f => `<a href="${href(t.id, f.file)}" title="${esc(f.label)}"><img loading="lazy" src="${href(t.id, f.file)}" alt="${esc(f.label)}"></a>`).join("")}</div>`
    : "";
  const thumbs = shots.length
    ? `<div class="thumbs">${shots
        .map(
          f => `<figure><a href="${href(t.id, f.file)}"><img loading="lazy" src="${href(t.id, f.file)}" alt="${esc(`${f.client}: ${f.label}`)}"></a>
            <figcaption><b>${esc(f.client ?? "")}</b> ${esc(f.label)}</figcaption></figure>`
        )
        .join("")}</div>`
    : "";
  const link = (f: FileRef) => `<li><a href="${href(t.id, f.file)}">${esc(f.file)}</a> <span class="muted">${esc(f.label)}</span></li>`;
  const videoList = videos.length
    ? `<details class="files"><summary>Videos (${videos.length})</summary><ul>${videos.map(link).join("")}</ul>
        <div class="videos">${videos.map(f => `<video controls preload="none" src="${href(t.id, f.file)}"></video>`).join("")}</div></details>`
    : "";
  const otherList = other.length ? `<details class="files"><summary>Data and logs (${other.length})</summary><ul>${other.map(link).join("")}</ul></details>` : "";
  return sheetList + gridList + thumbs + videoList + otherList;
}

/** T5 at a glance: per block, avatar and mode, the old and the new solver over all motions (the summary test's t5-verdicts.json) */
function ikSection(dir: string, tests: TestResult[]): string {
  // Summaries that ran in this run's block (the other block's are skipped and have no verdicts)
  const summaries = tests.filter(t => t.id.startsWith("t5-summary-") && fs.existsSync(path.join(dir, t.id, "t5-verdicts.json")));
  if (!summaries.length) return "";
  const arrow = (a: unknown, b: unknown) => `${a ?? "–"} → ${b ?? "–"}`;
  const blocks = summaries
    .map(t => {
      const verdicts = readJson<any[]>(path.join(dir, t.id, "t5-verdicts.json")) ?? [];
      const rows = verdicts
        .map(
          v => `<tr><td>${esc(v.avatar)}</td><td>${esc(v.mode)}</td><td><a href="#${esc(v.test)}">${badge(v.status)}</a></td>
            <td>${esc(arrow(v.old.handErrMean, v.new.handErrMean))}</td><td>${esc(arrow(v.old.handErrMax, v.new.handErrMax))}</td>
            <td>${esc(arrow(v.old.elbowWrong, v.new.elbowWrong))}</td><td>${esc(arrow(v.old.kneeWrong, v.new.kneeWrong))}</td>
            <td>${esc(arrow(v.old.footMin, v.new.footMin))}</td><td>${esc(arrow(v.old.jumpPosMax, v.new.jumpPosMax))}</td><td>${esc(arrow(v.old.nanFrames, v.new.nanFrames))}</td></tr>`
        )
        .join("");
      const sheets = t.files.filter(f => f.kind === "sheet").map(f => `<a href="${href(t.id, f.file)}">${esc(f.label)}</a>`).join(" · ");
      const videos = t.files.filter(f => f.kind === "video").map(f => `<a href="${href(t.id, f.file)}">${esc(f.file)}</a>`).join(" · ");
      const csv = t.files.filter(f => f.file.endsWith(".csv")).map(f => `<a href="${href(t.id, f.file)}">${esc(f.file)}</a>`).join(" · ");
      return `<h3><a href="#${esc(t.id)}">${esc(t.title)}</a> ${badge(t.status)}</h3>
        <table class="checks"><thead><tr><th>Avatar</th><th>Mode</th><th>Test</th><th>Hand error mean, cm (old → new)</th><th>Hand error max, cm</th><th>Wrong-side elbow frames</th><th>Wrong-side knee frames</th><th>Lowest sole, cm</th><th>Largest joint jump, cm</th><th>NaN frames</th></tr></thead><tbody>${rows}</tbody></table>
        <p>Contact sheets: ${sheets || '<span class="muted">none</span>'}<br>Summary videos: ${videos || '<span class="muted">none</span>'}<br>Numbers: ${csv || '<span class="muted">none</span>'}</p>`;
    })
    .join("");
  return `<h2>Inverse kinematics, old solver against new (T5)</h2><div class="panel">${blocks}
    <p class="muted">Each test of an avatar and mode has its own per-frame numbers (ik-metrics.csv), per-motion numbers (ik-summary.csv), and a side-by-side video per motion; hand error exists only in VR.</p></div>`;
}

function testCard(t: TestResult): string {
  const clients = t.clients.length
    ? `<p class="muted">Clients: ${t.clients.map(c => `${esc(c.name)} (${esc(c.profile)}, ${esc(c.identity)}, pilot ${c.pilotHz} Hz)`).join(", ")}</p>`
    : "";
  const notes = t.notes.length ? `<ul class="notes">${t.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>` : "";
  const error = t.error ? `<pre class="error">${esc(t.error)}</pre>` : "";
  return `
  <section class="test ${statusClass(t.status)}" id="${esc(t.id)}">
    <header>
      ${badge(t.status)}
      <h3>${esc(t.title)}</h3>
      <span class="muted">${esc(t.id)} · ${duration(t.durationMs)} · ${esc(t.startedAt.slice(0, 19).replace("T", " "))} UTC</span>
      <span class="covers">${t.covers.map(itemChip).join(" ")}</span>
    </header>
    ${clients}${checksTable(t.checks)}${error}${notes}${filesSection(t)}
  </section>`;
}

function coverageTable(tests: TestResult[]): string {
  const byItem = new Map<string, { test: string; check?: string; status: Status }[]>();
  for (const t of tests) {
    const fromChecks = new Set<string>();
    for (const c of t.checks)
      for (const item of c.covers) {
        fromChecks.add(item);
        if (!byItem.has(item)) byItem.set(item, []);
        byItem.get(item)!.push({ test: t.id, check: c.name, status: c.status });
      }
    for (const item of t.covers)
      if (!fromChecks.has(item)) {
        if (!byItem.has(item)) byItem.set(item, []);
        byItem.get(item)!.push({ test: t.id, status: t.status });
      }
  }
  if (!byItem.size) return "";
  const rows = [...byItem.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }))
    .map(
      ([item, refs]) => `<tr><td class="nowrap">${itemChip(item)}</td><td>${esc(ITEMS[item] ?? "")}</td><td>${refs
        .map(r => `${badge(r.status)} <a href="#${esc(r.test)}">${esc(r.test)}</a>${r.check ? ` <span class="muted">${esc(r.check)}</span>` : ""}`)
        .join("<br>")}</td></tr>`
    )
    .join("");
  return `<table class="checks"><thead><tr><th>Item</th><th>What</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STYLE = `
:root { color-scheme: light dark;
  --bg: #f6f7f9; --card: #ffffff; --text: #1d2330; --muted: #5d6677; --line: #dde1e8; --code: #eef0f4;
  --ok: #1e7f4f; --ok-bg: #e3f4ea; --ng: #b42335; --ng-bg: #fbe5e8; --skip: #5d6677; --skip-bg: #eceef2;
  --known: #8a5a00; --known-bg: #fbefd5; --invalid: #6b3fa0; --invalid-bg: #efe6f8; --link: #2457c5;
  --na: #3d6670; --na-bg: #e4eff1; }
@media (prefers-color-scheme: dark) { :root {
  --bg: #12151b; --card: #1b2029; --text: #e3e7ee; --muted: #9aa3b2; --line: #2d3442; --code: #252c38;
  --ok: #5fd39a; --ok-bg: #173527; --ng: #ff8593; --ng-bg: #3d1a21; --skip: #a3abb8; --skip-bg: #262c36;
  --known: #f2c062; --known-bg: #3a2d12; --invalid: #c9a3f2; --invalid-bg: #2e2340; --link: #8ab4ff;
  --na: #8fc3cf; --na-bg: #1c2f34; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 12px; } h3 { font-size: 15px; margin: 0; }
a { color: var(--link); } code, pre { background: var(--code); border-radius: 4px; }
code { padding: 1px 4px; } pre { padding: 8px; overflow: auto; font-size: 12px; max-height: 320px; }
.muted { color: var(--muted); } .nowrap { white-space: nowrap; }
.summary { display: flex; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 600; font-size: 12px; white-space: nowrap; }
.badge.st-ok { color: var(--ok); background: var(--ok-bg); } .badge.st-ng { color: var(--ng); background: var(--ng-bg); }
.badge.st-skipped { color: var(--skip); background: var(--skip-bg); } .badge.st-known-limitation { color: var(--known); background: var(--known-bg); }
.badge.st-invalid { color: var(--invalid); background: var(--invalid-bg); }
.badge.st-not-applicable { color: var(--na); background: var(--na-bg); border: 1px dashed var(--na); }
.summary .badge { font-size: 13px; padding: 4px 12px; }
.chip { display: inline-block; padding: 0 6px; border: 1px solid var(--line); border-radius: 4px; font-size: 12px; }
.chip.warn { border-color: var(--known); color: var(--known); }
.test, .panel { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 12px 0; }
.test { border-left-width: 4px; } .test.st-ok { border-left-color: var(--ok); } .test.st-ng { border-left-color: var(--ng); }
.test.st-skipped { border-left-color: var(--skip); } .test.st-known-limitation { border-left-color: var(--known); } .test.st-invalid { border-left-color: var(--invalid); }
.test.st-not-applicable { border-left-color: var(--na); border-left-style: dashed; }
.build { margin: 6px 0 0; font-size: 15px; }
.test header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 8px; background: none; padding: 0; color: inherit; }
.test header .covers { margin-left: auto; }
table { border-collapse: collapse; width: 100%; } caption { text-align: left; font-weight: 600; padding: 4px 0; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.kv th { width: 110px; color: var(--muted); font-weight: 500; }
.checks thead th { color: var(--muted); font-weight: 500; font-size: 12px; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
.thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin: 12px 0; }
.thumbs figure { margin: 0; } .thumbs img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); display: block; }
.thumbs figcaption { font-size: 12px; color: var(--muted); margin-top: 2px; }
.videos { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; margin-top: 8px; }
.videos video { width: 100%; border-radius: 4px; background: #000; }
details.files { margin-top: 8px; } details summary { cursor: pointer; color: var(--muted); }
.grids { display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0; } .grids img { max-width: 100%; border: 1px solid var(--line); border-radius: 4px; display: block; }
details.sheet { margin: 12px 0; } details.sheet img { width: 100%; display: block; border: 1px solid var(--line); border-radius: 4px; margin-top: 6px; }
.error { color: var(--ng); background: var(--ng-bg); white-space: pre-wrap; }
.notes { margin: 8px 0; padding-left: 20px; } .notes li { color: var(--muted); }
`;

export function buildReport(dir: string): string {
  const run = readJson<any>(path.join(dir, "run.json"));
  const tests = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => readJson<TestResult>(path.join(dir, d.name, "result.json")))
    .filter((t): t is TestResult => !!t)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const counts = STATUS_ORDER.map(s => [s, tests.filter(t => t.status === s).length] as const).filter(([, n]) => n > 0);
  const runId = path.basename(dir);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Client test report</title><style>${STYLE}</style></head>
<body><main>
  <h1>chutvrc simulated-client tests</h1>
  ${buildLine(run)}
  <div class="muted">Run <code>${esc(runId)}</code>${run?.startedAt ? ` · started ${esc(run.startedAt.slice(0, 19).replace("T", " "))} UTC` : ""} · ${tests.length} test${tests.length === 1 ? "" : "s"}</div>
  <div class="summary">${counts.map(([s, n]) => `<span class="badge ${statusClass(s)}">${n} ${esc(s)}</span>`).join("")}</div>
  ${ikSection(dir, tests)}
  <h2>Run</h2><div class="panel">${runInfoSection(run)}</div>
  <h2>Tests</h2>${tests.map(testCard).join("") || '<p class="muted">No test results in this run.</p>'}
  <h2>Checklist coverage</h2><div class="panel">${coverageTable(tests) || '<p class="muted">Nothing covered yet.</p>'}</div>
  <h2>Only a real device can settle</h2>
  <div class="panel"><ul>${REAL_DEVICE_ONLY.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>
</main></body></html>
`;
  const file = path.join(dir, "report.html");
  fs.writeFileSync(file, html);
  return file;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("report/build-report.ts")) {
  const id =
    process.argv[2] ??
    fs
      .readdirSync(EVIDENCE_DIR)
      .filter(d => fs.existsSync(path.join(EVIDENCE_DIR, d, "run.json")))
      .sort()
      .pop();
  if (!id) throw new Error("no run with a run.json under evidence/");
  console.log(buildReport(path.join(EVIDENCE_DIR, id)));
}
