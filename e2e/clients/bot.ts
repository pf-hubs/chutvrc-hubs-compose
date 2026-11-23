// BOT clients (plan 2.1): extra participants on the client's own bot path (?bot=true), as
// services/hubs/scripts/bot/run-bot.js starts them, but driven by Playwright's headless Chromium with
// the launch flags of plan 2.2 instead of puppeteer (whose package the bot script would need installed).
// The bot path skips the entry UI, the microphone and input: the page plays an audio file into its
// outgoing audio and replays bot-recording.json (head and hands) through the replay component. The bot's
// renderer is replaced by a stub, so it draws nothing and costs little.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { BASE_URL, COMPOSE_ROOT } from "../lib/env";
import { MEDIA_SLOTS, clipPath, type SlotName } from "../assets/media";
import type { Evidence } from "../report/evidence";
import { CONNECTION_WATCH } from "../probes/connections";
import { COMPAT_SHIM } from "../probes/compat";
import { saveRecords, settle, watch, type Client } from "./launch";

export const BOT_RECORDING = path.join(COMPOSE_ROOT, "services", "hubs", "scripts", "bot", "bot-recording.json");

const BOT_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-features=WebRtcHideLocalIpsWithMdns"
];

export type BotOptions = {
  hubId: string;
  /** The bot's audio file: the slot's clip, so its pilot tells it apart */
  slot: SlotName;
  name?: string;
  evidence?: Evidence;
};

/** Starts a bot in the room; returns once its page has loaded and the files are given to it */
export async function launchBot(opts: BotOptions): Promise<Client> {
  const name = opts.name ?? `BOT-${opts.slot.toUpperCase()}`;
  const browser = await chromium.launch({ headless: true, args: BOT_ARGS });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: "en-US", viewport: { width: 640, height: 360 }, permissions: ["microphone", "camera"] });
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || (f => f);" });
  await context.addInitScript({ content: CONNECTION_WATCH });
  await context.addInitScript({ content: COMPAT_SHIM });
  const page = await context.newPage();
  const { log, hosts, hostCounts } = watch(context, page);
  // Only the start of the response is awaited: with several clients loading the development build at once the
  // whole document can take longer than the navigation limit, and the bot's file inputs are awaited below
  const url = `${BASE_URL}/${opts.hubId}?bot=true&allow_multi=true`;
  // One more try when the connection itself times out (seen once with eight clients starting on this PC)
  await page.goto(url, { waitUntil: "commit", timeout: 180_000 }).catch(async e => {
    log.push({ t: 0, type: "warning", text: `[e2e] first page load failed, trying again: ${(e as Error).message.split("\n")[0]}` });
    await page.goto(url, { waitUntil: "commit", timeout: 180_000 });
  });
  // As run-bot.js: a click so the page may play audio, then the audio and the recording
  await page.mouse.click(100, 100).catch(() => {});
  try {
    await page.locator("#bot-audio-input").setInputFiles(clipPath(opts.slot, "wav"), { timeout: 240_000 });
    await page.locator("#bot-data-input").setInputFiles(BOT_RECORDING);
  } catch (e) {
    // Keep what the bot that did not start shows and logged, then give up on it
    if (opts.evidence) {
      const state = await page
        .evaluate(() => ({ url: location.href, readyState: document.readyState, scripts: document.scripts.length, app: !!(window as any).APP, scene: !!(window as any).AFRAME?.scenes?.[0] }))
        .catch(err => ({ error: String(err) }));
      log.push({ t: 0, type: "warning", text: `[e2e] the bot did not take its files: ${JSON.stringify(state)}` });
      const shot = `${name}-not-started.png`;
      await page.screenshot({ path: opts.evidence.file(shot), timeout: 30_000 }).then(() => opts.evidence!.addFile(shot, "screenshot", `${name} when it did not take its files`)).catch(() => {});
      saveRecords(opts.evidence, name, log, hostCounts);
    }
    await settle(browser.close());
    throw e;
  }

  let closed = false;
  const client: Client = {
    name,
    identity: "bot",
    profile: "BOT",
    modifiers: [],
    slot: opts.slot,
    pilotHz: MEDIA_SLOTS[opts.slot].pilotHz,
    baseUrl: BASE_URL,
    roomUrl: (hubId: string, query = "") => `${BASE_URL}/${hubId}${query}`,
    context,
    page,
    log,
    hosts,
    hostCounts,
    async close() {
      if (closed) return;
      closed = true;
      await settle(browser.close());
      if (opts.evidence) saveRecords(opts.evidence, name, log, hostCounts);
    }
  };
  opts.evidence?.register(client);
  return client;
}

/** Waits until a bot has entered (the bot path adds the "entered" state itself) and joined the media server */
export async function waitBotEntered(bot: Client, timeout = 120_000) {
  await bot.page.waitForFunction(
    () => (window as any).AFRAME?.scenes?.[0]?.is("entered") && (window as any).__e2eApi?.isConnected(),
    undefined,
    { timeout }
  );
}

export function botRecordingAvailable(): boolean {
  return fs.existsSync(BOT_RECORDING);
}
