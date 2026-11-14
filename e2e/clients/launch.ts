// Starting a simulated client (plan 2.1, 2.2): each client is its own browser process with its own
// profile directory, as if it were a separate device. Profiles are a table: DESK, QUEST, OLD, OLD_QUEST,
// ANDROID and IOS (iPhone and iPad descriptors); BOT is in clients/bot.ts. The modifiers: slow device (the
// CPU throttled) and poor network (the browser inside the netclient container, its link shaped).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, devices, webkit, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { BASE_URL, PROFILES_DIR } from "../lib/env";
import { composeE2e } from "../lib/stack";
import { CONNECTION_WATCH } from "../probes/connections";
import { COMPAT_SHIM } from "../probes/compat";
import { MEDIA_SLOTS, clipPath, type SlotName } from "../assets/media";
import type { Evidence } from "../report/evidence";
import { IWER_INIT, QUEST3_USER_AGENT } from "./motion";
import { pilotMicrophone } from "./pilot-mic";

export type ProfileId = "DESK" | "QUEST" | "OLD" | "OLD_QUEST" | "ANDROID" | "IOS" | "IOS_IPAD";
/** What a client imitates: a profile of the table, or a BOT (clients/bot.ts) */
export type ClientKind = ProfileId | "BOT";
export type Modifier = "slow" | "poor-network";

type ProfileSpec = {
  imitates: string;
  /**
   * "webkit": Playwright's Linux WebKit inside the netclient container (webkit.connect), the only WebKit on
   * this PC with Web Audio, getUserMedia and WebRTC (TRIALS.md, trial c); every other profile is Chromium
   */
  engine?: "chromium" | "webkit";
  /** The descriptor's screen size (portrait), for orientation changes (clients/touch.ts) */
  screen?: { width: number; height: number };
  /** Playwright channel: "msedge" for installed Edge, undefined for Playwright's own Chromium */
  channel: "msedge" | undefined;
  headless: boolean;
  viewport: { width: number; height: number };
  userAgent?: string;
  isMobile?: boolean;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
  baseUrl: string;
  /** The page that opens a room; `query` is a query string such as "?force_tcp" */
  roomUrl: (hubId: string, query?: string) => string;
  extraArgs: string[];
  /** Scripts that run before any page script, after the common ones */
  initScripts: string[];
};

/** The room page as reticulum serves it: the current build */
const ownRoomUrl = (hubId: string, query = "") => `${BASE_URL}/${hubId}${query}`;

/**
 * The OLD profile's client: hubs feature/sfu-refactor served by hubs-client-old on 8082. Its pages load
 * their scripts from https://hubs.local:8080/ (its BASE_ASSETS_PATH), which on the host is the current
 * client, so its browser maps hubs.local:8080 to 127.0.0.1:8082 and opens the dev server's own room page
 * through that name, an origin reticulum already allows (TRIALS.md, trial e).
 */
export const OLD_BASE_URL = "https://hubs.local:8080";

