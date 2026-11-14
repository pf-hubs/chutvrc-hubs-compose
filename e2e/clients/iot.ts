// IOT client (plan 2.1): services/hubs/docs/device-simulator.html, the libpeer device simulator, in an
// Edge window. It joins the room's hub channel on reticulum's socket, offers a WebRTC data channel to the
// clients in the room (the one that answers first bridges it), and sends and shows messages.
// The simulator is written into a page of the room's origin, so its socket to reticulum has an origin
// reticulum accepts; it loads the Phoenix client from cdn.jsdelivr.net itself.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { BASE_URL, COMPOSE_ROOT, HOST } from "../lib/env";
import type { Evidence } from "../report/evidence";
import { saveRecords, settle, watch, type Client } from "./launch";

export const DEVICE_SIMULATOR = path.join(COMPOSE_ROOT, "services", "hubs", "docs", "device-simulator.html");
/** Any page of reticulum's origin; its JSON is replaced by the simulator */
const PAGE_URL = `${BASE_URL}/api/v1/meta`;

export type DeviceSimulator = {
  client: Client;
  /** Connect with the hub id and device id; resolves when the page logs that its data channel opened */
  connect(hubId: string, deviceId: string, timeout?: number): Promise<boolean>;
  /** Sends a request with a label and a JSON payload, as the page's Send Message button does */
  send(label: string, payload: object): Promise<void>;
  /** The page's own log lines */
  log(): Promise<string[]>;
};

export async function launchDeviceSimulator(evidence: Evidence, position: [number, number] = [1280, 360]): Promise<DeviceSimulator> {
  const browser = await chromium.launch({ channel: "msedge", headless: false, args: [`--window-position=${position[0]},${position[1]}`, "--window-size=640,700"] });
  // The origin's content security policy would block the simulator's inline script and its Phoenix client
  // from the CDN; this browser holds only the simulator, so the policy is bypassed for it
  const context = await browser.newContext({ ignoreHTTPSErrors: true, bypassCSP: true, locale: "en-US", viewport: { width: 620, height: 600 } });
  const page = await context.newPage();
  const html = fs.readFileSync(DEVICE_SIMULATOR, "utf8");
  const { log, hosts, hostCounts } = watch(context, page);
  // A page on the room's origin whose document is replaced by the simulator (a page answered by
  // page.route() cannot open WebSockets in this browser: they never connect)
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.evaluate(html => {
    document.open();
    document.write(html);
    document.close();
  }, html);
  await page.waitForSelector("#connectBtn", { timeout: 30_000 });
  await page.waitForTimeout(2000);
  let closed = false;
  const client: Client = {
    name: "IOT",
    identity: "device",
    profile: "DESK",
    modifiers: [],
    slot: "i",
    pilotHz: 0,
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
      saveRecords(evidence, "IOT", log, hostCounts);
    }
  };
  evidence.register(client);
  const lines = () => page.evaluate(() => [...document.querySelectorAll("#log > *")].map(e => e.textContent ?? ""));
  return {
    client,
    async connect(hubId, deviceId, timeout = 30_000) {
      await page.fill("#wsUrl", `wss://${HOST}:4000/socket`);
      await page.fill("#hubId", hubId);
      await page.fill("#deviceId", deviceId);
      await page.click("#connectBtn");
      return page
        .waitForFunction(() => /DataChannel opened/.test(document.querySelector("#log")?.textContent ?? ""), undefined, { timeout })
        .then(() => true)
        .catch(() => false);
    },
    async send(label, payload) {
      await page.fill("#msgLabel", label);
      await page.fill("#msgPayload", JSON.stringify(payload));
      await page.click("#sendBtn");
    },
    log: lines
  };
}
