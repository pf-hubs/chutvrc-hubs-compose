// Builds the consolidated report of the full run (plan step 9): <EVIDENCE_DIR>/final/index.html, from one run
// per media server block (each with its own report.html), BASELINE.md's findings and report/summary-data.ts.
//   - the commits of the five repositories, dates, browser versions and the PC's load during each run
//   - a matrix test x block with the status and the key number of each test, linked to the test in its block's report
//   - the manual checklist (B1 to N5): the tests standing for each item and their combined status
//   - the findings of BASELINE.md: where the final run showed each, its verdict, the evidence
//   - a gallery of screenshots and videos, copied into final/media/ so the folder stands on its own
//   - what only a real device can settle
// One HTML file with its styles inline; links to the block reports are relative (../<run-id>/report.html).
//   npx tsx report/build-summary.ts [dialog=<run-id>] [livekit-local=<run-id>] [livekit-cloud=<run-id>] [--markdown]
// The run ids default to final-dialog, final-livekit-local and final-livekit-cloud.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EVIDENCE_DIR } from "../lib/env";
import { ffmpegPath } from "../lib/stack";
import type { Status, TestResult } from "./evidence";
import { BLOCKS, CELL_NOTES, CHECKLIST, FINDINGS, GALLERY, LOAD_NOTES, MANUAL_CELLS, NEW_OBSERVATIONS, NOT_RUN, OPEN_FROM_THIS_RUN, REAL_DEVICE, RUN_NOTES, SKIP_REASONS, type BlockName, type Verdict } from "./summary-data";

type Run = { block: BlockName; id: string; dir: string; info: any; results: TestResult[] };
/**
 * "ran": the test is written for this block (whatever its status); "other": written for the other media server, or
 * run once in another block; "missing": no result in the run; "manual": stopped before it wrote its result, the
 * status taken from its saved files (MANUAL_CELLS)
 */
type Cell = { kind: "ran" | "other" | "missing" | "manual"; status: Status; result?: TestResult; run: Run; why?: string; href?: string };
type Row = { key: string; title: string; group: string; cells: Record<BlockName, Cell> };

const OUT = path.join(EVIDENCE_DIR, "final");
const MEDIA = path.join(OUT, "media");

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** At most n characters, cut at a word where one is near */
const short = (s: string, n: number) => {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > n * 0.7 ? cut.slice(0, space) : cut).replace(/[\s,;:(]+$/, "")}…`;
};
const statusClass = (s: string) => `st-${s.replace(/\s+/g, "-").toLowerCase()}`;
const badge = (s: string, label = s) => `<span class="badge ${statusClass(s)}">${esc(label)}</span>`;
const reportLink = (run: Run, testId: string) => `../${encodeURIComponent(run.id)}/report.html#${encodeURIComponent(testId)}`;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function loadRuns(): Run[] {
  const given = Object.fromEntries(process.argv.slice(2).map(a => a.split("=") as [string, string]));
  return BLOCKS.map(({ block }) => {
    const id = given[block] ?? `final-${block}`;
    const dir = path.join(EVIDENCE_DIR, id);
    const results = fs.existsSync(dir)
      ? fs
          .readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => readJson<TestResult>(path.join(dir, d.name, "result.json")))
          .filter((r): r is TestResult => !!r)
      : [];
    return { block, id, dir, info: readJson(path.join(dir, "run.json")), results };
  });
}

/** Tests without a media server in their id that run once, in the Dialog block (suites/t6-features.spec.ts) */
const DIALOG_ONLY = ["t6.1", "t6.6", "t6.7"];

/** A result's test key (its id without the block) and whether it is written for this run's block */
function classify(r: TestResult, block: BlockName): { key: string; mine: boolean; why?: string } {
  if (DIALOG_ONLY.includes(r.id)) return { key: r.id, mine: block === "dialog", why: "runs once, in the Dialog block" };
  const move = /^(t2\.6-(dialog|livekit)-to-(dialog|livekit))(?:-(.+))?$/.exec(r.id);
  if (move) {
    const forDialog = move[3] === "dialog";
    return { key: move[1], mine: forDialog === (block === "dialog"), why: forDialog ? "a Dialog test" : "a LiveKit test" };
  }
  if (block !== "dialog" && r.id.endsWith(`-${block}`)) return { key: r.id.slice(0, -block.length - 1), mine: true };
  if (r.id.endsWith("-dialog")) return { key: r.id.slice(0, -"-dialog".length), mine: block === "dialog", why: "a Dialog test" };
  if (r.id.endsWith("-livekit")) return { key: r.id.slice(0, -"-livekit".length), mine: false, why: "a LiveKit test" };
  const onceElsewhere = r.status === "skipped" && r.notes.some(n => /runs once, in the Dialog block/.test(n));
  return { key: r.id, mine: !onceElsewhere, why: onceElsewhere ? "runs once, in the Dialog block" : undefined };
}

const cleanTitle = (t: string) =>
  t
    .replace(/ with 4 DESK and (no|\d) BOT/, "")
    .replace(/,? on (Dialog|LiveKit, local server|LiveKit Cloud|LiveKit)( \(probe\))?$/, "$2")
    .replace(/ \((LiveKit, local server|LiveKit Cloud|LiveKit)\)$/, "")
    .replace(/ \(known limitation\)$/, "");