export const PROFILES: Record<ProfileId, ProfileSpec> = {
  DESK: {
    imitates: "desktop browser",
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 720 },
    baseUrl: BASE_URL,
    roomUrl: ownRoomUrl,
    extraArgs: [],
    initScripts: []
  },
  // Plan 2.1: DESK with IWER installed before the page's scripts and the Quest Browser's user agent, so
  // AFRAME.utils.device.isMobileVR() is true and Enter Room starts the immersive session IWER provides.
  // The headset and controllers are moved by clients/motion.ts (TRIALS.md, trial b).
  QUEST: {
    imitates: "Quest 3 headset in the Meta Quest Browser (IWER emulating the headset and controllers)",
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent: QUEST3_USER_AGENT,
    baseUrl: BASE_URL,
    roomUrl: ownRoomUrl,
    extraArgs: [],
    initScripts: [IWER_INIT]
  },
  OLD: {
    imitates: "a browser still on the previous build (hubs feature/sfu-refactor, served by hubs-client-old)",
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 720 },
    baseUrl: OLD_BASE_URL,
    roomUrl: (hubId, query = "") => `${OLD_BASE_URL}/hub.html?hub_id=${hubId}${query ? `&${query.replace(/^\?/, "")}` : ""}`,
    extraArgs: ["--host-resolver-rules=MAP hubs.local:8080 127.0.0.1:8082"],
    initScripts: []
  },
  // A headset still on the previous build: the OLD profile's page with the QUEST profile's emulation (T4.1)
  OLD_QUEST: {
    imitates: "a Quest 3 headset still on the previous build (OLD with IWER and the Quest Browser's user agent)",
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 720 },
    userAgent: QUEST3_USER_AGENT,
    baseUrl: OLD_BASE_URL,
    roomUrl: (hubId, query = "") => `${OLD_BASE_URL}/hub.html?hub_id=${hubId}${query ? `&${query.replace(/^\?/, "")}` : ""}`,
    extraArgs: ["--host-resolver-rules=MAP hubs.local:8080 127.0.0.1:8082"],
    initScripts: [IWER_INIT]
  },
  // Plan 2.1: Edge with Playwright's Pixel 7 descriptor (touch, screen size, pixel ratio, Chrome on Android's
  // user agent), so AFRAME.utils.device.isMobile() is true and the client shows its on-screen joysticks.
  // Driven by touch through the DevTools protocol (clients/touch.ts). The clips are its fake devices, as on DESK.
  ANDROID: {
    imitates: "Android phone in Chrome (Pixel 7 descriptor in Edge)",
    channel: "msedge",
    headless: false,
    ...descriptor("Pixel 7"),
    baseUrl: BASE_URL,
    roomUrl: ownRoomUrl,
    extraArgs: [],
    initScripts: []
  },
  // Plan 2.1, cut to what works (TRIALS.md, trial c): Playwright's WebKit for Windows has no Web Audio,
  // getUserMedia or WebRTC, so the IOS profiles run Linux WebKit inside the netclient container with an
  // iPhone or an iPad descriptor; software rendering. WebKit's mock microphone plays no clip, so the page's
  // getUserMedia gets the slot's pilot beep from Web Audio instead (clients/pilot-mic.ts).
  IOS: {
    imitates: "iPhone in Safari (iPhone 15 descriptor in Linux WebKit, netclient container)",
    engine: "webkit",
    channel: undefined,
    headless: true,
    ...descriptor("iPhone 15"),
    baseUrl: BASE_URL,
    roomUrl: ownRoomUrl,
    extraArgs: [],
    initScripts: []
  },
  IOS_IPAD: {
    imitates: "iPad in Safari (iPad (gen 7) descriptor in Linux WebKit, netclient container)",
    engine: "webkit",
    channel: undefined,
    headless: true,
    ...descriptor("iPad (gen 7)"),
    baseUrl: BASE_URL,
    roomUrl: ownRoomUrl,
    extraArgs: [],
    initScripts: []
  }
};

/** The parts of a Playwright device descriptor a profile takes */
function descriptor(name: string): Pick<ProfileSpec, "viewport" | "screen" | "userAgent" | "isMobile" | "hasTouch" | "deviceScaleFactor"> {
  const d = devices[name] as (typeof devices)[string] & { screen?: { width: number; height: number } };
  if (!d) throw new Error(`Playwright has no device descriptor "${name}"`);
  return { viewport: d.viewport, screen: d.screen, userAgent: d.userAgent, isMobile: d.isMobile, hasTouch: d.hasTouch, deviceScaleFactor: d.deviceScaleFactor };
}

/** Profiles that are phones or tablets, driven by touch */
export const TOUCH_PROFILES: ClientKind[] = ["ANDROID", "IOS", "IOS_IPAD"];
export const isTouchClient = (c: { profile: ClientKind }) => TOUCH_PROFILES.includes(c.profile);
/** Profiles that run on WebKit (no DevTools protocol: touch drags are dispatched in the page) */
export const isWebKitClient = (c: { profile: ClientKind }) => c.profile === "IOS" || c.profile === "IOS_IPAD";

