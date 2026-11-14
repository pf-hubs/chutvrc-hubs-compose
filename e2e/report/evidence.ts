// Evidence of a run (plan 3.3): evidence/<run-id>/run.json for the run, and per test a folder
// evidence/<run-id>/<test-id>/ with named screenshots, a video per client, console logs, saved data and
// result.json (status, the checks with their numbers, the files). report/build-report.ts reads them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type TestInfo } from "@playwright/test";
import { EVIDENCE_DIR, REPOS } from "../lib/env";
import { gitState, lanAddressProblem, sql } from "../lib/stack";
import { activeLiveKitBlock, mediaBlock } from "../lib/livekit";
import type { Client } from "../clients/launch";
import { isNotApplicable } from "../probes/compat";
import { startObsRecording, type ObsRecording } from "./obs";

/**
 * OK, NG, skipped and known limitation as plan 3.3; invalid when the frame rate floor of plan 2.2 is missed;
 * not applicable when the check needs what this build of the client does not have (probes/compat.ts), so it
 * says nothing either way about the build
 */
export type Status = "OK" | "NG" | "skipped" | "known limitation" | "invalid" | "not applicable";

export type Check = { name: string; covers: string[]; status: Status; summary: string; data?: unknown; atMs: number };
/** "sheet": a contact sheet, shown at full width in the report (T5); "grid": a who-hears-whom or who-sees-whom picture, shown inline at its own size (T7) */
export type FileKind = "screenshot" | "video" | "obs" | "data" | "log" | "recording" | "sheet" | "grid";
export type FileRef = { file: string; kind: FileKind; label: string; client?: string };

export type TestResult = {
  id: string;
  title: string;
  covers: string[];
  status: Status;
  startedAt: string;
  durationMs: number;
  error?: string;
  clients: { name: string; profile: string; identity: string; slot: string; pilotHz: number }[];
  checks: Check[];
  files: FileRef[];
  notes: string[];
};

export const runId = () => (process.env.E2E_RUN_ID ??= new Date().toISOString().replace(/[:.]/g, "-"));
export const runDir = (id = runId()) => path.join(EVIDENCE_DIR, id);

/** A test's id and the checklist items it covers, from its annotations ("id", "covers") */
export function testMeta(annotations: { type: string; description?: string }[], title: string) {
  const id = annotations.find(a => a.type === "id")?.description ?? title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
  const covers = (annotations.find(a => a.type === "covers")?.description ?? "").split(/[,\s]+/).filter(Boolean);
  const knownLimitation = annotations.find(a => a.type === "known limitation")?.description;
  return { id, covers, knownLimitation };
}

/** The evidence folder of a test: its id, with the repetition for --repeat-each beyond the first */
export const evidenceId = (id: string, repeatEachIndex = 0) => (repeatEachIndex ? `${id}-repeat${repeatEachIndex + 1}` : id);

/** How long one check may take before it is recorded as NG and the test goes on */
const CHECK_TIMEOUT_MS = 6 * 60_000;

export class Evidence {
  readonly dir: string;
  readonly checks: Check[] = [];
  readonly files: FileRef[] = [];
  readonly notes: string[] = [];
  private clients: Client[] = [];
  private shotCount = 0;
  private obs?: ObsRecording;
  private readonly t0 = Date.now();

