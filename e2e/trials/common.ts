// Shared helpers for the step 2 trials (throwaway; the harness proper goes into clients/ and probes/).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { EVIDENCE_DIR, PROFILES_DIR } from "../lib/env";

export const E2E = path.resolve(import.meta.dirname, "..");
export const COMPOSE_ROOT = path.resolve(E2E, "..");
export const EVIDENCE = path.join(EVIDENCE_DIR, "trials");
export const MEDIA = path.join(EVIDENCE, "media");
export const PROFILES = PROFILES_DIR;
export const FIXTURES = path.join(E2E, "fixtures.json");
export const HOST = "hubs.local";
export const BASE = `https://${HOST}:4000`;

/** Pilot frequency and camera colour per trial client */
export const CLIENT_MEDIA: Record<string, { pilotHz: number; colour: string }> = {
  desk1: { pilotHz: 700, colour: "red" },
  desk2: { pilotHz: 1100, colour: "green" },
  desk3: { pilotHz: 1500, colour: "blue" },
  desk4: { pilotHz: 1900, colour: "orange" },
  desk5: { pilotHz: 2300, colour: "purple" },
  desk6: { pilotHz: 2700, colour: "teal" },
  quest1: { pilotHz: 900, colour: "navy" },
  net1: { pilotHz: 1300, colour: "maroon" },
  old1: { pilotHz: 1700, colour: "olive" }
};

export function ffmpegPath(): string {
  const local = process.env.LOCALAPPDATA ?? "";
  const links = path.join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  if (fs.existsSync(links)) return links;
  const pkgs = path.join(local, "Microsoft", "WinGet", "Packages");
  for (const dir of fs.existsSync(pkgs) ? fs.readdirSync(pkgs) : []) {
    if (!dir.startsWith("Gyan.FFmpeg")) continue;
    for (const sub of fs.readdirSync(path.join(pkgs, dir))) {
      const exe = path.join(pkgs, dir, sub, "bin", "ffmpeg.exe");
      if (fs.existsSync(exe)) return exe;
    }
  }
  return "ffmpeg";
}

/** Launch flags of plan 2.2, with the client's own fake microphone and camera files */
export function chromiumArgs(client: string, extra: string[] = []): string[] {
  const wav = path.join(MEDIA, `${client}.wav`);
  const y4m = path.join(MEDIA, `${client}.y4m`);
  if (!fs.existsSync(wav)) throw new Error(`missing ${wav}: run trials/make-media.ts`);
  return [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-audio-capture=${wav}`,
    `--use-file-for-fake-video-capture=${y4m}`,
    ...extra
  ];
}

export type LaunchOpts = {
  channel?: "msedge" | "chromium";
  headless?: boolean;
  extraArgs?: string[];
  userAgent?: string;
  viewport?: { width: number; height: number } | null;
  position?: [number, number];
  profile?: string;
  /** Scripts added before any page script runs, in order */
  initScripts?: Array<string | { path: string }>;
};

/**
 * tsx compiles with esbuild's keepNames, which wraps named functions in a __name(...) call; functions
 * passed to page.evaluate carry that call into the page, so every page gets a no-op __name first.
 */
export const NAME_SHIM =
  "globalThis.__name = globalThis.__name || ((f) => f);" +
  // The development build's error overlay (webpack-dev-server) covers the page on any uncaught error,
  // e.g. a "ResizeObserver loop" message in WebKit, and takes every click; errors are collected anyway
  "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style');" +
  " s.textContent = '#webpack-dev-server-client-overlay { display: none !important; }'; document.head.appendChild(s); });";

/** A client as its own browser process with its own profile directory (plan 2.1) */
export async function launchClient(client: string, opts: LaunchOpts = {}): Promise<BrowserContext> {
  const dir = path.join(PROFILES, opts.profile ?? `trial-${client}`);
  fs.mkdirSync(dir, { recursive: true });
  const extra = [...(opts.extraArgs ?? [])];
  if (opts.position) extra.push(`--window-position=${opts.position[0]},${opts.position[1]}`);
  const context = await chromium.launchPersistentContext(dir, {
    channel: opts.channel === "chromium" ? undefined : (opts.channel ?? "msedge"),
    headless: opts.headless ?? false,
    args: chromiumArgs(client, extra),
    viewport: opts.viewport === undefined ? { width: 1280, height: 720 } : opts.viewport,
    ignoreHTTPSErrors: true,
    // Edge on this PC runs in Japanese; the client follows navigator.language, and the selectors are English
    locale: "en-US",
    userAgent: opts.userAgent,
    permissions: ["microphone", "camera"]
  });
  await context.addInitScript({ content: NAME_SHIM });
  for (const page of context.pages()) await page.evaluate(NAME_SHIM).catch(() => {});
  for (const script of opts.initScripts ?? []) {
    await context.addInitScript(typeof script === "string" ? { content: script } : script);
  }
  return context;
}

export async function firstPage(context: BrowserContext): Promise<Page> {
  return context.pages()[0] ?? (await context.newPage());
}

/** Collects console errors and page exceptions of a page into an array */
export function collectErrors(page: Page, into: string[] = []): string[] {
  page.on("console", msg => {
    if (msg.type() === "error") into.push(`console: ${msg.text().slice(0, 300)}`);
  });
  page.on("pageerror", err => into.push(`pageerror: ${String(err).slice(0, 300)}`));
  return into;
}

export type EntryTimings = { load: number; joinVisible: number; profile: number; mic: number; entered: number };

/**
 * Enters a room through the real UI: Join Room, the name and avatar step (only shown until the profile
 * is accepted once), the microphone setup, Enter Room. Returns how long each step took, in ms.
 */
export async function enterRoom(
  page: Page,
  hubId: string,
  {
    displayName,
    query = "",
    timeout = 240_000,
    base = BASE,
    waitForEntered = true
  }: { displayName: string; query?: string; timeout?: number; base?: string; waitForEntered?: boolean }
): Promise<EntryTimings> {
  const t0 = Date.now();
  await page.goto(`${base}/${hubId}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const load = Date.now() - t0;
  const join = page.getByRole("button", { name: "Join Room" });
  await join.waitFor({ state: "visible", timeout });
  const joinVisible = Date.now() - t0;
  await join.click();

  // Either the profile step or the microphone step comes next
  const accept = page.getByRole("button", { name: "Accept" });
  const enter = page.getByRole("button", { name: "Enter Room" });
  await accept.or(enter).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await accept.isVisible()) {
    await page.getByLabel("Display Name").fill(displayName);
    await accept.click();
  }
  const profile = Date.now() - t0;
  await enter.waitFor({ state: "visible", timeout: 60_000 });
  await expectEnabled(page, "Enter Room");
  const mic = Date.now() - t0;
  await enter.click();
  if (waitForEntered) await waitEntered(page, 60_000);
  return { load, joinVisible, profile, mic, entered: Date.now() - t0 };
}