/** The slow-device modifier (plan 2.1): Emulation.setCPUThrottlingRate at this rate */
export const SLOW_CPU_RATE = 4;

/** Plan 2.2: the same for every Chromium-based client */
const COMMON_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=WebRtcHideLocalIpsWithMdns"
];

/**
 * Before the page's own scripts:
 * - a no-op __name: tsx (esbuild keepNames) wraps named functions in __name(...), which page.evaluate
 *   would otherwise carry into a page that does not define it;
 * - the development build's error overlay is hidden: it covers the page on any uncaught error and takes
 *   every click (the errors are still collected);
 * - window.__e2eApi, the capability layer the probes read the client through (probes/compat.ts);
 * - unhandled promise rejections are logged with their reason ([e2e] unhandled rejection).
 */
const COMMON_INIT = `
globalThis.__name = globalThis.__name || (f => f);
// A rejected promise nobody handles is reported as "Uncaught (in promise) #<Object>" for a plain object; this names its content
window.addEventListener("unhandledrejection", e => {
  let reason;
  try {
    reason = e.reason instanceof Error ? e.reason.message : JSON.stringify(e.reason);
  } catch (err) {
    reason = String(e.reason);
  }
  console.warn("[e2e] unhandled rejection: " + String(reason).slice(0, 300));
});
// WebKit reports some uncaught errors to Playwright without a message; this names them
window.addEventListener("error", e => {
  if (e.error === undefined || e.error === null) console.warn("[e2e] window error without an error object: " + String(e.message).slice(0, 300) + " at " + (e.filename || "?") + ":" + e.lineno);
});
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = "#webpack-dev-server-client-overlay { display: none !important; }";
  document.head.appendChild(style);
});
${COMPAT_SHIM}`;

export type LaunchOptions = {
  profile: ProfileId;
  /** The account this client signs in as; with the profile it names the profile directory */
  identity: string;
  /** Media slot: the client's pilot frequency, clip and camera colour */
  slot: SlotName;
  /** Label in evidence file names; defaults to the slot letter and identity, e.g. "A-admin" */
  name?: string;
  /** Overrides of the slot's clips; false leaves that device to the real one (virtual cable, OBS camera) */
  mic?: SlotName | false;
  cam?: SlotName | false;
  /** Where video and console log go; the evidence also closes the client when the test ends */
  evidence?: Evidence;
  /** Playwright's video of the window (on by default when there is evidence); off where a test records the page itself (T5's observers) */
  recordVideo?: boolean;
  /** Window position on the desktop */
  position?: [number, number];
  /** One pass of plan 2.1 runs DESK on Playwright's Chromium instead of Edge */
  browser?: "msedge" | "chromium";
  /** Set-up scripts run their clients headless; tests use the profile's own setting */
  headless?: boolean;
  /** Probe scripts to run before the page's own scripts (see probes/) */
  initScripts?: string[];
  /** The connections probe's wrapper around RTCPeerConnection (probes/connections.ts); on unless false */
  watchConnections?: boolean;
  /**
   * "poor-network": headless Chromium inside the netclient container (plan 2.1), reached over
   * ws://127.0.0.1:3100; its link is shaped with clients/network.ts. Renders in software: never used
   * for rate assertions. Not signed in (the container's browser has no profile directory).
   * "slow": the page's CPU throttled SLOW_CPU_RATE times through the DevTools protocol (Chromium profiles).
   */
  modifiers?: Modifier[];
};

export type LogEntry = {
  /** Milliseconds since the client started */
  t: number;
  type: "error" | "warning" | "info" | "log" | "debug" | "pageerror" | "requestfailed" | "request" | string;
  text: string;
  url?: string;
};