const GROUPS: [RegExp, string][] = [
  [/^t0\./, "T0 Preflight and offline tests"],
  [/^t1/, "T1 Smoke"],
  [/^t2\./, "T2 Transport and media"],
  [/^t3\./, "T3 Public speaking"],
  [/^t4\./, "T4 Avatar sync"],
  [/^t5-/, "T5 Inverse kinematics"],
  [/^t6\./, "T6 Existing features and the upstream intake"],
  [/^t7\./, "T7 Device profiles"]
];

function buildRows(runs: Run[]): Row[] {
  const rows = new Map<string, Row>();
  for (const run of runs)
    for (const r of run.results) {
      const c = classify(r, run.block);
      if (!rows.has(c.key)) {
        const group = GROUPS.find(([re]) => re.test(c.key))?.[1] ?? "Other";
        rows.set(c.key, { key: c.key, title: cleanTitle(r.title), group, cells: {} as Record<BlockName, Cell> });
      }
      const row = rows.get(c.key)!;
      if (c.mine) {
        // The title of a test that ran reads better than a skipped variant's; the first block's is kept
        if (!Object.values(row.cells).some(x => x.kind === "ran")) row.title = cleanTitle(r.title);
        row.cells[run.block] = { kind: "ran", status: r.status, result: r, run };
      } else if (!row.cells[run.block]) {
        row.cells[run.block] = { kind: "other", status: "not applicable", result: r, run, why: c.why };
      }
    }
  for (const [where, m] of Object.entries(MANUAL_CELLS)) {
    const [key, block] = where.split("@") as [string, BlockName];
    const run = runs.find(r => r.block === block);
    const row = rows.get(key);
    if (!run || !row || row.cells[block]?.kind === "ran") continue;
    row.cells[block] = { kind: "manual", status: m.status, run, why: m.text, href: `../${m.href.split("/").map(encodeURIComponent).join("/")}` };
  }
  for (const row of rows.values())
    for (const run of runs) {
      if (row.cells[run.block]) continue;
      if (DIALOG_ONLY.includes(row.key) && run.block !== "dialog") {
        row.cells[run.block] = { kind: "other", status: "not applicable", run, why: "runs once, in the Dialog block" };
        continue;
      }
      const why = NOT_RUN[`${row.key}@${run.block}`] ?? (row.key.startsWith("t0.") ? undefined : NOT_RUN[`*@${run.block}`]);
      row.cells[run.block] = why
        ? { kind: "missing", status: "skipped", run, why }
        : { kind: "missing", status: "skipped", run, why: row.key.startsWith("t0.") ? "block-independent" : "no result in this run" };
    }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true }));
}

const JUDGED = (c: { covers: string[] }) => !["2.2", "T6.10", "T6.8"].some(i => c.covers.includes(i));

/** The number that says most about a test's outcome: the failing checks, or the main check's summary */
function keyText(r: TestResult): string {
  if (r.status === "skipped") {
    const key = r.id.replace(/-(dialog|livekit-local|livekit-cloud|livekit)$/, "");
    const reason = SKIP_REASONS[key] ?? r.notes.filter(n => !/^reticulum's clock/.test(n)).pop();
    return short(reason ?? "skipped", 180);
  }
  const pick = (re: RegExp) => r.checks.find(c => re.test(c.name));
  const special: Record<string, () => string | undefined> = {
    "t2.15": () =>
      [pick(/^Heap flat/), pick(/^Live connections/), pick(/sequence number wrapped/)]
        .filter(Boolean)
        .map(c => `${c!.status === "OK" ? "" : `${c!.status}: `}${short(c!.summary, 160)}`)
        .join(" | ") || undefined,
    "t7.7-no-bots": () =>
      r.checks
        .filter(c => /Frame rate|[Ww]ho hears|[Ww]ho sees/.test(c.name))
        .map(c => `${c.name.replace(/ of the clients$/, "")}: ${short(c.summary, 90)}`)
        .join(" | ") || undefined
  };
  const key = r.id.replace(/-(dialog|livekit-local|livekit-cloud|livekit)$/, "");
  const s = special[key]?.();
  if (s) return short(s, 360);
  if (r.status === "NG") {
    const bad = r.checks.filter(c => c.status === "NG");
    if (!bad.length) return short(r.error ?? "failed outside its checks", 180);
    const more = bad.length > 1 ? ` (and ${bad.length - 1} more NG: ${bad.slice(1).map(c => short(c.name, 40)).join("; ")})` : "";
    return short(`${bad[0].name}: ${short(bad[0].summary, 170)}${more}`, 300);
  }
  if (r.status === "invalid") {
    const c = r.checks.find(c => c.status === "invalid");
    return short(c ? `${c.name}: ${c.summary}` : "invalid", 180);
  }
  const main = r.checks.find(c => JUDGED(c) && !/^All connected|^Both connected/.test(c.name)) ?? r.checks.find(JUDGED) ?? r.checks[0];
  return main ? short(`${main.name}: ${main.summary}`, 180) : "";
}

function cellHtml(cell: Cell, label: string, key: string): string {
  const extra = CELL_NOTES[`${key}@${cell.run.block}`];
  const note = extra ? `<div class="why">${esc(extra)}</div>` : "";
  if (cell.kind === "manual") return `<td data-label="${esc(label)}" class="cell"><a class="cell-link" href="${cell.href}">${badge(cell.status)}</a><div class="key" title="${esc(cell.why ?? "")}">${esc(cell.why ?? "")}</div>${note}</td>`;
  if (cell.kind === "other") return `<td data-label="${esc(label)}" class="cell other">${badge("not applicable", "n/a")}<div class="why">${esc(cell.why ?? "")}</div></td>`;
  if (cell.kind === "missing") return `<td data-label="${esc(label)}" class="cell">${badge("skipped", "not run")}<div class="why">${esc(cell.why ?? "")}</div></td>`;
  const r = cell.result!;
  const text = keyText(r);
  return `<td data-label="${esc(label)}" class="cell"><a class="cell-link" href="${reportLink(cell.run, r.id)}">${badge(r.status)}</a><div class="key" title="${esc(text)}">${esc(text)}</div>${note}</td>`;
}

const ORDER: string[] = ["NG", "known limitation", "invalid", "OK", "not applicable", "skipped"];
const worst = (statuses: string[]) => statuses.slice().sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];

