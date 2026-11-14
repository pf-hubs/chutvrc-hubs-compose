// Trial (f): the poor-network client. Headless Chromium inside the netclient container, reached
// with chromium.connect; a visible DESK client on the host in the same room. Checks that audio and
// pose cross both ways, then shapes the container's link with tc netem and checks that it bites.
//   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d netclient
//   npx tsx trials/f-netclient.ts
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { CLIENT_MEDIA, COMPOSE_ROOT, EVIDENCE, MEDIA, NAME_SHIM, collectErrors, enterRoom, firstPage, launchClient, save, sleep, trialRoom } from "./common";
import { holdKey, pilot, remotePose, session } from "./probes";
import { execFileSync } from "node:child_process";

const dc = (args: string[]) =>
  execFileSync("docker", ["compose", "-f", "docker-compose.yml", "-f", "docker-compose.e2e.yml", ...args], {
    cwd: COMPOSE_ROOT,
    encoding: "utf8"
  });

// Every RTCPeerConnection the page makes, so its statistics can be read from outside
const keepConnections = `
  (() => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) { const pc = new Native(...args); window.__pcs.push(pc); return pc; };
    window.RTCPeerConnection.prototype = Native.prototype;
    Object.setPrototypeOf(window.RTCPeerConnection, Native);
  })();
`;

/** Round trip of the selected candidate pairs, and the time of a small HTTPS request */
async function linkStats(page: Page) {
  return page.evaluate(async () => {
    const rtts: number[] = [];
    for (const pc of (window as any).__pcs ?? []) {
      if (pc.connectionState === "closed") continue;
      const stats = await pc.getStats();
      stats.forEach((s: any) => {
        if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded" && s.currentRoundTripTime !== undefined)
          rtts.push(Math.round(s.currentRoundTripTime * 1000));
      });
    }
    const t0 = performance.now();
    await fetch("/api/v1/meta", { cache: "no-store" }).catch(() => null);
    return { candidatePairRttMs: rtts, httpMs: Math.round(performance.now() - t0) };
  });
}

const result: any = { steps: {} };
// The clip files have to be inside the container; the browser runs there
for (const ext of ["wav", "y4m"]) {
  execFileSync("docker", ["cp", path.join(MEDIA, `net1.${ext}`), `chutvrc-hubs-compose-netclient-1:/tmp/net1.${ext}`]);
}
const launchOptions = {
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--use-file-for-fake-audio-capture=/tmp/net1.wav",
    "--use-file-for-fake-video-capture=/tmp/net1.y4m",
    "--disable-features=WebRtcHideLocalIpsWithMdns"
  ]
};
const browser = await chromium.connect("ws://127.0.0.1:3100", {
  headers: { "x-playwright-launch-options": JSON.stringify(launchOptions) },
  timeout: 60_000
});
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: "en-US", viewport: { width: 1280, height: 720 }, permissions: ["microphone", "camera"] });
await context.addInitScript({ content: NAME_SHIM });
await context.addInitScript({ content: keepConnections });
const pn = await context.newPage();
const desk = await launchClient("desk2", { position: [640, 360], initScripts: [keepConnections] });
const pd = await firstPage(desk);
const en = collectErrors(pn);
const ed = collectErrors(pd);

try {
  result.browserVersion = browser.version();
  const hubId = await trialRoom(pd, "netclient");
  result.hubId = hubId;
  await enterRoom(pd, hubId, { displayName: "desk2" });
  result.steps.entry = await enterRoom(pn, hubId, { displayName: "net1" });
  await sleep(4000);
  const sn = await session(pn);
  const sd = await session(pd);
  result.steps.session = { net: sn, desk: sd, netGpu: await pn.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  }) };
  result.steps.clean = {
    deskHearsNet: await pilot(pd, sn.clientId, CLIENT_MEDIA.net1.pilotHz, CLIENT_MEDIA.desk3.pilotHz),
    netHearsDesk: await pilot(pn, sd.clientId, CLIENT_MEDIA.desk2.pilotHz, CLIENT_MEDIA.desk3.pilotHz),
    link: await linkStats(pn)
  };
  const before = await remotePose(pd, sn.clientId);
  await holdKey(pn, "w", 1500);
  await sleep(500);
  result.steps.clean.deskSeesNetMove = { before, after: await remotePose(pd, sn.clientId) };
  await pn.screenshot({ path: path.join(EVIDENCE, "f-netclient-net.png") });

  dc(["exec", "-T", "netclient", "tc", "qdisc", "replace", "dev", "eth0", "root", "netem", "delay", "200ms", "30ms", "loss", "5%"]);
  await sleep(5000);
  result.steps.shaped = {
    qdisc: dc(["exec", "-T", "netclient", "tc", "-s", "qdisc", "show", "dev", "eth0"]).trim().split("\n").slice(0, 3),
    link: await linkStats(pn),
    deskHearsNet: await pilot(pd, sn.clientId, CLIENT_MEDIA.net1.pilotHz, CLIENT_MEDIA.desk3.pilotHz)
  };
  const b2 = await remotePose(pd, sn.clientId);
  await holdKey(pn, "s", 1500);
  await sleep(1000);
  result.steps.shaped.deskSeesNetMove = { before: b2, after: await remotePose(pd, sn.clientId) };

  dc(["exec", "-T", "netclient", "tc", "qdisc", "del", "dev", "eth0", "root"]);
  await sleep(3000);
  result.steps.restored = { link: await linkStats(pn) };
  await pd.screenshot({ path: path.join(EVIDENCE, "f-netclient-desk.png") });
} catch (e) {
  result.error = String(e);
  await pn.screenshot({ path: path.join(EVIDENCE, "f-netclient-error.png") }).catch(() => {});
  try {
    dc(["exec", "-T", "netclient", "tc", "qdisc", "del", "dev", "eth0", "root"]);
  } catch {}
} finally {
  result.errors = { net: en.slice(0, 20), desk: ed.slice(0, 20) };
  console.log(JSON.stringify(result, null, 1));
  save("f-netclient.json", result);
  await browser.close();
  await desk.close();
}