export type Client = {
  name: string;
  identity: string;
  profile: ClientKind;
  /** The modifiers it was started with */
  modifiers: Modifier[];
  slot: SlotName;
  pilotHz: number;
  baseUrl: string;
  /** The page that opens a room in this client's build */
  roomUrl: (hubId: string, query?: string) => string;
  context: BrowserContext;
  page: Page;
  /** Console messages, page errors and failed requests, in order */
  log: LogEntry[];
  /** Hosts of every request the client made (for the reticulum.io check of T6.8) */
  hosts: Set<string>;
  /** How many requests went to each host (saved with the evidence; T6.8 scans them across the run) */
  hostCounts: Map<string, number>;
  /** When its browser context (and so its video) started, PC clock; for lining up videos */
  startedAt?: number;
  /** The CPU throttling rate the slow-device modifier set; undefined when not slowed */
  cpuRate?: number;
  close(): Promise<void>;
};

export async function launchClient(opts: LaunchOptions): Promise<Client> {
  const spec = PROFILES[opts.profile];
  if (!spec) throw new Error(`profile ${opts.profile} is not implemented yet`);
  if (spec.engine === "webkit") {
    if (opts.modifiers?.length) throw new Error(`the ${opts.profile} profile takes no modifiers: it already runs in the netclient container, on WebKit`);
    return launchWebKitClient(opts, spec);
  }
  const client = opts.modifiers?.includes("poor-network") ? await launchNetClient(opts, spec) : await launchLocalClient(opts, spec);
  if (opts.modifiers?.includes("slow")) await throttleCpu(client, SLOW_CPU_RATE);
  return client;
}

/**
 * The slow-device modifier: the page's CPU throttled as DevTools' "4x slowdown" does, through the DevTools
 * protocol. It is set on the page's target, so it stays through the page's navigations.
 */
