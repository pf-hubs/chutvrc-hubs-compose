// Lists the avatar model lines of a run's console logs: "Avatar of <id> loading <avatarId>: <reason>" and
// "Avatar of <id> forgotten: <reason>" (the pose sync logs them since the reload fix), per test and client, and
// flags a second load of the same avatar for the same client id that no room move, media server switch or
// avatar change explains. Usage: npx tsx trials/avatar-lines.ts <run id> [test folder prefix ...]
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";

const [runId, ...prefixes] = process.argv.slice(2);
if (!runId) throw new Error("usage: npx tsx trials/avatar-lines.ts <run id> [test folder prefix ...]");
const dir = path.join(EVIDENCE_DIR, runId);
const out: Record<string, Record<string, { t: number; kind: "loading" | "forgotten"; id: string; avatar?: string; reason: string }[]>> = {};
for (const test of fs.readdirSync(dir)) {
  if (prefixes.length && !prefixes.some(p => test.startsWith(p))) continue;
  const tdir = path.join(dir, test);
  if (!fs.statSync(tdir).isDirectory()) continue;
  for (const f of fs.readdirSync(tdir).filter(f => f.endsWith(".console.log"))) {
    const lines = fs.readFileSync(path.join(tdir, f), "utf8").split(/\r?\n/);
    const found = [];
    for (const l of lines) {
      const m = /^\s*([\d.]+)\s+\w+\s+Avatar of (\S+) (loading (\S+)|forgotten): (.*?)\s*(<https?:\/\/\S+>)?$/.exec(l);
      if (!m) continue;
      found.push({ t: +m[1], kind: m[4] ? ("loading" as const) : ("forgotten" as const), id: m[2], avatar: m[4], reason: m[5] });
    }
    if (found.length) (out[test] ??= {})[f.replace(".console.log", "")] = found;
  }
}
for (const [test, clients] of Object.entries(out)) {
  console.log(`## ${test}`);
  for (const [client, found] of Object.entries(clients)) {
    const seen = new Map<string, number>();
    const repeats: string[] = [];
    for (const x of found) {
      if (x.kind !== "loading") continue;
      const key = `${x.id} ${x.avatar}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      if (seen.get(key)! > 1) repeats.push(`${x.t}s ${x.id.slice(0, 8)} ${x.avatar!.split("/").pop()} (${x.reason})`);
    }
    const forgotten = found.filter(x => x.kind === "forgotten");
    console.log(
      `  ${client}: ${found.filter(x => x.kind === "loading").length} loading, ${forgotten.length} forgotten` +
        (forgotten.length ? ` [${forgotten.map(x => `${x.t}s ${x.id.slice(0, 8)}: ${x.reason}`).join("; ")}]` : "") +
        (repeats.length ? `; same avatar loaded again: ${repeats.join("; ")}` : "")
    );
    for (const x of found) console.log(`     ${x.t}s ${x.kind} ${x.id.slice(0, 8)} ${x.avatar ? x.avatar.split("/").pop() : ""}: ${x.reason}`);
  }
}
fs.writeFileSync(path.join(dir, "avatar-lines.json"), JSON.stringify(out, null, 2));