async function expectEnabled(page: Page, text: string) {
  await page.waitForFunction(
    text => {
      const b = [...document.querySelectorAll("button")].find(x => x.textContent?.trim() === text);
      return !!b && !(b as HTMLButtonElement).disabled;
    },
    text,
    { timeout: 60_000 }
  );
}

export async function waitEntered(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as any).AFRAME?.scenes?.[0]?.is("entered"), undefined, { timeout });
}

/** requestAnimationFrame rate and renderer frames per second over `ms` */
export async function measureFps(page: Page, ms = 3000): Promise<{ raf: number; rendered: number }> {
  return page.evaluate(
    ms =>
      new Promise<{ raf: number; rendered: number }>(resolve => {
        const renderer = (window as any).AFRAME?.scenes?.[0]?.renderer;
        const f0 = renderer?.info?.render?.frame ?? 0;
        let n = 0;
        const t0 = performance.now();
        const tick = (t: number) => {
          n++;
          if (t - t0 < ms) requestAnimationFrame(tick);
          else {
            const s = (t - t0) / 1000;
            const f1 = renderer?.info?.render?.frame ?? 0;
            resolve({ raf: +(n / s).toFixed(1), rendered: +((f1 - f0) / s).toFixed(1) });
          }
        };
        requestAnimationFrame(tick);
      }),
    ms
  );
}

/** The WebGL renderer string the page's GPU process reports */
export async function webglRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return "no webgl";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
}

/** Creates a room anonymously through the API the home page uses; returns its id */
export async function createRoom(page: Page, name: string): Promise<string> {
  const res = await page.request.post(`${BASE}/api/v1/hubs`, {
    data: { hub: { name } },
    headers: { "content-type": "application/json" }
  });
  if (!res.ok()) throw new Error(`create room: ${res.status()} ${await res.text()}`);
  const body = await res.json();
  return body.hub_id as string;
}

export function readFixtures(): any {
  if (fs.existsSync(FIXTURES)) return JSON.parse(fs.readFileSync(FIXTURES, "utf8"));
  return JSON.parse(fs.readFileSync(path.join(E2E, "fixtures.example.json"), "utf8"));
}

export function writeFixtures(fixtures: any) {
  fs.writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2) + "\n");
}

/** A room for a trial, created once and kept in fixtures.json under "trials" */
export async function trialRoom(page: Page, key: string): Promise<string> {
  const fixtures = readFixtures();
  fixtures.trials ??= {};
  if (fixtures.trials[key]) return fixtures.trials[key];
  const hubId = await createRoom(page, `trial ${key}`);
  fixtures.trials[key] = hubId;
  writeFixtures(fixtures);
  return hubId;
}

/** Runs docker compose in the compose root and returns its output */
export function compose(args: string[], input?: string): string {
  return execFileSync("docker", ["compose", ...args], { cwd: COMPOSE_ROOT, encoding: "utf8", input });
}

/** Runs SQL in the database container and returns psql's unaligned, tab-separated output */
export function sql(query: string): string {
  return compose(["exec", "-T", "db", "psql", "-U", "postgres", "-d", "ret_dev", "-At", "-F", "\t", "-c", query]).trim();
}

export function save(name: string, data: unknown) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, name), typeof data === "string" ? data : JSON.stringify(data, null, 2));
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