export async function throttleCpu(client: Client, rate: number) {
  const cdp: CDPSession = await client.context.newCDPSession(client.page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  client.cpuRate = rate;
}

async function launchLocalClient(opts: LaunchOptions, spec: ProfileSpec): Promise<Client> {
  const name = opts.name ?? `${opts.slot.toUpperCase()}-${opts.identity}`;
  const profileDir = path.join(PROFILES_DIR, `${opts.profile.toLowerCase()}-${opts.identity}`);
  fs.mkdirSync(profileDir, { recursive: true });

  const mic = opts.mic ?? opts.slot;
  const cam = opts.cam ?? opts.slot;
  const media: string[] = [];
  if (mic !== false || cam !== false) media.push("--use-fake-device-for-media-stream");
  if (mic !== false) media.push(`--use-file-for-fake-audio-capture=${requireFile(clipPath(mic, "wav"))}`);
  if (cam !== false) media.push(`--use-file-for-fake-video-capture=${requireFile(clipPath(cam, "y4m"))}`);
  const position = opts.position ? [`--window-position=${opts.position[0]},${opts.position[1]}`] : [];

  const videoDir = opts.evidence && opts.recordVideo !== false ? opts.evidence.file(`.video-${name}`) : undefined;
  const startedAt = Date.now();
  // Once, with several windows and the bots starting together, an Edge did not finish starting in 3 minutes
  // (its network service crashing over and over); a second start of the same profile then works
  const launch = () => chromium.launchPersistentContext(profileDir, {
    channel: (opts.browser ?? spec.channel) === "chromium" ? undefined : spec.channel,
    headless: opts.headless ?? spec.headless,
    args: [...COMMON_ARGS, ...media, ...position, ...spec.extraArgs],
    viewport: spec.viewport,
    userAgent: spec.userAgent,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
    deviceScaleFactor: spec.deviceScaleFactor,
    // Edge on this PC runs in Japanese; the client follows navigator.language and the selectors are English
    locale: "en-US",
    ignoreHTTPSErrors: true,
    permissions: ["microphone", "camera"],
    acceptDownloads: true,
    recordVideo: videoDir ? { dir: videoDir, size: videoSize(spec) } : undefined,
    timeout: 120_000
  });
  const context = await launch().catch(async e => {
    opts.evidence?.note(`${name}: the browser did not start (${(e as Error).message.split("\n")[0]}); started once more`);
    return launch();
  });
  const page = await prepare(context, spec, opts);
  const { log, hosts, hostCounts } = watch(context, page);

  let closed = false;
  const client: Client = {
    name,
    identity: opts.identity,
    profile: opts.profile,
    modifiers: opts.modifiers ?? [],
    slot: opts.slot,
    pilotHz: MEDIA_SLOTS[opts.slot].pilotHz,
    baseUrl: spec.baseUrl,
    roomUrl: spec.roomUrl,
    context,
    page,
    log,
    hosts,
    hostCounts,
    startedAt,
    async close() {
      if (closed) return;
      closed = true;
      // A persistent context takes its browser down when it closes, so video.saveAs() is no longer
      // possible afterwards; the finished file is moved from where Playwright wrote it instead
      const videoFile = await page.video()?.path().catch(() => undefined);
      await settle(context.close());
      if (opts.evidence) {
        saveRecords(opts.evidence, name, log, hostCounts);
        if (videoFile && fs.existsSync(videoFile)) {
          // A browser that did not finish closing may still hold the file: then a copy, or a note
          try {
            fs.renameSync(videoFile, opts.evidence.file(`${name}.webm`));
          } catch {
            try {
              fs.copyFileSync(videoFile, opts.evidence.file(`${name}.webm`));
            } catch (e) {
              opts.evidence.note(`${name}: video not saved (${(e as Error).message.split("\n")[0]})`);
            }
          }
          if (fs.existsSync(opts.evidence.file(`${name}.webm`))) opts.evidence.addFile(`${name}.webm`, "video", `${name}: what the client showed (no sound)`);
        }
        try {
          if (videoDir) fs.rmSync(videoDir, { recursive: true, force: true, maxRetries: 3 });
        } catch {
          // Still held by a browser that did not finish closing; the empty folder is harmless
        }
      }
    }
  };
  opts.evidence?.register(client);
  return client;
}

/** Half the window size, in even numbers for the encoder: a long test with several clients otherwise writes gigabytes of video */
const videoSize = (spec: ProfileSpec) => ({ width: 2 * Math.round(spec.viewport.width / 4), height: 2 * Math.round(spec.viewport.height / 4) });

/** The common init scripts, the profile's and the caller's, in that order; returns the page */
async function prepare(context: BrowserContext, spec: ProfileSpec, opts: LaunchOptions): Promise<Page> {
  await context.addInitScript({ content: COMMON_INIT });
  const scripts = [...(opts.watchConnections === false ? [] : [CONNECTION_WATCH]), ...spec.initScripts, ...(opts.initScripts ?? [])];
  for (const script of scripts) await context.addInitScript({ content: script });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.evaluate(COMMON_INIT).catch(() => {});
  return page;
}

/** Collects the page's console, page errors and failed requests, and the hosts of every request with their counts */
export function watch(context: BrowserContext, page: Page): { log: LogEntry[]; hosts: Set<string>; hostCounts: Map<string, number> } {
  const t0 = Date.now();
  const log: LogEntry[] = [];
  const hosts = new Set<string>();
  const hostCounts = new Map<string, number>();
  // WebKit hands some uncaught errors to Playwright without any text; the page's own error listener (COMMON_INIT)
  // logs their message, which is copied onto the empty page error that comes just before or after it
  const NAMED = "[e2e] window error without an error object: ";
  page.on("console", msg => {
    const entry: LogEntry = { t: Date.now() - t0, type: msg.type(), text: msg.text(), url: msg.location().url };
    log.push(entry);
    if (entry.text.startsWith(NAMED)) {
      const blank = [...log].reverse().find(e => e.type === "pageerror" && !e.text && entry.t - e.t < 500);
      if (blank) blank.text = entry.text.slice(NAMED.length);
    }
  });
  page.on("pageerror", err => {
    let text = String(err.stack || err.message || err);
    if (!text || text === "Error") {
      const named = [...log].reverse().find(e => e.text.startsWith(NAMED) && Date.now() - t0 - e.t < 500);
      text = named ? named.text.slice(NAMED.length) : "";
    }
    log.push({ t: Date.now() - t0, type: "pageerror", text });
  });
  context.on("requestfailed", req =>
    log.push({ t: Date.now() - t0, type: "requestfailed", text: `${req.failure()?.errorText ?? "failed"} ${req.method()}`, url: req.url() })
  );
  context.on("request", req => {
    try {
      const host = new URL(req.url()).host;
      if (!host) return;
      hosts.add(host);
      hostCounts.set(host, (hostCounts.get(host) ?? 0) + 1);
    } catch {
      // data: and blob: URLs have no host worth recording
    }
  });
  return { log, hosts, hostCounts };
}

/**
 * What every client leaves in its test's folder, for the run-wide scans of T6.8 and T6.10
 * (report/run-scans.ts): its console log and the hosts it sent requests to, with how many each
 */
export function saveRecords(evidence: Evidence, name: string, log: LogEntry[], hostCounts: Map<string, number>) {
  evidence.saveText(`${name}.console.log`, formatLog(log), "console log");
  evidence.saveJson(`${name}.hosts.json`, Object.fromEntries([...hostCounts.entries()].sort((a, b) => b[1] - a[1])), `${name}: hosts it sent requests to, with counts`);
}

const NETCLIENT_URL = "ws://127.0.0.1:3100";

/**
 * The poor-network modifier (plan 2.1): the profile's settings in headless Chromium inside the netclient
 * container. Its clips are copied into the container, since the browser reads them there. Its video is
 * recorded in the container and fetched when the client closes; screenshots work as for the others.
 */
async function launchNetClient(opts: LaunchOptions, spec: ProfileSpec): Promise<Client> {
  const container = composeE2e(["ps", "-q", "netclient"]).trim();
  if (!container) throw new Error("the netclient service is not running: docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d netclient");
  const mic = opts.mic ?? opts.slot;
  const cam = opts.cam ?? opts.slot;
  const args = [...COMMON_ARGS];
  if (mic !== false || cam !== false) args.push("--use-fake-device-for-media-stream");
  for (const [slot, kind] of [
    [mic, "wav"],
    [cam, "y4m"]
  ] as const) {
    if (slot === false) continue;
    execFileSync("docker", ["cp", requireFile(clipPath(slot, kind)), `${container}:/tmp/${slot}.${kind}`]);
    args.push(`--use-file-for-fake-${kind === "wav" ? "audio" : "video"}-capture=/tmp/${slot}.${kind}`);
  }
  const browser: Browser = await chromium.connect(NETCLIENT_URL, {
    headers: { "x-playwright-launch-options": JSON.stringify({ args }) },
    timeout: 60_000
  });
  const context = await browser.newContext({
    viewport: spec.viewport,
    userAgent: spec.userAgent,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
    deviceScaleFactor: spec.deviceScaleFactor,
    locale: "en-US",
    ignoreHTTPSErrors: true,
    permissions: ["microphone", "camera"],
    acceptDownloads: true,
    recordVideo: opts.evidence && opts.recordVideo !== false && process.env.E2E_REMOTE_VIDEO !== "0" ? { dir: "/tmp/e2e-video", size: videoSize(spec) } : undefined
  });
  const page = await prepare(context, spec, opts);
  return remoteClient(opts, spec, browser, context, page, "the netclient container (poor-network modifier): headless Chromium, software rendering");
}

/**
 * The IOS profiles (plan 2.1, TRIALS.md trial c): Playwright's Linux WebKit inside the netclient container
 * with the profile's iPhone or iPad descriptor. WebKit's mock camera stays; the microphone is replaced by
 * the slot's pilot beep (clients/pilot-mic.ts), since this WebKit cannot play a clip file as a microphone.
 */
async function launchWebKitClient(opts: LaunchOptions, spec: ProfileSpec): Promise<Client> {
  const container = composeE2e(["ps", "-q", "netclient"]).trim();
  if (!container) throw new Error("the netclient service is not running: docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d netclient");
  // WebKit starts slowly in the container while several browsers start on this PC at once (seen: over 60 s)
  const browser: Browser = await webkit.connect(NETCLIENT_URL, { timeout: 240_000 });
  const context = await browser.newContext({
    viewport: spec.viewport,
    screen: spec.screen,
    userAgent: spec.userAgent,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
    deviceScaleFactor: spec.deviceScaleFactor,
    locale: "en-US",
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    recordVideo: opts.evidence && opts.recordVideo !== false && process.env.E2E_REMOTE_VIDEO !== "0" ? { dir: "/tmp/e2e-video", size: videoSize(spec) } : undefined
  });
  // WebKit grants the mock devices without asking here; the permission names are not all known to it
  await context.grantPermissions(["microphone", "camera"]).catch(() => {});
  const page = await prepare(context, spec, { ...opts, initScripts: [pilotMicrophone(MEDIA_SLOTS[opts.slot].pilotHz), ...(opts.initScripts ?? [])] });
  return remoteClient(opts, spec, browser, context, page, "the netclient container: Linux WebKit, software rendering, the slot's pilot as its microphone");
}

/** A client whose browser runs in the netclient container: its video is fetched from there when it closes */
function remoteClient(opts: LaunchOptions, spec: ProfileSpec, browser: Browser, context: BrowserContext, page: Page, where: string): Client {
  const name = opts.name ?? `${opts.slot.toUpperCase()}-${opts.identity}`;
  const { log, hosts, hostCounts } = watch(context, page);
  let closed = false;
  const client: Client = {
    name,
    identity: opts.identity,
    profile: opts.profile,
    modifiers: opts.modifiers ?? [],
    slot: opts.slot,
    pilotHz: MEDIA_SLOTS[opts.slot].pilotHz,
    baseUrl: spec.baseUrl,
    roomUrl: spec.roomUrl,
    context,
    page,
    log,
    hosts,
    hostCounts,
    startedAt: Date.now(),
    async close() {
      if (closed) return;
      closed = true;
      const video = page.video();
      await settle(context.close());
      if (opts.evidence) {
        saveRecords(opts.evidence, name, log, hostCounts);
        if (video) {
          const file = opts.evidence.file(`${name}.webm`);
          await Promise.race([video.saveAs(file), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 60_000))])
            .then(() => opts.evidence!.addFile(`${name}.webm`, "video", `${name}: what the client showed (no sound; recorded in the container)`))
            .catch(e => opts.evidence!.note(`${name}: video not saved (${(e as Error).message.split("\n")[0]})`));
          await video.delete().catch(() => {});
        }
        opts.evidence.note(`${name} ran in ${where}`);
      }
      await settle(browser.close());
    }
  };
  opts.evidence?.register(client);
  return client;
}

/** Starts several clients at once; plan 2.2 lets them load together */
export function launchClients(list: LaunchOptions[]): Promise<Client[]> {
  return Promise.all(list.map(launchClient));
}

/**
 * Waits for a closing browser or context, but not for ever: a page stuck in a reconnect loop can keep
 * close() from returning, and the evidence of the remaining clients still has to be saved.
 */
export function settle(closing: Promise<unknown>, ms = 30_000): Promise<void> {
  return Promise.race([closing.then(() => {}, () => {}), new Promise<void>(r => setTimeout(r, ms))]);
}

export function formatLog(log: LogEntry[]): string {
  return log.map(e => `${(e.t / 1000).toFixed(3).padStart(9)} ${e.type.padEnd(13)} ${e.text}${e.url ? `  <${e.url}>` : ""}`).join("\n") + "\n";
}

function requireFile(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}: run npx tsx assets/generate.ts`);
  return file;
}
