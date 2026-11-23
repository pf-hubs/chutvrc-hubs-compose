// Commands against the running stack: docker compose, the database and reticulum's Elixir runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, request } from "@playwright/test";
import { BASE_URL, COMPOSE_ROOT, EVIDENCE_DIR, sleep } from "./env";

/** ffmpeg: winget's Gyan.FFmpeg is found even when it is not on PATH */
export function ffmpegPath(): string {
  const local = process.env.LOCALAPPDATA ?? "";
  const link = path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (fs.existsSync(link)) return link;
  const packages = path.join(local, "Microsoft", "WinGet", "Packages");
  for (const dir of fs.existsSync(packages) ? fs.readdirSync(packages) : []) {
    if (!dir.startsWith("Gyan.FFmpeg")) continue;
    for (const sub of fs.readdirSync(path.join(packages, dir))) {
      const exe = path.join(packages, dir, sub, "bin", "ffmpeg.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return "ffmpeg";
}

/** Runs docker compose in the compose root and returns its standard output */
export function compose(args: string[], input?: string): string {
  return execFileSync("docker", ["compose", ...args], {
    cwd: COMPOSE_ROOT,
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

/** Runs docker compose with the extra services of docker-compose.e2e.yml (livekit, netclient, ...) */
export function composeE2e(args: string[]): string {
  return compose(["-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml", ...args]);
}

/** Runs SQL in the database container; returns psql's unaligned, tab-separated rows */
export function sql(query: string): string {
  return compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "ret_dev", "-At", "-F", "\t", "-c", query]).trim();
}

/** A string literal for SQL */
export const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Runs Elixir code inside the reticulum container with only the database connection started
 * (`mix run --no-start`), so nothing else of reticulum starts a second time beside the running server;
 * returns what the code printed.
 */
export function elixir(code: string): string {
  const repoOnly =
    "{:ok, _} = Application.ensure_all_started(:ecto_sql); {:ok, _} = Application.ensure_all_started(:postgrex); {:ok, _} = Ret.Repo.start_link(); ";
  return compose(["exec", "-T", "reticulum", "mix", "run", "--no-compile", "--no-start", "-e", repoOnly + code]);
}

/** The commit checked out in a repository, with its branch and whether the tree has changes */
export function gitState(dir: string): { commit: string; branch: string; dirty: boolean } | { error: string } {
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
    return {
      commit: git("rev-parse", "HEAD"),
      branch: git("rev-parse", "--abbrev-ref", "HEAD"),
      dirty: git("status", "--porcelain", "--untracked-files=no") !== ""
    };
  } catch (e) {
    return { error: String(e).slice(0, 200) };
  }
}

/**
 * Plan 1.2: Dialog and the local LiveKit server announce PRIVATE_NETWORK_IP from the compose root's
 * .env. Returns a reason when that address is missing or no longer belongs to this PC.
 */
export function lanAddressProblem(): string | null {
  const envFile = path.join(COMPOSE_ROOT, ".env");
  const line = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8").split(/\r?\n/).find(l => l.startsWith("PRIVATE_NETWORK_IP="))
    : undefined;
  const address = line?.slice("PRIVATE_NETWORK_IP=".length).trim();
  if (!address) return "PRIVATE_NETWORK_IP is not set in the compose root's .env";
  const own = Object.values(os.networkInterfaces())
    .flat()
    .map(i => i?.address);
  return own.includes(address) ? null : `PRIVATE_NETWORK_IP=${address} is not an address of this PC any more`;
}

/**
 * How far reticulum's clock is behind this PC's, in seconds, read from a token the running server issues
 * (the permission token a room page gets over the hub channel). On this PC the long-running server's
 * Erlang clock falls behind the container's clock (163 s an hour after a start, 321 s 40 minutes later);
 * once it is behind by the permission token's lifetime (300 s), Dialog rejects every token as expired
 * and nobody can enter a room. A restart of reticulum resets it.
 */
export async function serverClockLag(hubId: string): Promise<number> {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.goto(`${BASE_URL}/${hubId}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => (window as any).APP?.hubChannel?.channel?.state === "joined", undefined, { timeout: 90_000 });
    return await page.evaluate(async () => {
      const reply: any = await new Promise(resolve =>
        (window as any).APP.hubChannel.channel.push("refresh_perms_token", {}).receive("ok", resolve)
      );
      const claims = JSON.parse(atob(reply.perms_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return +(Date.now() / 1000 - claims.iat).toFixed(1);
    });
  } finally {
    await browser.close();
  }
}

/** Restarts reticulum and waits until it answers again */
export async function restartReticulum() {
  compose(["restart", "reticulum"]);
  const api = await request.newContext({ ignoreHTTPSErrors: true });
  try {
    for (let i = 0; i < 60; i++) {
      const ok = await api.get(`${BASE_URL}/api/v1/meta`).then(r => r.ok()).catch(() => false);
      if (ok) return;
      await sleep(3000);
    }
    throw new Error("reticulum did not answer within 3 minutes of its restart");
  } finally {
    await api.dispose();
  }
}

// ---------- The admin settings of the toolbar's Features menu ----------

/** The app settings that each put one item into the Features menu; all off by default (ChutvrcPopoversContainer.js) */
export const FEATURE_SETTINGS = {
  recording: "features|enable_recording",
  broadcast: "features|enable_public_speaking",
  nimpro: "features|enable_nimpro"
} as const;
export type FeatureName = keyof typeof FEATURE_SETTINGS;
export type FeatureSwitches = Record<FeatureName, boolean>;
export const ALL_FEATURES_ON: FeatureSwitches = { recording: true, broadcast: true, nimpro: true };

/** Reticulum keeps app settings in caches for 10 s (:app_config) and 15 s (:app_config_value); this outlasts both */
export const APP_CONFIG_CACHE_MS = 16_000;

/** One setting's row as stored in ret0.app_configs; null when it has no row */
export type StoredSetting = { value: string | null; insertedAt: string; updatedAt: string } | null;
export type StoredFeatureSettings = Record<string, StoredSetting>;

/** What ret0.app_configs holds for the three settings, as text, so it can be put back unchanged */
export function readFeatureSettings(): StoredFeatureSettings {
  const keys = Object.values(FEATURE_SETTINGS) as string[];
  const rows = sql(`select key, coalesce(value::text, ''), inserted_at::text, updated_at::text from ret0.app_configs where key in (${keys.map(sqlText).join(", ")})`);
  const stored: StoredFeatureSettings = Object.fromEntries(keys.map(k => [k, null]));
  for (const row of rows.split("\n").filter(Boolean)) {
    const [key, value, insertedAt, updatedAt] = row.split("\t");
    stored[key] = { value: value === "" ? null : value, insertedAt, updatedAt };
  }
  return stored;
}

/** Writes the three settings as the admin page stores them, {"value": true} or {"value": false} */
export function setFeatureSettings(wanted: FeatureSwitches) {
  for (const name of Object.keys(FEATURE_SETTINGS) as FeatureName[]) {
    sql(
      `insert into ret0.app_configs (key, value, inserted_at, updated_at) values (${sqlText(FEATURE_SETTINGS[name])}, ${sqlText(JSON.stringify({ value: wanted[name] }))}::jsonb, now(), now()) ` +
        `on conflict (key) do update set value = excluded.value, updated_at = now()`
    );
  }
}

/** Puts back what readFeatureSettings() returned: the same value and times, and no row where there was none */
export function restoreFeatureSettings(stored: StoredFeatureSettings) {
  for (const [key, row] of Object.entries(stored)) {
    if (!row) {
      sql(`delete from ret0.app_configs where key = ${sqlText(key)}`);
      continue;
    }
    const value = row.value === null ? "null" : `${sqlText(row.value)}::jsonb`;
    sql(
      `insert into ret0.app_configs (key, value, inserted_at, updated_at) values (${sqlText(key)}, ${value}, ${sqlText(row.insertedAt)}::timestamp, ${sqlText(row.updatedAt)}::timestamp) ` +
        `on conflict (key) do update set value = excluded.value, inserted_at = excluded.inserted_at, updated_at = excluded.updated_at`
    );
  }
}

/**
 * What the settings held before this run. It is a file, so a run that is killed before its teardown leaves it
 * behind and the next run still knows what to put back. It holds only these three settings.
 */
const FEATURE_SETTINGS_BEFORE_RUN = path.join(EVIDENCE_DIR, ".feature-settings-before-run.json");

/** Turns the three settings on for a run, remembers what was stored, and waits out reticulum's cache when something changed */
export async function enableFeaturesForRun(): Promise<{ changed: boolean; leftOver: boolean }> {
  const leftOver = fs.existsSync(FEATURE_SETTINGS_BEFORE_RUN);
  const current = readFeatureSettings();
  if (!leftOver) {
    fs.mkdirSync(path.dirname(FEATURE_SETTINGS_BEFORE_RUN), { recursive: true });
    fs.writeFileSync(FEATURE_SETTINGS_BEFORE_RUN, JSON.stringify(current, null, 2));
  }
  const isOn = (row: StoredSetting) => !!row?.value && JSON.parse(row.value)?.value === true;
  const changed = !Object.values(current).every(isOn);
  if (changed) {
    setFeatureSettings(ALL_FEATURES_ON);
    await sleep(APP_CONFIG_CACHE_MS);
  }
  return { changed, leftOver };
}

/** Puts the settings back as they were before the run; false when there is nothing to put back */
export function restoreFeaturesAfterRun(): boolean {
  if (!fs.existsSync(FEATURE_SETTINGS_BEFORE_RUN)) return false;
  restoreFeatureSettings(JSON.parse(fs.readFileSync(FEATURE_SETTINGS_BEFORE_RUN, "utf8")) as StoredFeatureSettings);
  fs.rmSync(FEATURE_SETTINGS_BEFORE_RUN);
  return true;
}
