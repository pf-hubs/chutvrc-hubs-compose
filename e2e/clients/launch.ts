// Starting a simulated client (plan 2.1, 2.2): each client is its own browser process with its own
// profile directory, as if it were a separate device. Profiles are a table so that QUEST, ANDROID,
// IOS, OLD and BOT, and the slow-device and poor-network modifiers, can be added by later steps.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, PROFILES_DIR } from "../lib/env";
import { composeE2e } from "../lib/stack";
import { CONNECTION_WATCH } from "../probes/connections";
import { COMPAT_SHIM } from "../probes/compat";
import { MEDIA_SLOTS, clipPath, type SlotName } from "../assets/media";
import type { Evidence } from "../report/evidence";
import { IWER_INIT, QUEST3_USER_AGENT } from "./motion";

export type ProfileId = "DESK" | "QUEST" | "OLD" | "OLD_QUEST";
/** What a client imitates: a profile of the table, or a BOT (clients/bot.ts) */
export type ClientKind = ProfileId | "BOT";
export type Modifier = "slow" | "poor-network";

type ProfileSpec = {
  imitates: string;
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
  }
  // ANDROID, IOS: a later step (plan 2.1; step 2 settled how each is built, see TRIALS.md)
};

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
  close(): Promise<void>;
};

export async function launchClient(opts: LaunchOptions): Promise<Client> {
  const spec = PROFILES[opts.profile];
  if (!spec) throw new Error(`profile ${opts.profile} is not implemented yet`);
  const unsupported = (opts.modifiers ?? []).filter(m => m !== "poor-network");
  if (unsupported.length) throw new Error(`modifiers (${unsupported.join(", ")}) come with a later step`);
  if (opts.modifiers?.includes("poor-network")) return launchNetClient(opts, spec);

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
  const context = await chromium.launchPersistentContext(profileDir, {
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
    // Half the window size: a long test with several clients otherwise writes gigabytes of video
    recordVideo: videoDir ? { dir: videoDir, size: { width: spec.viewport.width / 2, height: spec.viewport.height / 2 } } : undefined
  });
  const page = await prepare(context, spec, opts);
  const { log, hosts } = watch(context, page);

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
    async close() {
      if (closed) return;
      closed = true;
      // A persistent context takes its browser down when it closes, so video.saveAs() is no longer
      // possible afterwards; the finished file is moved from where Playwright wrote it instead
      const videoFile = await page.video()?.path().catch(() => undefined);
      await settle(context.close());
      if (opts.evidence) {
        opts.evidence.saveText(`${name}.console.log`, formatLog(log), "console log");
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

/** The common init scripts, the profile's and the caller's, in that order; returns the page */
async function prepare(context: BrowserContext, spec: ProfileSpec, opts: LaunchOptions): Promise<Page> {
  await context.addInitScript({ content: COMMON_INIT });
  const scripts = [...(opts.watchConnections === false ? [] : [CONNECTION_WATCH]), ...spec.initScripts, ...(opts.initScripts ?? [])];
  for (const script of scripts) await context.addInitScript({ content: script });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.evaluate(COMMON_INIT).catch(() => {});
  return page;
}

/** Collects the page's console, page errors and failed requests, and the hosts of every request */
export function watch(context: BrowserContext, page: Page): { log: LogEntry[]; hosts: Set<string> } {
  const t0 = Date.now();
  const log: LogEntry[] = [];
  const hosts = new Set<string>();
  page.on("console", msg => log.push({ t: Date.now() - t0, type: msg.type(), text: msg.text(), url: msg.location().url }));
  page.on("pageerror", err => log.push({ t: Date.now() - t0, type: "pageerror", text: String(err.stack ?? err) }));
  context.on("requestfailed", req =>
    log.push({ t: Date.now() - t0, type: "requestfailed", text: `${req.failure()?.errorText ?? "failed"} ${req.method()}`, url: req.url() })
  );
  context.on("request", req => {
    try {
      hosts.add(new URL(req.url()).host);
    } catch {
      // data: and blob: URLs have no host worth recording
    }
  });
  return { log, hosts };
}

const NETCLIENT_URL = "ws://127.0.0.1:3100";

/**
 * The poor-network modifier (plan 2.1): the profile's settings in headless Chromium inside the netclient
 * container. Its clips are copied into the container, since the browser reads them there. No video is
 * recorded (the browser is remote); screenshots work as for the others.
 */
async function launchNetClient(opts: LaunchOptions, spec: ProfileSpec): Promise<Client> {
  const name = opts.name ?? `${opts.slot.toUpperCase()}-${opts.identity}`;
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
    acceptDownloads: true
  });
  const page = await prepare(context, spec, opts);
  const { log, hosts } = watch(context, page);
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
    async close() {
      if (closed) return;
      closed = true;
      await settle(browser.close());
      if (opts.evidence) {
        opts.evidence.saveText(`${name}.console.log`, formatLog(log), "console log");
        opts.evidence.note(`${name} ran in the netclient container (poor-network modifier): software rendering, no video recorded`);
      }
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