function matrixSection(rows: Row[], runs: Run[]): string {
  let html = "";
  let group = "";
  for (const row of rows) {
    if (row.group !== group) {
      group = row.group;
      html += `<tr class="group"><th colspan="4">${esc(group)}</th></tr>`;
    }
    const t0 = row.key.startsWith("t0.");
    const name = `<th scope="row" class="test"><span class="tid">${esc(row.key)}</span> ${esc(row.title.replace(/^T[0-9.]+ /, "").replace(/^T5 inverse kinematics(, old solver against new)?: /, ""))}</th>`;
    if (t0) {
      const c = row.cells.dialog;
      const r = c.result;
      const inner = r ? `<a class="cell-link" href="${reportLink(c.run, r.id)}">${badge(r.status)}</a><div class="key">${esc(keyText(r))}</div>` : badge("skipped", "not run");
      html += `<tr>${name}<td colspan="3" class="cell span" data-label="all blocks (run once)">${inner}<div class="why">block-independent; run once, recorded in the Dialog run</div></td></tr>`;
      continue;
    }
    html += `<tr>${name}${runs.map(run => cellHtml(row.cells[run.block], BLOCKS.find(b => b.block === run.block)!.short, row.key)).join("")}</tr>`;
  }
  return `<table class="matrix"><thead><tr><th>Test</th>${runs.map(r => `<th>${esc(BLOCKS.find(b => b.block === r.block)!.label)}<div class="sub"><a href="../${esc(r.id)}/report.html">${esc(r.id)}</a></div></th>`).join("")}</tr></thead><tbody>${html}</tbody></table>`;
}

function countsSection(rows: Row[], runs: Run[]): string {
  const statuses: Status[] = ["OK", "NG", "known limitation", "not applicable", "skipped", "invalid"];
  const lines = runs.map(run => {
    const counts = Object.fromEntries(statuses.map(s => [s, 0])) as Record<Status, number>;
    for (const row of rows) {
      if (row.key.startsWith("t0.")) continue;
      counts[row.cells[run.block].status]++;
    }
    return { run, counts };
  });
  const t0 = rows.filter(r => r.key.startsWith("t0.")).map(r => `${r.key} ${r.cells.dialog.status}`);
  return `<div class="counts">${lines
    .map(
      ({ run, counts }) => `<div class="count-card"><h3>${esc(BLOCKS.find(b => b.block === run.block)!.label)}</h3>
      <div class="badges">${statuses.map(s => `<span class="badge ${statusClass(s)}">${counts[s]} ${esc(s)}</span>`).join("")}</div>
      <div class="muted small"><a href="../${esc(run.id)}/report.html">${esc(run.id)}/report.html</a> · ${run.results.length ? `${duration(run)}` : "no results"}</div></div>`
    )
    .join("")}</div>
    <p class="muted small">Counted per test of the matrix (T0 apart: ${esc(t0.join(", "))}). "not applicable": written for the other media server, or run once in the Dialog block; "skipped": written for the block but not run, with the reason in its cell.</p>`;
}

function duration(run: Run): string {
  const ran = run.results.filter(r => r.status !== "skipped" && r.startedAt);
  if (!ran.length) return "";
  const start = Math.min(...ran.map(r => Date.parse(r.startedAt)));
  const end = Math.max(...ran.map(r => Date.parse(r.startedAt) + r.durationMs));
  const min = Math.round((end - start) / 60_000);
  return `${localTime(start)} to ${localTime(end).slice(11)} ${zone()} (${Math.floor(min / 60)} h ${min % 60} min)`;
}

/** "2026-11-15 09:26" in this PC's time zone */
function localTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** This PC's offset from UTC, "UTC+9" */
function zone(): string {
  const minutes = -new Date().getTimezoneOffset();
  return `UTC${minutes >= 0 ? "+" : "-"}${Math.floor(Math.abs(minutes) / 60)}${Math.abs(minutes) % 60 ? ":" + String(Math.abs(minutes) % 60).padStart(2, "0") : ""}`;
}

