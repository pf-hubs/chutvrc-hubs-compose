// Compares two runs test by test (each test folder's result.json): status and the failing checks, as a
// Markdown table for the regression record. Folders of tests skipped in a run are left out; the block
// suffix "-livekit-local" is read as "-livekit", as the earlier runs named it.
//   npx tsx trials/compare-runs.ts <before run id> <after run id> [more after run ids, later ones win]
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";

type Check = { name: string; status: string; summary: string };
type Result = { id?: string; status: string; checks?: Check[]; error?: string; startedAt?: string };

function read(runId: string): Map<string, Result & { folder: string }> {
  const dir = path.join(EVIDENCE_DIR, runId);
  const out = new Map<string, Result & { folder: string }>();
  for (const folder of fs.readdirSync(dir)) {
    const file = path.join(dir, folder, "result.json");
    if (!fs.existsSync(file)) continue;
    const r = JSON.parse(fs.readFileSync(file, "utf8")) as Result;
    if (r.status === "skipped") continue;
    const key = folder.replace(/-livekit-local(?=$|-repeat)/, "-livekit").replace(/-livekit-cloud(?=$|-repeat)/, "-livekit");
    const prev = out.get(key);
    if (!prev || (r.startedAt ?? "") > (prev.startedAt ?? "")) out.set(key, { ...r, folder: `${runId}\\${folder}` });
  }
  return out;
}

const [before, ...after] = process.argv.slice(2);
if (!before || !after.length) throw new Error("usage: npx tsx trials/compare-runs.ts <before run id> <after run id> [...]");
const a = read(before);
const b = new Map<string, Result & { folder: string }>();
for (const id of after) for (const [k, v] of read(id)) if (!b.has(k) || (v.startedAt ?? "") > (b.get(k)!.startedAt ?? "")) b.set(k, v);

const ng = (r?: Result) => (r ? (r.checks ?? []).filter(c => c.status === "NG").map(c => c.name) : []);
const short = (s: string) => s.replace(/\|/g, "/").slice(0, 70);
const keys = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
const rows = ["| Test | Before | After | Checks NG before | Checks NG after | Evidence after |", "| --- | --- | --- | --- | --- | --- |"];
for (const k of keys) {
  const x = a.get(k), y = b.get(k);
  const nx = ng(x), ny = ng(y);
  const fixed = nx.filter(n => !ny.includes(n)), added = ny.filter(n => !nx.includes(n));
  rows.push(
    `| ${k} | ${x?.status ?? "–"} | ${y?.status ?? "–"} | ${nx.map(short).join("; ") || "–"} | ${ny.map(short).join("; ") || "–"}${added.length && x ? ` **(new: ${added.map(short).join("; ")})**` : ""}${fixed.length && y ? ` (passing now: ${fixed.map(short).join("; ")})` : ""} | ${y?.folder ?? "–"} |`
  );
}
console.log(rows.join("\n"));
