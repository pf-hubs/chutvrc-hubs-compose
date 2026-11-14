// Starting a simulated client (plan 2.1, 2.2): each client is its own browser process with its own
// profile directory, as if it were a separate device. Profiles are a table so that QUEST, ANDROID,
// IOS, OLD and BOT, and the slow-device and poor-network modifiers, can be added by later steps.
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import { BASE_URL, PROFILES_DIR } from "../lib/env";
import { MEDIA_SLOTS, clipPath, type SlotName } from "../assets/media";
import type { Evidence } from "../report/evidence";

export type ProfileId = "DESK";
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
  extraArgs: string[];
  /** Scripts that run before any page script, after the common ones */
  initScripts: string[];
};

export const PROFILES: Record<ProfileId, ProfileSpec> = {
  DESK: {
    imitates: "desktop browser",
    channel: "msedge",
    headless: false,
    viewport: { width: 1280, height: 720 },
    baseUrl: BASE_URL,
    extraArgs: [],
    initScripts: []
  }
  // QUEST, ANDROID, IOS, OLD, BOT: later steps (plan 2.1; step 2 settled how each is built, see TRIALS.md)
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
 *   every click (the errors are still collected).
 */
const COMMON_INIT = `
globalThis.__name = globalThis.__name || (f => f);
document.addEventListener("DOMContentLoaded", () => {
  const style = document.createElement("style");
  style.textContent = "#webpack-dev-server-client-overlay { display: none !important; }";
  document.head.appendChild(style);
});`;

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
  /** Window position on the desktop */
  position?: [number, number];
  /** One pass of plan 2.1 runs DESK on Playwright's Chromium instead of Edge */
  browser?: "msedge" | "chromium";
  /** Set-up scripts run their clients headless; tests use the profile's own setting */
  headless?: boolean;
  /** Probe scripts to run before the page's own scripts (see probes/) */
  initScripts?: string[];
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
  profile: ProfileId;
  slot: SlotName;
  pilotHz: number;
  baseUrl: string;
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
  if (opts.modifiers?.length) throw new Error(`modifiers (${opts.modifiers.join(", ")}) come with a later step`);

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

  const videoDir = opts.evidence ? opts.evidence.file(`.video-${name}`) : undefined;
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
    recordVideo: videoDir ? { dir: videoDir, size: spec.viewport } : undefined
  });
  await context.addInitScript({ content: COMMON_INIT });
  for (const script of [...spec.initScripts, ...(opts.initScripts ?? [])]) await context.addInitScript({ content: script });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.evaluate(COMMON_INIT).catch(() => {});

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

  let closed = false;
  const client: Client = {
    name,
    identity: opts.identity,
    profile: opts.profile,
    slot: opts.slot,
    pilotHz: MEDIA_SLOTS[opts.slot].pilotHz,
    baseUrl: spec.baseUrl,
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
      await context.close().catch(() => {});
      if (opts.evidence) {
        opts.evidence.saveText(`${name}.console.log`, formatLog(log), "console log");
        if (videoFile && fs.existsSync(videoFile)) {
          fs.renameSync(videoFile, opts.evidence.file(`${name}.webm`));
          opts.evidence.addFile(`${name}.webm`, "video", `${name}: what the client showed (no sound)`);
        }
        if (videoDir) fs.rmSync(videoDir, { recursive: true, force: true });
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

export function formatLog(log: LogEntry[]): string {
  return log.map(e => `${(e.t / 1000).toFixed(3).padStart(9)} ${e.type.padEnd(13)} ${e.text}${e.url ? `  <${e.url}>` : ""}`).join("\n") + "\n";
}

function requireFile(file: string): string {
  if (!fs.existsSync(file)) throw new Error(`missing ${file}: run npx tsx assets/generate.ts`);
  return file;
}