function checklistSection(rows: Row[]): string {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const body = CHECKLIST.map(item => {
    const refs: { label: string; status: string; href?: string; open?: number }[] = [];
    for (const t of item.tests) {
      const row = byKey.get(t.key);
      for (const b of t.blocks ?? BLOCKS.map(x => x.block)) {
        const cell = row?.cells[b];
        if (cell?.kind === "manual") {
          refs.push({ label: `${t.key} ${BLOCKS.find(x => x.block === b)!.short}`, status: cell.status, href: cell.href });
          continue;
        }
        if (!cell || cell.kind !== "ran" || !cell.result) continue;
        const r = cell.result;
        let status: string = r.status;
        let open = 0;
        if (t.byCover && r.status !== "skipped") {
          const mine = r.checks.filter(c => c.covers.includes(item.id));
          if (mine.length) status = worst(mine.map(c => c.status));
          // Checks that could not be judged leave that part of the item open, even when the rest passed
          open = mine.filter(c => c.status === "not applicable").length;
          if (open && open === mine.length) status = "not applicable";
        }
        refs.push({ label: `${t.key} ${BLOCKS.find(x => x.block === b)!.short}`, status, href: reportLink(cell.run, r.id), open });
      }
    }
    const judged = refs.filter(r => r.status !== "skipped");
    const combined = !refs.length ? "skipped" : judged.length ? worst(judged.map(r => r.status)) : "skipped";
    const tally = ORDER.map(s => [s, refs.filter(r => r.status === s).length] as const)
      .filter(([, n]) => n)
      .map(([s, n]) => `${n} ${s}`)
      .join(", ");
    const openChecks = refs.filter(r => r.status !== "not applicable").reduce((n, r) => n + (r.open ?? 0), 0);
    const tallyText = openChecks ? `${tally}; ${openChecks} check${openChecks === 1 ? "" : "s"} for the item open` : tally;
    const tests = refs.length
      ? refs.map(r => `<a class="ref" href="${r.href}">${badge(r.status, r.status === "not applicable" ? "n/a" : r.status)} ${esc(r.label)}</a>`).join(" ")
      : `<span class="muted">${esc(item.note ?? "no test")}</span>`;
    return `<tr><th scope="row"><span class="tid">${esc(item.id)}</span> ${esc(item.name)}<div class="ja" lang="ja">${esc(item.ja)}</div></th>
      <td data-label="Tests">${tests}${item.note && refs.length ? `<div class="why">${esc(item.note)}</div>` : ""}</td>
      <td data-label="Combined" class="combined">${refs.length ? badge(combined, combined === "OK" && openChecks ? "OK, partly open" : combined === "not applicable" ? "open" : combined) : badge("skipped", "not covered")}<div class="why">${esc(tallyText)}</div></td></tr>`;
  }).join("");
  return `<table class="checklist"><thead><tr><th>Item</th><th>Tests (status of the checks for the item)</th><th>Combined</th></tr></thead><tbody>${body}</tbody></table>
  <p class="muted small">Combined: NG when any test standing for the item is NG; known limitation, invalid and OK in that order otherwise; "n/a" counts as open, not passed. Where a test has checks naming the item, only those checks count.</p>`;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  develop: "already on develop",
  new: "new since develop",
  "cannot tell": "cannot tell",
  "not a defect": "not a defect"
};

function findingsSection(rows: Row[], runs: Run[]): string {
  const byKey = new Map(rows.map(r => [r.key, r]));
  const body = FINDINGS.map(f => {
    const seen = f.seen
      .map(s => {
        const cell = byKey.get(s.key)?.cells[s.block];
        const label = `${s.key} ${BLOCKS.find(b => b.block === s.block)!.short}`;
        const href = cell?.result ? reportLink(cell.run, cell.result.id) : cell?.href;
        return href ? `<a href="${href}">${esc(label)}</a>${s.note ? ` <span class="muted">(${esc(s.note)})</span>` : ""}` : esc(label);
      })
      .join(", ");
    const evidence = f.seen.length
      ? (() => {
          const s = f.seen[0];
          const cell = byKey.get(s.key)?.cells[s.block];
          return cell?.result ? `<a href="${reportLink(cell.run, cell.result.id)}">final run</a>` : "";
        })()
      : f.earlier
        ? `<a href="../${encodeURIComponent(f.earlier.run)}/report.html#${encodeURIComponent(f.earlier.test)}">${esc(f.earlier.run)}</a>`
        : "";
    return `<tr class="v-${f.verdict.replace(/\s+/g, "-")}"><th scope="row" class="num">#${f.n}</th>
      <td data-label="Finding">${esc(f.short)}<div class="why">${esc(f.where)}</div></td>
      <td data-label="Seen in the final run">${seen || '<span class="muted">not seen in the final run</span>'}</td>
      <td data-label="Verdict"><span class="verdict v-${f.verdict.replace(/\s+/g, "-")}">${esc(VERDICT_LABEL[f.verdict])}</span><div class="why">${esc(f.verdictText)}</div></td>
      <td data-label="Evidence">${evidence || '<span class="muted">BASELINE.md</span>'}</td></tr>`;
  }).join("");
  void runs;
  return `<table class="findings"><thead><tr><th>#</th><th>Finding</th><th>Seen in the final run</th><th>Verdict</th><th>Evidence</th></tr></thead><tbody>${body}</tbody></table>`;
}