  constructor(
    readonly id: string,
    readonly title: string,
    readonly covers: string[]
  ) {
    this.dir = path.join(runDir(), id);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /** Absolute path of a file in this test's folder */
  file(name: string): string {
    return path.join(this.dir, name);
  }

  addFile(file: string, kind: FileKind, label: string, client?: string) {
    this.files.push({ file: file.replace(/\\/g, "/"), kind, label, client });
  }

  saveJson(name: string, data: unknown, label = name) {
    fs.writeFileSync(this.file(name), JSON.stringify(data, null, 2));
    this.addFile(name, "data", label);
  }

  saveText(name: string, text: string, label = name, kind: FileKind = "log") {
    fs.writeFileSync(this.file(name), text);
    this.addFile(name, kind, label);
  }

  note(text: string) {
    this.notes.push(text);
  }

  /** Clients launched with this evidence are screenshotted on failure and closed when the test ends */
  register(client: Client) {
    this.clients.push(client);
  }

  /** A named screenshot of one client: shot-<nn>-<client>-<label>.png */
  async screenshot(client: Client, label: string): Promise<string | null> {
    // A test may close its clients itself before it ends (T5 makes its videos after closing them)
    if (client.page.isClosed()) return null;
    const name = `shot-${String(++this.shotCount).padStart(2, "0")}-${client.name}-${label.replace(/[^A-Za-z0-9]+/g, "-")}.png`;
    try {
      await client.page.screenshot({ path: this.file(name), timeout: 15_000 });
      this.addFile(name, "screenshot", label, client.name);
      return name;
    } catch (e) {
      this.note(`screenshot ${label} of ${client.name} failed: ${(e as Error).message.split("\n")[0]}`);
      return null;
    }
  }

  /**
   * One check of the test: runs `fn` as a step and records its status, a one-line summary with the
   * numbers, and its data. A failed check marks the test NG (soft assertion) but later checks still run;
   * an exception inside `fn` is recorded as NG with its message. A check that has not finished after
   * `timeoutMs` (a page that stopped answering never returns from page.evaluate) is recorded as NG too, and
   * the test goes on. `ok: "not applicable"`, or a NotApplicable thrown by a probe (probes/compat.ts),
   * records the check as not applicable on this build. Returns what `fn` returned.
   */
  async check<T extends { ok: boolean | "invalid" | "not applicable"; summary: string; data?: unknown }>(
    name: string,
    covers: string | string[],
    fn: () => Promise<T>,
    timeoutMs = CHECK_TIMEOUT_MS
  ): Promise<T | undefined> {
    const items = Array.isArray(covers) ? covers : covers.split(/[,\s]+/).filter(Boolean);
    const atMs = Date.now() - this.t0;
    let outcome: T | undefined;
    await test.step(name, async () => {
      try {
        outcome = await Promise.race([
          fn(),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`the check did not finish within ${timeoutMs / 60_000} min`)), timeoutMs))
        ]);
      } catch (e) {
        const message = (e as Error).message.split("\n")[0];
        if (isNotApplicable(e)) {
          this.checks.push({ name, covers: items, status: "not applicable", summary: `not applicable on this build: ${message}`, atMs });
          return;
        }
        this.checks.push({ name, covers: items, status: "NG", summary: `error: ${message}`, atMs });
        expect.soft(message, name).toBe("no error");
        return;
      }
      const status: Status =
        outcome.ok === "invalid" ? "invalid" : outcome.ok === "not applicable" ? "not applicable" : outcome.ok ? "OK" : "NG";
      this.checks.push({ name, covers: items, status, summary: outcome.summary, data: outcome.data, atMs });
      if (status === "NG") expect.soft(outcome.summary, name).toBe("passing");
    });
    return outcome;
  }

  /** Records a check that cannot run on this build of the client, with the reason, without running it */
  notApplicable(name: string, covers: string | string[], why: string) {
    const items = Array.isArray(covers) ? covers : covers.split(/[,\s]+/).filter(Boolean);
    this.checks.push({ name, covers: items, status: "not applicable", summary: `not applicable on this build: ${why}`, atMs: Date.now() - this.t0 });
  }

  /** Starts an OBS recording for this test (video with sound); notes why when OBS cannot be used */
  async recordWithObs() {
    if (process.env.E2E_OBS === "0") return this.note("OBS recording turned off (E2E_OBS=0)");
    const started = await startObsRecording();
    if ("problem" in started) return this.note(started.problem);
    this.obs = started;
    started.warnings.forEach(w => this.note(w));
  }

  /** Called by the test fixture when the test ends: failure screenshots, clients closed, result.json */
  async finish(info: TestInfo) {
    const failed = info.status !== "passed" && info.status !== "skipped";
    for (const client of this.clients) {
      if (failed) await this.screenshot(client, "at-end");
      await client.close();
    }
    if (this.obs) {
      const saved = await this.obs.stop(this.file("obs"));
      if ("file" in saved) {
        this.addFile(path.basename(saved.file), "obs", "OBS: desktop with sound");
        saved.notes.forEach(n => this.note(n));
      } else {
        this.note(saved.problem);
      }
    }
    const meta = testMeta(info.annotations, info.title);
    const result: TestResult = {
      id: this.id,
      title: this.title,
      covers: this.covers,
      status: statusOf(info.status, this.checks, meta.knownLimitation),
      startedAt: new Date(this.t0).toISOString(),
      durationMs: Date.now() - this.t0,
      error: info.errors.length ? info.errors.map(e => e.message?.split("\n")[0]).join("; ") : undefined,
      clients: this.clients.map(c => ({ name: c.name, profile: c.profile, identity: c.identity, slot: c.slot, pilotHz: c.pilotHz })),
      checks: this.checks,
      files: this.files,
      notes: this.notes
    };
    fs.writeFileSync(this.file("result.json"), JSON.stringify(result, null, 2));
  }
}

