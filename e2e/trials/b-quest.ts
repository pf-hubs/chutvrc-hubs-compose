// Trial (b): QUEST. Edge with IWER injected before the page's scripts and the Quest Browser's user
// agent; a DESK observer in the same room. Checks isMobileVR, whether Enter Room starts an immersive
// session, and whether moving the emulated headset and controllers reaches the own pose
// (APP.avatarPoses.get(APP.sfu.clientId)) and the observer's copy of it, with isVR.
//   npx tsx trials/b-quest.ts [--fallback]
// --fallback skips the IWER session and moves #avatar-pov-node and the controller objects directly
// (plan 2.3 fallback), to compare.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { EVIDENCE, E2E, collectErrors, enterRoom, firstPage, launchClient, measureFps, save, sleep, trialRoom } from "./common";

const QUEST3_UA =
  "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36";
const fallback = process.argv.includes("--fallback");

const iwerPath = path.join(E2E, "node_modules", "iwer", "build", "iwer.min.js");
// IWER runs its device frames on window.requestAnimationFrame. On entering VR as a mobile headset, the
// client's PDF fix (media-pdf-oculus-fix.js) replaces window.requestAnimationFrame with the XR session's,
// so IWER's next device frame waits on the session it is meant to drive: the call recurses ("Maximum call
// stack size exceeded") and the frame loop stops. IWER therefore gets the browser's own functions, taken
// before any page script runs; the page keeps its patch.
const iwerSource = fs.readFileSync(iwerPath, "utf8");
const iwerPatched =
  "const __iwerRaf = window.requestAnimationFrame.bind(window), __iwerCaf = window.cancelAnimationFrame.bind(window);\n" +
  iwerSource.replaceAll("globalThis.requestAnimationFrame(", "__iwerRaf(").replaceAll("globalThis.cancelAnimationFrame(", "__iwerCaf(");
const nativeRaf = process.argv.includes("--unpatched") ? iwerSource : iwerPatched;
// Edge has its own navigator.xr, so installRuntime() alone only warns and returns; forceInstall replaces it
const installIwer = `
  (() => {
    const device = new IWER.XRDevice(IWER.metaQuest3);
    device.installRuntime({ forceInstall: true });
    window.xrDevice = device;
  })();
`;

const result: any = { fallback, steps: {} };
const t00 = Date.now();
const step = (msg: string) => console.error(`[${((Date.now() - t00) / 1000).toFixed(1)}s] ${msg}`);
/** Gives up on a page call after `ms`, so a stuck page shows up in the result instead of hanging the trial */
const within = <T,>(p: Promise<T>, ms: number, label: string): Promise<T | string> =>
  Promise.race([p, new Promise<string>(r => setTimeout(() => r(`timeout: ${label}`), ms))]);
const quest = await launchClient("quest1", {
  userAgent: QUEST3_UA,
  position: [0, 0],
  initScripts: fallback ? [] : [nativeRaf, installIwer]
});
const desk = await launchClient("desk2", { position: [640, 360] });
const qp = await firstPage(quest);
const dp = await firstPage(desk);
const qErrors = collectErrors(qp);
const dErrors = collectErrors(dp);
const qLog: string[] = [];
qp.on("dialog", d => {
  qLog.push(`dialog ${d.type()}: ${d.message().slice(0, 200)}`);
  d.dismiss().catch(() => {});
});
qp.on("console", m => {
  const t = m.text();
  if (/entry|VR|xr|immersive|session/i.test(t)) qLog.push(`${m.type()}: ${t.slice(0, 200)}`);
});

