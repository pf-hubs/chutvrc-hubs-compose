// Commands against the running stack: docker compose, the database and reticulum's Elixir runtime.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, request } from "@playwright/test";
import { BASE_URL, COMPOSE_ROOT, sleep } from "./env";

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

/** Which LiveKit block the server settings point at (plan 1.4); never returns the key or secret */
export function liveKitBlock(): { block: "local" | "cloud" | "unset"; url: string | null } {
  const url = sql(`select value->>'value' from ret0.server_configs where key = 'webrtc-settings|livekit_server_url'`) || null;
  return { block: !url ? "unset" : url === "wss://hubs.local:7443" ? "local" : "cloud", url };
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
