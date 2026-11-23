// Trial (c): what Playwright's WebKit (Windows build) can do with an iPhone or iPad descriptor:
// page load, the entry flow, getUserMedia, RTCPeerConnection, Dialog connection; a DESK observer
// in the same room shows whether its avatar and voice arrive.
//   npx tsx trials/c-webkit.ts ["iPhone 15"|"iPad Pro 11"] [--linux]
// --linux runs Playwright's Linux WebKit inside the netclient container (webkit.connect to its browser
// server) instead of the Windows build on this PC.
import path from "node:path";
import { devices, webkit } from "@playwright/test";
import { EVIDENCE, NAME_SHIM, collectErrors, enterRoom, firstPage, launchClient, measureFps, save, sleep, trialRoom } from "./common";

const linux = process.argv.includes("--linux");
const deviceName = process.argv.slice(2).find(a => !a.startsWith("--")) ?? "iPhone 15";
const result: any = { device: deviceName, engine: linux ? "linux webkit in netclient" : "windows webkit", steps: {} };

const desk = await launchClient("desk2", { position: [640, 360] });
const dp = await firstPage(desk);
const browser = linux ? await webkit.connect("ws://127.0.0.1:3100", { timeout: 60_000 }) : await webkit.launch({ headless: false });
const context = await browser.newContext({ ...devices[deviceName], ignoreHTTPSErrors: true, locale: "en-US" });
try {
  await context.grantPermissions(["microphone", "camera"]);
  result.steps.permissions = "granted";
} catch (e) {
  result.steps.permissions = String(e).slice(0, 200);
}
await context.addInitScript({ content: NAME_SHIM });
const page = await context.newPage();
const errors = collectErrors(page);
const failed: string[] = [];
page.on("requestfailed", r => failed.push(`${r.failure()?.errorText} ${r.url().slice(0, 150)}`));
const slug = deviceName.replace(/\W+/g, "-") + (linux ? "-linux" : "");

try {
  result.browserVersion = browser.version();
  const hubId = await trialRoom(dp, "webkit");
  result.hubId = hubId;
  await enterRoom(dp, hubId, { displayName: "desk2" });

  await page.goto(`https://hubs.local:4000/${hubId}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  result.steps.api = await page.evaluate(async () => {
    const out: any = {
      ua: navigator.userAgent,
      mediaDevices: !!navigator.mediaDevices,
      getUserMedia: !!navigator.mediaDevices?.getUserMedia,
      RTCPeerConnection: typeof (window as any).RTCPeerConnection,
      webgl2: !!document.createElement("canvas").getContext("webgl2"),
      AudioContext: typeof (window as any).AudioContext
    };
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      out.gumAudio = s.getAudioTracks().map(t => `${t.label}:${t.readyState}`);
      s.getTracks().forEach(t => t.stop());
    } catch (e) {
      out.gumAudio = String(e);
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      out.gumVideo = s.getVideoTracks().map(t => `${t.label}:${t.readyState}`);
      s.getTracks().forEach(t => t.stop());
    } catch (e) {
      out.gumVideo = String(e);
    }
    try {
      const pc = new RTCPeerConnection();
      pc.createDataChannel("x");
      const offer = await pc.createOffer();
      out.pcOffer = offer.sdp ? `sdp ${offer.sdp.length} chars` : "no sdp";
      pc.close();
    } catch (e) {
      out.pcOffer = String(e);
    }
    return out;
  });
  const t0 = Date.now();
  try {
    result.steps.entry = await enterRoom(page, hubId, { displayName: "iphone1" });
  } catch (e) {
    result.steps.entryError = String(e).slice(0, 300);
    result.steps.entryUiState = await page.evaluate(() =>
      [...document.querySelectorAll("button")].map(b => b.textContent?.trim()).filter(Boolean).slice(0, 20)
    );
  }
  result.steps.entryMs = Date.now() - t0;
  await sleep(5000);
  result.steps.session = await page.evaluate(() => {
    const APP = (window as any).APP;
    return {
      entered: (window as any).AFRAME?.scenes?.[0]?.is("entered"),
      sfuId: APP?.sfu?.sfuId,
      isConnected: APP?.sfu?.isConnected,
      clientId: APP?.sfu?.clientId,
      micTrack: APP?.sfu?.getLocalMicTrack?.()?.readyState ?? null,
      isMobile: (window as any).AFRAME?.utils?.device?.isMobile()
    };
  });
  result.steps.fps = await measureFps(page, 3000).catch(e => String(e));
  await page.screenshot({ path: path.join(EVIDENCE, `c-webkit-${slug}.png`) });
  const clientId = result.steps.session?.clientId;
  if (clientId) {
    result.steps.observer = await dp.evaluate(async clientId => {
      const APP = (window as any).APP;
      const pose = APP.avatarPoses.get(clientId);
      const stream = await Promise.race([
        APP.sfu.getMediaStream(clientId, "audio"),
        new Promise(r => setTimeout(() => r("timeout"), 5000))
      ]);
      return {
        hasPose: !!pose,
        poseSeq: pose?.seq,
        audio: stream === "timeout" ? "timeout" : stream ? (stream as MediaStream).getAudioTracks().length : null
      };
    }, clientId);
    await dp.screenshot({ path: path.join(EVIDENCE, `c-webkit-${slug}-observer.png`) });
  }
} catch (e) {
  result.error = String(e);
  await page.screenshot({ path: path.join(EVIDENCE, `c-webkit-${slug}-error.png`) }).catch(() => {});
} finally {
  result.errors = errors.slice(0, 30);
  result.failedRequests = failed.slice(0, 20);
  console.log(JSON.stringify(result, null, 1));
  save(`c-webkit-${slug}.json`, result);
  await browser.close();
  await desk.close();
}