try {
  const hubId = await trialRoom(dp, "quest");
  result.hubId = hubId;
  await enterRoom(dp, hubId, { displayName: "desk2" });

  step("observer entered");
  await qp.goto(`https://hubs.local:4000/${hubId}`, { waitUntil: "domcontentloaded" });
  await qp.getByRole("button", { name: "Join Room" }).waitFor({ state: "visible", timeout: 240_000 });
  result.steps.ua = await qp.evaluate(() => navigator.userAgent);
  result.steps.isMobileVR = await qp.evaluate(() => (window as any).AFRAME.utils.device.isMobileVR());
  result.steps.xrIsIwer = await qp.evaluate(() => !!(window as any).xrDevice && (navigator as any).xr?.constructor?.name);
  result.steps.immersiveSupported = await qp.evaluate(() => (navigator as any).xr?.isSessionSupported("immersive-vr"));

  step("quest page loaded");
  // The entry flow as a Quest user sees it
  await qp.getByRole("button", { name: "Join Room" }).click();
  const accept = qp.getByRole("button", { name: "Accept" });
  const enter = qp.getByRole("button", { name: "Enter Room" });
  await accept.or(enter).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await accept.isVisible()) {
    await qp.getByLabel("Display Name").fill("quest1");
    await accept.click();
  }
  await enter.waitFor({ state: "visible", timeout: 60_000 });
  await sleep(1000);
  step("clicking Enter Room");
  await enter.click();
  await qp.waitForFunction(() => (window as any).AFRAME.scenes[0].is("entered"), undefined, { timeout: 60_000 });
  await sleep(3000);
  step("entered");
  result.steps.afterEnter = await within(qp.evaluate(() => {
    const scene = (window as any).AFRAME.scenes[0];
    return {
      entered: scene.is("entered"),
      vrMode: scene.is("vr-mode"),
      xrEnabled: scene.renderer.xr.enabled,
      isPresenting: scene.renderer.xr.isPresenting,
      sfuId: (window as any).APP.sfu.sfuId,
      isConnected: (window as any).APP.sfu.isConnected
    };
  }), 10_000, "afterEnter");
  step("afterEnter " + JSON.stringify(result.steps.afterEnter));
  await within(qp.screenshot({ path: path.join(EVIDENCE, `b-quest${fallback ? "-fallback" : ""}-entered.png`) }), 15_000, "screenshot");

  const ownPose = (p: Page): Promise<any> =>
    within(p.evaluate(() => {
      const APP = (window as any).APP;
      const pose = APP.avatarPoses.get(APP.sfu.clientId);
      if (!pose) return null;
      const r = (v: any) => [v.x, v.y, v.z].map((n: number) => +n.toFixed(3));
      return { clientId: APP.sfu.clientId, head: r(pose.head.pos), left: r(pose.leftHand.pos), right: r(pose.rightHand.pos), headRot: r(pose.head.rot), isVR: pose.isVR, tracked: pose.tracked };
    }), 10_000, "ownPose");
  const remotePose = (p: Page, clientId: string): Promise<any> =>
    within(p.evaluate(clientId => {
      const pose = (window as any).APP.avatarPoses.get(clientId);
      if (!pose) return null;
      const r = (v: any) => [v.x, v.y, v.z].map((n: number) => +n.toFixed(3));
      return { head: r(pose.head.pos), left: r(pose.leftHand.pos), right: r(pose.rightHand.pos), headRot: r(pose.head.rot), isVR: pose.isVR, tracked: pose.tracked, seq: pose.seq };
    }, clientId), 10_000, "remotePose");

  const before = await ownPose(qp);
  step("ownPose before " + JSON.stringify(before));
  result.steps.ownPoseBefore = before;
  result.steps.observerBefore = before?.clientId && (await remotePose(dp, before.clientId));
  step("observer before");

  if (!fallback) {
    step("moving the emulated devices");
    // Headset 30 cm lower and turned 45 degrees left; hands forward and apart
    await qp.evaluate(() => {
      const d = (window as any).xrDevice;
      d.position.set(0.1, 1.3, -0.2);
      const s = Math.sin(Math.PI / 8);
      d.quaternion.set(0, s, 0, Math.cos(Math.PI / 8));
      d.controllers.left.position.set(-0.4, 1.2, -0.5);
      d.controllers.right.position.set(0.4, 1.5, -0.5);
    });
  } else {
    await qp.evaluate(() => {
      const q = (s: string) => (document.querySelector(s) as any).object3D;
      const head = q("#avatar-pov-node");
      head.position.set(0.1, 1.3, -0.2);
      head.rotation.set(0, Math.PI / 4, 0);
      head.matrixNeedsUpdate = true;
      const l = q("#player-left-controller");
      const r = q("#player-right-controller");
      l.position.set(-0.4, 1.2, -0.5);
      r.position.set(0.4, 1.5, -0.5);
      l.visible = r.visible = true;
      l.matrixNeedsUpdate = r.matrixNeedsUpdate = true;
    });
  }
  await sleep(1500);
  const after = await ownPose(qp);
  result.steps.ownPoseAfter = after;
  result.steps.observerAfter = after?.clientId && (await remotePose(dp, after.clientId));
  step("after " + JSON.stringify(after));

  // A controller loses tracking
  if (!fallback) {
    await qp.evaluate(() => ((window as any).xrDevice.controllers.left.connected = false));
    await sleep(1500);
    result.steps.leftDisconnected = { own: await ownPose(qp), observer: after?.clientId && (await remotePose(dp, after.clientId)) };
    await qp.evaluate(() => ((window as any).xrDevice.controllers.left.connected = true));
    await sleep(1000);
  }
  // What the headset puts on the wire: the tracked bits and isVR of its own #avatar-pose packets
  step("packets");
  result.steps.sentPoses = await within(
    qp.evaluate(async () => {
      const bus = (window as any).APP.sfu.bus;
      bus.takeRecording();
      bus.startRecording();
      await new Promise(r => setTimeout(r, 1000));
      bus.stopRecording();
      const sent = bus.takeRecording().filter((e: any) => e.l === "#avatar-pose" && e.s === 1);
      return { count: sent.length, tracked: [...new Set(sent.map((e: any) => e.m?.tracked))], isVR: [...new Set(sent.map((e: any) => e.m?.isVR))] };
    }),
    10_000,
    "packets"
  );
  step("fps");
  result.steps.fps = await within(measureFps(qp, 3000), 10_000, "window rAF");
  step("xr fps");
  result.steps.xrFps = await within(qp.evaluate(
    () =>
      new Promise(resolve => {
        const session = (window as any).AFRAME.scenes[0].renderer.xr.getSession?.();
        if (!session) return resolve(null);
        let n = 0;
        const t0 = performance.now();
        const tick = (t: number) => {
          n++;
          if (t - t0 < 3000) session.requestAnimationFrame(tick);
          else resolve(+((n * 1000) / (t - t0)).toFixed(1));
        };
        session.requestAnimationFrame(tick);
      })
  ), 10_000, "session rAF");
  step("screenshots");
  await within(qp.screenshot({ path: path.join(EVIDENCE, `b-quest${fallback ? "-fallback" : ""}-moved.png`) }), 15_000, "screenshot");
  await within(dp.screenshot({ path: path.join(EVIDENCE, `b-quest${fallback ? "-fallback" : ""}-observer.png`) }), 15_000, "screenshot");
} catch (e) {
  result.error = String(e);
  await qp.screenshot({ path: path.join(EVIDENCE, `b-quest${fallback ? "-fallback" : ""}-error.png`) }).catch(() => {});
} finally {
  result.questLog = qLog.slice(0, 40);
  result.questErrors = qErrors.slice(0, 30);
  result.deskErrors = dErrors.slice(0, 30);
  console.log(JSON.stringify(result, null, 1));
  save(`b-quest${fallback ? "-fallback" : ""}.json`, result);
  await quest.close();
  await desk.close();
}