export function statusOf(playwrightStatus: string | undefined, checks: Check[], knownLimitation?: string): Status {
  if (playwrightStatus === "skipped") return "skipped";
  if (knownLimitation) return "known limitation";
  if (playwrightStatus !== "passed" || checks.some(c => c.status === "NG")) return "NG";
  if (checks.some(c => c.status === "invalid")) return "invalid";
  // Every check that says something about the client could not run on this build (frame rate and the
  // closing checks alone do not make the test OK)
  const judged = checks.filter(c => !["2.2", "T6.10", "T6.8"].some(item => c.covers.includes(item)));
  if (judged.length && judged.every(c => c.status === "not applicable")) return "not applicable";
  return "OK";
}

/**
 * Which client API the hubs checkout has, from its source (the pages report the same at run time through
 * probes/compat.ts): "session" from the transport refactor on (APP.sfu is an SfuSession with the data
 * channel bus), "adapter" before it (develop); the pose store (APP.avatarPoses) from the avatar refactor on
 */
export function hubsClientApi(hubsDir = REPOS.hubs) {
  const has = (file: string) => fs.existsSync(path.join(hubsDir, "src", ...file.split("/")));
  return {
    kind: has("sfu-adapters/sfu-session.ts") ? "session" : "adapter",
    packetLog: has("sfu-adapters/data-channel-bus.ts"),
    poseStore: has("avatar/pose/pose-store.ts")
  };
}

/** run.json: the commits of the five repositories, browser versions, the media server block, the machine */
export async function writeRunInfo() {
  const dir = runDir();
  fs.mkdirSync(dir, { recursive: true });
  const browsers: Record<string, string> = {};
  for (const [label, channel] of [["msedge", "msedge"], ["chromium", undefined]] as const) {
    try {
      const browser = await chromium.launch({ channel, headless: true });
      browsers[label] = browser.version();
      await browser.close();
    } catch (e) {
      browsers[label] = `not available: ${(e as Error).message.split("\n")[0]}`;
    }
  }
  const playwrightVersion = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "..", "node_modules", "@playwright", "test", "package.json"), "utf8")
  ).version;
  let mediaServer: unknown;
  try {
    const rows = sql(`select key, value->>'value' from ret0.server_configs where key in ('webrtc-settings|default_sfu', 'webrtc-settings|allow_switch_sfu')`);
    mediaServer = {
      // MEDIA_BLOCK of the run: which tests ran (plan 1.4), and the LiveKit server setting it used
      block: mediaBlock(),
      liveKit: activeLiveKitBlock(),
      liveKitBeforeRun: process.env.E2E_LIVEKIT_BEFORE ?? null,
      serverSettings: Object.fromEntries(rows.split("\n").filter(Boolean).map(r => r.split("\t")))
    };
  } catch (e) {
    mediaServer = { error: (e as Error).message.split("\n")[0] };
  }
  const info = {
    runId: runId(),
    startedAt: new Date().toISOString(),
    repos: Object.fromEntries(Object.entries(REPOS).map(([name, repoDir]) => [name, gitState(repoDir)])),
    hubsClientApi: hubsClientApi(),
    browsers: { ...browsers, playwright: playwrightVersion },
    mediaServer,
    lanAddress: lanAddressProblem() ?? "matches PRIVATE_NETWORK_IP",
    reticulumClockBehindSeconds: process.env.E2E_SERVER_CLOCK_LAG ? Number(process.env.E2E_SERVER_CLOCK_LAG) : null,
    machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` }
  };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(info, null, 2));
  return info;
}