function observationsSection(rows: Row[]): string {
  if (!NEW_OBSERVATIONS.length) return "";
  const byKey = new Map(rows.map(r => [r.key, r]));
  const body = NEW_OBSERVATIONS.map(o => {
    const seen = o.seen
      .map(s => {
        const cell = byKey.get(s.key)?.cells[s.block];
        const label = `${s.key} ${BLOCKS.find(b => b.block === s.block)!.short}`;
        const href = cell?.result ? reportLink(cell.run, cell.result.id) : cell?.href;
        return href ? `<a href="${href}">${esc(label)}</a>` : esc(label);
      })
      .join(", ");
    return `<tr><td data-label="Observation">${esc(o.text)}</td><td data-label="Kind"><span class="verdict v-${o.kind === "product" ? "new" : "not-a-defect"}">${esc(o.kind)}</span></td><td data-label="Seen">${seen}</td></tr>`;
  }).join("");
  return `<h3>Seen for the first time in this run</h3><table class="findings observations"><thead><tr><th>Observation</th><th>Kind</th><th>Seen</th></tr></thead><tbody>${body}</tbody></table>`;
}

function ffmpeg(args: string[]): boolean {
  const r = spawnSync(ffmpegPath(), ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", timeout: 120_000 });
  return r.status === 0;
}

function gallerySection(rows: Row[]): { html: string; files: string[] } {
  // Only the gallery's files: whatever an earlier build copied is removed first
  fs.rmSync(MEDIA, { recursive: true, force: true });
  fs.mkdirSync(path.join(MEDIA, "thumbs"), { recursive: true });
  const byKey = new Map(rows.map(r => [r.key, r]));
  const copied: { item: (typeof GALLERY)[number]; thumb: string | null; size: number; from: string }[] = [];
  const problems: string[] = [];
  for (const item of GALLERY) {
    const cell = byKey.get(item.test)?.cells[item.block];
    if (!item.folder && !cell?.result) {
      problems.push(`${item.name}: no result of ${item.test} in the ${item.block} run`);
      continue;
    }
    const dir = item.folder ? path.join(EVIDENCE_DIR, item.folder) : path.join(cell!.run.dir, cell!.result!.id);
    const fromDir = item.folder ?? `${cell!.run.id}/${cell!.result!.id}`;
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const file = typeof item.file === "string" ? (files.includes(item.file) ? item.file : undefined) : files.find(f => (item.file as RegExp).test(f));
    if (!file) {
      problems.push(`${item.name}: no file ${String(item.file)} in ${fromDir}`);
      continue;
    }
    const target = path.join(MEDIA, item.name);
    fs.copyFileSync(path.join(dir, file), target);
    const thumb = path.join(MEDIA, "thumbs", item.name.replace(/\.[^.]+$/, ".jpg"));
    const made =
      item.kind === "image"
        ? ffmpeg(["-i", target, "-vf", "scale=480:-2", "-q:v", "4", thumb])
        : ffmpeg(["-ss", "4", "-i", target, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", thumb]) ||
          ffmpeg(["-i", target, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", thumb]);
    copied.push({ item, thumb: made ? path.relative(OUT, thumb).replace(/\\/g, "/") : null, size: fs.statSync(target).size, from: `${fromDir}/${file}` });
  }
  const mb = (n: number) => `${(n / 2 ** 20).toFixed(1)} MB`;
  const card = (c: (typeof copied)[number]) => {
    const href = `media/${encodeURIComponent(c.item.name)}`;
    const img = c.thumb ? `<img loading="lazy" src="${c.thumb.split("/").map(encodeURIComponent).join("/")}" alt="${esc(c.item.caption)}">` : `<div class="noimg">${esc(c.item.name)}</div>`;
    return `<figure class="shot ${c.item.kind}"><a href="${href}">${img}${c.item.kind === "video" ? '<span class="play" aria-hidden="true">&#9654;</span>' : ""}</a>
      <figcaption>${esc(c.item.caption)}<span class="muted small"> · ${c.item.kind === "video" ? `video, ${mb(c.size)}` : mb(c.size)}<span class="src"> · from <code>${esc(c.from)}</code></span></span></figcaption></figure>`;
  };
  const images = copied.filter(c => c.item.kind === "image");
  const videos = copied.filter(c => c.item.kind === "video");
  const html =
    `<h3>Screenshots and pictures (${images.length})</h3><div class="gallery">${images.map(card).join("")}</div>` +
    `<h3>Videos (${videos.length})</h3><div class="gallery">${videos.map(card).join("")}</div>` +
    (problems.length ? `<p class="muted small">Not found: ${esc(problems.join("; "))}</p>` : "");
  return { html, files: copied.map(c => c.item.name) };
}

/** CPU and memory during each run, from the minute samples the C: watchdog wrote (final-watchdog.log) */
function loadLine(run: Run): string {
  const log = path.join(EVIDENCE_DIR, "final-watchdog.log");
  if (!fs.existsSync(log)) return "";
  const ran = run.results.filter(r => r.status !== "skipped" && r.startedAt && !r.id.startsWith("t0."));
  if (!ran.length) return "";
  const start = Math.min(...ran.map(r => Date.parse(r.startedAt)));
  const end = Math.max(...ran.map(r => Date.parse(r.startedAt) + r.durationMs));
  const samples = fs
    .readFileSync(log, "utf8")
    .split(/\r?\n/)
    .map(l => /^(\S+) C: ([\d.]+) GB free, CPU (\d+)%(?:, RAM free ([\d.]+) GB, (Unity none|Unity cpu-s (\d+) ws (\d+) MB))?/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map(m => ({ t: Date.parse(m[1]), cFree: +m[2], cpu: +m[3], ram: m[4] ? +m[4] : null, unity: m[5] ? m[5] !== "Unity none" : null, unityCpu: m[6] ? +m[6] : null }))
    .filter(s => s.t >= start && s.t <= end);
  if (!samples.length) return "";
  const cpus = samples.map(s => s.cpu);
  const mean = Math.round(cpus.reduce((a, b) => a + b, 0) / cpus.length);
  const rams = samples.map(s => s.ram).filter((x): x is number => x !== null);
  const unity = samples.filter(s => s.unity !== null);
  const unityCpu = unity.filter(s => s.unityCpu !== null && s.unityCpu > 1000);
  const unityText = unity.length
    ? unity.every(s => s.unity)
      ? `Unity editor open throughout${
          unityCpu.length > 1
            ? ` (${Math.round(unityCpu[unityCpu.length - 1].unityCpu! - unityCpu[0].unityCpu!)} CPU seconds over the run, about ${(((unityCpu[unityCpu.length - 1].unityCpu! - unityCpu[0].unityCpu!) / ((unityCpu[unityCpu.length - 1].t - unityCpu[0].t) / 1000)) * 100).toFixed(0)}% of one core)`
            : ""
        }`
      : unity.some(s => s.unity)
        ? "Unity editor open part of the time"
        : "no Unity editor"
    : "";
  return `CPU ${mean}% on average, ${Math.max(...cpus)}% at most (${samples.length} minute samples)${rams.length ? `; free RAM down to ${Math.min(...rams)} GB of 48` : ""}; C: free ${Math.min(...samples.map(s => s.cFree))} GB at least${unityText ? `; ${unityText}` : ""}`;
}

function headerSection(runs: Run[]): string {
  const withInfo = runs.filter(r => r.info);
  const repoNames = ["compose", "hubs", "reticulum", "dialog", "spoke"];
  const repoRows = repoNames
    .map(name => {
      const states = withInfo.map(r => r.info.repos?.[name]).filter(Boolean);
      const distinct = [...new Set(states.map((s: any) => `${s.branch} ${s.commit?.slice(0, 10)}${s.dirty ? " (uncommitted changes)" : ""}`))];
      return `<tr><th>${esc(name)}</th><td>${distinct.map(d => `<code>${esc(d.split(" ")[1])}</code> ${esc(d.split(" ")[0])}${d.includes("uncommitted") ? ' <span class="muted">uncommitted changes</span>' : ""}`).join("<br>")}${distinct.length > 1 ? ' <span class="badge st-known-limitation">differs between runs</span>' : ""}</td></tr>`;
    })
    .join("");
  const browsers = withInfo[0]?.info.browsers ?? {};
  const browserRows = Object.entries(browsers)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join("");
  const m = withInfo[0]?.info.machine ?? {};
  const runRows = runs
    .map(
      r =>
        `<tr><th>${esc(BLOCKS.find(b => b.block === r.block)!.short)}</th><td><a href="../${esc(r.id)}/report.html">${esc(r.id)}</a> ${esc(duration(r))}${RUN_NOTES[r.block] ? `<div class="why">${esc(RUN_NOTES[r.block])}</div>` : ""}<div class="why">${esc(loadLine(r))}</div></td></tr>`
    )
    .join("");
  return `<div class="grid2">
    <table class="kv"><caption>Repositories (from each run's run.json)</caption>${repoRows}</table>
    <table class="kv"><caption>Browsers and machine</caption>${browserRows}<tr><th>WebKit</th><td>Playwright's Linux WebKit in the netclient container (IOS profiles)</td></tr>
      <tr><th>machine</th><td>${esc(`${m.cpu ?? ""}, ${m.cores ?? "?"} threads, ${m.memoryGb ?? "?"} GB, ${m.os ?? ""}`)}</td></tr></table>
  </div>
  <table class="kv runs"><caption>Runs and the PC's load</caption>${runRows}</table>
  <ul class="notes">${LOAD_NOTES.map(n => `<li>${esc(n)}</li>`).join("")}</ul>`;
}

const STYLE = `
:root { color-scheme: light dark;
  --bg: #f6f7f9; --card: #ffffff; --text: #1d2330; --muted: #5d6677; --line: #dde1e8; --code: #eef0f4; --head: #eef1f5;
  --ok: #1e7f4f; --ok-bg: #e3f4ea; --ng: #b42335; --ng-bg: #fbe5e8; --skip: #5d6677; --skip-bg: #eceef2;
  --known: #8a5a00; --known-bg: #fbefd5; --invalid: #6b3fa0; --invalid-bg: #efe6f8; --link: #2457c5;
  --na: #3d6670; --na-bg: #e4eff1; --new: #b42335; --dev: #2457c5; --tell: #8a5a00; --nod: #5d6677; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #12151b; --card: #1b2029; --text: #e3e7ee; --muted: #9aa3b2; --line: #2d3442; --code: #252c38; --head: #222834;
  --ok: #5fd39a; --ok-bg: #173527; --ng: #ff8593; --ng-bg: #3d1a21; --skip: #a3abb8; --skip-bg: #262c36;
  --known: #f2c062; --known-bg: #3a2d12; --invalid: #c9a3f2; --invalid-bg: #2e2340; --link: #8ab4ff;
  --na: #8fc3cf; --na-bg: #1c2f34; --new: #ff8593; --dev: #8ab4ff; --tell: #f2c062; --nod: #a3abb8; } }
:root[data-theme="dark"] {
  --bg: #12151b; --card: #1b2029; --text: #e3e7ee; --muted: #9aa3b2; --line: #2d3442; --code: #252c38; --head: #222834;
  --ok: #5fd39a; --ok-bg: #173527; --ng: #ff8593; --ng-bg: #3d1a21; --skip: #a3abb8; --skip-bg: #262c36;
  --known: #f2c062; --known-bg: #3a2d12; --invalid: #c9a3f2; --invalid-bg: #2e2340; --link: #8ab4ff;
  --na: #8fc3cf; --na-bg: #1c2f34; --new: #ff8593; --dev: #8ab4ff; --tell: #f2c062; --nod: #a3abb8; }
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; overflow-wrap: anywhere; }
main { max-width: 1240px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 24px; margin: 0 0 4px; line-height: 1.25; } h2 { font-size: 18px; margin: 36px 0 12px; } h3 { font-size: 15px; margin: 16px 0 8px; }
a { color: var(--link); } code { background: var(--code); border-radius: 4px; padding: 1px 4px; font-size: 12px; }
.muted { color: var(--muted); } .small { font-size: 12px; }
nav.toc { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 0; font-size: 13px; }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 16px; margin: 12px 0; }
.badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-weight: 600; font-size: 12px; white-space: nowrap; }
.st-ok { color: var(--ok); background: var(--ok-bg); } .st-ng { color: var(--ng); background: var(--ng-bg); }
.st-skipped { color: var(--skip); background: var(--skip-bg); } .st-known-limitation { color: var(--known); background: var(--known-bg); }
.st-invalid { color: var(--invalid); background: var(--invalid-bg); }
.st-not-applicable { color: var(--na); background: var(--na-bg); border: 1px dashed var(--na); }
.counts { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.count-card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; }
.count-card h3 { margin: 0 0 8px; } .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
table { border-collapse: collapse; width: 100%; } caption { text-align: left; font-weight: 600; padding: 4px 0; }
th, td { text-align: left; vertical-align: top; padding: 7px 8px; border-bottom: 1px solid var(--line); }
thead th { color: var(--muted); font-weight: 500; font-size: 12px; background: var(--head); position: sticky; top: 0; z-index: 1; }
.kv th { width: 120px; color: var(--muted); font-weight: 500; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.runs { margin-top: 12px; }
.tid { font-family: ui-monospace, "Cascadia Mono", Consolas, monospace; font-size: 12px; color: var(--muted); margin-right: 4px; }
.matrix, .checklist, .findings { background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.matrix th.test { font-weight: 500; width: 28%; }
.matrix td.cell { width: 24%; }
.matrix tr.group th { background: var(--head); font-size: 13px; padding-top: 10px; }
.matrix .sub { font-size: 11px; font-weight: 400; }
.key { font-size: 12px; color: var(--muted); margin-top: 3px; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.why { font-size: 12px; color: var(--muted); margin-top: 3px; }
.cell-link { text-decoration: none; }
.checklist th[scope=row] { font-weight: 500; width: 26%; } .checklist .ja { font-size: 12px; color: var(--muted); }
.checklist .combined { width: 15%; }
a.ref { display: inline-block; text-decoration: none; color: var(--text); font-size: 12px; margin: 0 8px 4px 0; white-space: nowrap; }
a.ref:hover { text-decoration: underline; }
.findings .num { width: 44px; }
.verdict { font-weight: 600; font-size: 12px; overflow-wrap: normal; word-break: keep-all; }
.observations td:nth-child(2) { white-space: nowrap; width: 1%; }
.observations td:nth-child(3) { width: 24%; }
.findings .num { white-space: nowrap; }
.verdict.v-new { color: var(--new); } .verdict.v-develop { color: var(--dev); } .verdict.v-cannot-tell { color: var(--tell); } .verdict.v-not-a-defect { color: var(--nod); }
.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.shot { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.shot a { display: block; position: relative; }
.shot img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; background: var(--code); }
.shot .noimg { aspect-ratio: 16 / 10; display: grid; place-items: center; background: var(--code); color: var(--muted); font-size: 12px; }
.shot .play { position: absolute; inset: auto auto 8px 8px; background: rgba(0,0,0,.65); color: #fff; border-radius: 999px; width: 30px; height: 30px; display: grid; place-items: center; font-size: 13px; }
.shot figcaption { padding: 8px 10px 10px; font-size: 13px; }
.notes { margin: 8px 0; padding-left: 20px; } .notes li { color: var(--muted); margin: 2px 0; }
ol.open, ul.open { margin: 0; padding-left: 22px; } .open li { margin: 4px 0; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 12px; color: var(--muted); margin: 8px 0; }
@media (max-width: 760px) {
  main { padding: 16px 16px 48px; }
  h1 { font-size: 20px; }
  .matrix, .checklist, .findings { border: none; background: none; }
  .matrix thead, .checklist thead, .findings thead { display: none; }
  .matrix tbody, .checklist tbody, .findings tbody, .matrix tr, .checklist tr, .findings tr { display: block; width: 100%; }
  .matrix tr, .checklist tr, .findings tr { background: var(--card); border: 1px solid var(--line); border-radius: 8px; margin: 0 0 10px; padding: 6px 2px; }
  .matrix tr.group { background: none; border: none; padding: 0; margin: 18px 0 6px; }
  .matrix tr.group th { background: none; padding: 0; border: none; font-size: 15px; }
  .matrix th, .matrix td, .checklist th, .checklist td, .findings th, .findings td { display: block; width: auto !important; border: none; padding: 4px 10px; }
  .matrix td[data-label]::before, .checklist td[data-label]::before, .findings td[data-label]::before {
    content: attr(data-label); display: block; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }
  .kv th { width: 90px; }
  .key { -webkit-line-clamp: 3; }
  .gallery { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
  .shot .src { display: none; }
  .observations td:nth-child(2), .observations td:nth-child(3) { width: auto; white-space: normal; }
}
`;

export function buildSummary(): string {
  const runs = loadRuns();
  const rows = buildRows(runs);
  fs.mkdirSync(OUT, { recursive: true });
  const gallery = gallerySection(rows);
  const built = `${localTime(Date.now())} ${zone()}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Client tests, full run</title><style>${STYLE}</style></head>
<body><main>
  <h1>chutvrc simulated-client tests: the full run</h1>
  <div class="muted">One run per media server block, all suites, without product fixes · built ${esc(built)}</div>
  <nav class="toc"><a href="#runs">Runs</a><a href="#matrix">Matrix</a><a href="#checklist">Checklist</a><a href="#findings">Findings</a><a href="#gallery">Gallery</a><a href="#open">Open for real devices</a></nav>
  <h2 id="runs">Runs</h2><div class="panel">${headerSection(runs)}</div>
  ${countsSection(rows, runs)}
  <h2 id="matrix">Tests by media server block</h2>
  <div class="legend">${["OK", "NG", "known limitation", "invalid", "skipped"].map(s => badge(s)).join("")}${badge("not applicable", "n/a")}<span>Each status links to the test in its block's report; the text under it is the key number (hover for all of it).</span></div>
  ${matrixSection(rows, runs)}
  <h2 id="checklist">Manual checklist coverage</h2>
  <p class="muted">The items of chutvrc_verification_2026-11 and the tests that stand for them.</p>
  ${checklistSection(rows)}
  <h2 id="findings">Findings</h2>
  <p class="muted">BASELINE.md's findings 1 to 37: where the final run showed each and its verdict against develop ("new since develop" names the work stream).</p>
  ${findingsSection(rows, runs)}
  ${observationsSection(rows)}
  <h2 id="gallery">Gallery</h2>
  <p class="muted">Copied into <code>media/</code>; each thumbnail opens the full file.</p>
  ${gallery.html}
  <h2 id="open">Still open for real devices</h2>
  <div class="panel"><ol class="open">${REAL_DEVICE.map(i => `<li>${esc(i)}</li>`).join("")}</ol></div>
  <h3>Also left open by this run</h3>
  <div class="panel"><ul class="open">${OPEN_FROM_THIS_RUN.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>
</main></body></html>
`;
  const file = path.join(OUT, "index.html");
  fs.writeFileSync(file, html);
  return file;
}

/** The counts and the matrix as Markdown, for RESULTS.md: status and a short key number per cell */
export function summaryMarkdown(): string {
  const runs = loadRuns();
  const rows = buildRows(runs);
  const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const label = (b: BlockName) => BLOCKS.find(x => x.block === b)!.short;
  const statuses: Status[] = ["OK", "NG", "known limitation", "not applicable", "skipped", "invalid"];
  const counts = runs.map(run => {
    const n = Object.fromEntries(statuses.map(s => [s, 0])) as Record<Status, number>;
    for (const row of rows) if (!row.key.startsWith("t0.")) n[row.cells[run.block].status]++;
    return `| ${label(run.block)} | ${statuses.map(s => n[s]).join(" | ")} |`;
  });
  const cell = (c: Cell) => {
    if (c.kind === "other") return "n/a";
    if (c.kind === "missing") return `not run${c.why && c.why !== "no result in this run" ? `: ${md(short(c.why, 60))}` : ""}`;
    if (c.kind === "manual") return `**${c.status}** ${md(short(c.why ?? "", 90))}`;
    return `**${c.status}** ${md(short(keyText(c.result!), 90))}`;
  };
  const lines = rows.map(row =>
    row.key.startsWith("t0.")
      ? `| ${row.key} ${md(short(row.title.replace(/^T[0-9.]+ /, ""), 50))} | ${cell(row.cells.dialog)} (once, all blocks) | | |`
      : `| ${row.key} ${md(short(row.title.replace(/^T[0-9.]+ /, "").replace(/^T5 inverse kinematics(, old solver against new)?: /, ""), 50))} | ${runs.map(r => cell(row.cells[r.block])).join(" | ")} |`
  );
  return [
    `| Block | ${statuses.join(" | ")} |`,
    `| --- | ${statuses.map(() => "---").join(" | ")} |`,
    ...counts,
    "",
    `| Test | ${runs.map(r => label(r.block)).join(" | ")} |`,
    "| --- | --- | --- | --- |",
    ...lines
  ].join("\n");
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("report/build-summary.ts")) {
  console.log(process.argv.includes("--markdown") ? summaryMarkdown() : buildSummary());
}
