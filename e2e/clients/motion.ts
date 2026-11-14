// The QUEST profile's emulated devices (plan 2.1, 2.4): IWER installed before the page's own scripts, and a
// pose timeline player that moves the emulated headset and controllers once a frame.
//
// This is the part tests T3.5, T4.3 and T4.8 need: a timeline of keyframes, each giving the headset's and
// each controller's position and quaternion (in the XR reference space, metres) and the controllers'
// connected flag; the player blends between keyframes (positions linearly, rotations along the shortest
// arc) and holds the last one. The M1 to M10 battery and the converted recordings come with step 7.
//
// Two things the emulation needs on this PC (TRIALS.md, trial b):
// - installRuntime({ forceInstall: true }): Edge has its own navigator.xr, and IWER otherwise only warns.
// - IWER runs its device frames on window.requestAnimationFrame. On entering VR in a mobile headset the
//   client's PDF fix (media-pdf-oculus-fix.js) replaces window.requestAnimationFrame with the XR session's,
//   so IWER's next frame would wait on the session it drives ("Maximum call stack size exceeded", both loops
//   stop). IWER therefore gets the browser's own functions, taken before any page script runs; the page
//   keeps its patch. The player runs on the same native function. A real Quest Browser does not need this.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { E2E } from "../lib/env";

/** The Meta Quest 3 browser's user agent: AFRAME.utils.device.isMobileVR() is true with it */
export const QUEST3_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0.0.x.x.x Chrome/126.0.6478.122 VR Safari/537.36";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type DevicePose = { pos: Vec3; quat: Quat };
export type ControllerPose = DevicePose & { connected?: boolean };

/** One keyframe: `t` in milliseconds from the start; a part left out is blended from the keyframes that have it */
export type Keyframe = { t: number; head?: DevicePose; left?: ControllerPose; right?: ControllerPose };
export type Timeline = { name: string; keyframes: Keyframe[] };

/** What the player set on one frame: the emulated devices' pose, the truth a test compares against */
export type AppliedFrame = { t: number; head: DevicePose; left: ControllerPose; right: ControllerPose };

/**
 * The Quest Browser does not run window.requestAnimationFrame callbacks while an immersive session is
 * presented (the premise of the client's own PDF fix, media-pdf-oculus-fix.js); they run again once the
 * session has ended. Edge does run them, and with plain IWER the page then behaves unlike a headset: the
 * renderer's window loop, which three.js stops when the session starts, is not stopped (the PDF fix has
 * already replaced window.cancelAnimationFrame by then, so the cancel goes to the XR session), carries on
 * from the window and then on the session, and the scene ticks twice per frame; when the session ends that
 * loop ends with it and the scene stops drawing. Step 6 found this (T4.8); the profile therefore holds
 * window frame callbacks while IWER's session is active, as the headset's browser does.
 * E2E_QUEST_WINDOW_RAF=run turns this off, to show the difference.
 */
const QUEST_WINDOW_FRAMES = `
(() => {
  const nativeRaf = window.__e2eNativeRaf, nativeCaf = window.__e2eNativeCaf;
  const immersive = () => !!(window.xrDevice && window.xrDevice.activeSession);
  const pending = new Map();
  let ids = 0;
  window.requestAnimationFrame = function requestAnimationFrame(callback) {
    const id = ++ids;
    const run = time => {
      if (immersive()) {
        pending.set(id, nativeRaf(run));
        return;
      }
      pending.delete(id);
      callback(time);
    };
    pending.set(id, nativeRaf(run));
    return id;
  };
  window.cancelAnimationFrame = function cancelAnimationFrame(id) {
    const native = pending.get(id);
    if (native !== undefined) nativeCaf(native);
    pending.delete(id);
  };
  window.__e2eHeldWindowFrames = () => pending.size;
})();`;

/** The player, in page code; part of the QUEST profile's init script */
const PLAYER = `
(() => {
  const raf = window.__e2eNativeRaf;
  const lerp = (a, b, t) => a + (b - a) * t;
  const slerp = (a, b, t) => {
    let [ax, ay, az, aw] = a;
    let [bx, by, bz, bw] = b;
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; cos = -cos; }
    if (cos > 0.9995) {
      const q = [lerp(ax, bx, t), lerp(ay, by, t), lerp(az, bz, t), lerp(aw, bw, t)];
      const n = Math.hypot(...q);
      return q.map(v => v / n);
    }
    const angle = Math.acos(cos);
    const s = Math.sin(angle);
    const wa = Math.sin((1 - t) * angle) / s;
    const wb = Math.sin(t * angle) / s;
    return [ax * wa + bx * wb, ay * wa + by * wb, az * wa + bz * wb, aw * wa + bw * wb];
  };
  /** The part's pose at time t from the keyframes that give it; null when none does */
  const partAt = (keyframes, part, t) => {
    let before = null, after = null;
    for (const k of keyframes) {
      if (!k[part]) continue;
      if (k.t <= t) before = k;
      else { after = k; break; }
    }
    if (!before && !after) return null;
    if (!before) return after[part];
    if (!after) return before[part];
    const f = (t - before.t) / (after.t - before.t);
    const a = before[part], b = after[part];
    return {
      pos: a.pos.map((v, i) => lerp(v, b.pos[i], f)),
      quat: slerp(a.quat, b.quat, f),
      // The connected flag steps: it changes at the keyframe that changes it
      connected: a.connected
    };
  };
  let timeline = null, startedAt = 0, duration = 0, applied = [], resolveEnd = null, playing = false;
  const read = obj => ({ pos: [obj.position.x, obj.position.y, obj.position.z], quat: [obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w] });
  const set = (obj, pose) => {
    obj.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
    obj.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
  };
  const apply = t => {
    const device = window.xrDevice;
    const head = partAt(timeline.keyframes, "head", t);
    if (head) set(device, head);
    for (const side of ["left", "right"]) {
      const pose = partAt(timeline.keyframes, side, t);
      if (!pose) continue;
      const controller = device.controllers[side];
      set(controller, pose);
      if (pose.connected !== undefined && controller.connected !== pose.connected) controller.connected = pose.connected;
    }
    const entry = { t: performance.timeOrigin + performance.now(), head: read(device) };
    for (const side of ["left", "right"]) entry[side] = { ...read(device.controllers[side]), connected: device.controllers[side].connected };
    applied.push(entry);
  };
  const frame = () => {
    if (!playing) return;
    const t = performance.now() - startedAt;
    apply(Math.min(t, duration));
    if (t >= duration) {
      playing = false;
      if (resolveEnd) resolveEnd(applied.length);
      return;
    }
    raf(frame);
  };
  window.__e2eMotion = {
    play(tl) {
      if (!window.xrDevice) throw new Error("no emulated device (the QUEST profile installs IWER)");
      timeline = tl;
      duration = tl.keyframes.length ? tl.keyframes[tl.keyframes.length - 1].t : 0;
      startedAt = performance.now();
      playing = true;
      return new Promise(resolve => { resolveEnd = resolve; raf(frame); });
    },
    stop() { playing = false; if (resolveEnd) resolveEnd(applied.length); },
    get playing() { return playing; },
    takeApplied() { const a = applied; applied = []; return a; },
    pose() {
      const device = window.xrDevice;
      if (!device) return null;
      const out = { head: read(device) };
      for (const side of ["left", "right"]) out[side] = { ...read(device.controllers[side]), connected: device.controllers[side].connected };
      return out;
    }
  };
})();`;

/** The QUEST profile's init script: IWER on the browser's own frame function, a Quest 3 device installed, the player */
function buildIwerInit(): string {
  const source = fs.readFileSync(path.join(E2E, "node_modules", "iwer", "build", "iwer.min.js"), "utf8");
  const patched = source.replaceAll("globalThis.requestAnimationFrame(", "__iwerRaf(").replaceAll("globalThis.cancelAnimationFrame(", "__iwerCaf(");
  if (patched === source) throw new Error("IWER's build no longer calls globalThis.requestAnimationFrame: check clients/motion.ts against the installed iwer");
  return [
    "const __iwerRaf = window.requestAnimationFrame.bind(window), __iwerCaf = window.cancelAnimationFrame.bind(window);",
    "window.__e2eNativeRaf = __iwerRaf; window.__e2eNativeCaf = __iwerCaf;",
    patched,
    "(() => { const device = new IWER.XRDevice(IWER.metaQuest3); device.installRuntime({ forceInstall: true }); window.xrDevice = device; })();",
    process.env.E2E_QUEST_WINDOW_RAF === "run" ? "" : QUEST_WINDOW_FRAMES,
    PLAYER
  ].join("\n");
}

/** Read once when the profiles are loaded (the IWER build comes from node_modules) */
export const IWER_INIT: string = buildIwerInit();

// ---------- Poses ----------

const DEG = Math.PI / 180;

/** A quaternion from yaw (about y), pitch (about x) and roll (about z) in degrees, in the YXZ order three.js uses */
export function yawPitchRoll(yawDeg: number, pitchDeg = 0, rollDeg = 0): Quat {
  const [x, y, z] = [pitchDeg * DEG, yawDeg * DEG, rollDeg * DEG];
  const [c1, c2, c3] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  const [s1, s2, s3] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3];
}

/** Standing still, looking ahead, controllers held in front at waist height */
export const REST: Required<Pick<Keyframe, "head" | "left" | "right">> = {
  head: { pos: [0, 1.6, 0], quat: [0, 0, 0, 1] },
  left: { pos: [-0.25, 1.2, -0.35], quat: [0, 0, 0, 1], connected: true },
  right: { pos: [0.25, 1.2, -0.35], quat: [0, 0, 0, 1], connected: true }
};

/**
 * A timeline sampled from a function of time: `pose(t)` gives the parts at t milliseconds (a part left out
 * stays at REST); sampled every `stepMs`, so the player's blending between samples follows the function
 */
export function sampled(name: string, durationMs: number, pose: (t: number) => Partial<Keyframe>, stepMs = 50): Timeline {
  const keyframes: Keyframe[] = [];
  for (let t = 0; t <= durationMs + 1e-6; t += stepMs) keyframes.push({ ...REST, ...pose(t), t });
  return { name, keyframes };
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** T3.5: a speaker who turns the head from side to side and moves both hands (right up and down, left forward and back) */
export function speakerGestures(durationMs: number): Timeline {
  return sampled("speaker gestures", durationMs, t => {
    const s = t / 1000;
    return {
      head: { pos: REST.head.pos, quat: yawPitchRoll(30 * Math.sin((2 * Math.PI * s) / 4), 10 * Math.sin((2 * Math.PI * s) / 3)) },
      left: { ...REST.left, pos: add(REST.left.pos, [0, 0, -0.2 * Math.sin((2 * Math.PI * s) / 2.5)]) },
      right: { ...REST.right, pos: add(REST.right.pos, [0, 0.2 + 0.2 * Math.sin((2 * Math.PI * s) / 2), 0]) }
    };
  });
}

/** T4.3: the right hand moving at `handCmPerSecond` to the side and the head turning at `headDegPerSecond` */
export function slowDrift(durationMs: number, handCmPerSecond = 1, headDegPerSecond = 2): Timeline {
  return sampled(
    "slow drift",
    durationMs,
    t => ({
      head: { pos: REST.head.pos, quat: yawPitchRoll((headDegPerSecond * t) / 1000) },
      right: { ...REST.right, pos: add(REST.right.pos, [(handCmPerSecond / 100) * (t / 1000), 0, 0]) }
    }),
    100
  );
}

/** Holds one pose: every part at REST unless given, the connected flags as given */
export function hold(name: string, durationMs: number, parts: Partial<Keyframe> = {}): Timeline {
  return { name, keyframes: [{ ...REST, ...parts, t: 0 }, { ...REST, ...parts, t: durationMs }] };
}

// ---------- Driving the page ----------

/** Plays a timeline on the QUEST client's emulated devices; resolves when it has played through */
export async function playTimeline(page: Page, timeline: Timeline): Promise<void> {
  await page.evaluate(tl => (window as any).__e2eMotion.play(tl), timeline);
}

/** Starts a timeline without waiting for it */
export async function startTimeline(page: Page, timeline: Timeline): Promise<void> {
  await page.evaluate(tl => {
    (window as any).__e2eMotion.play(tl);
  }, timeline);
}

export function stopTimeline(page: Page): Promise<void> {
  return page.evaluate(() => (window as any).__e2eMotion.stop());
}

/** The frames the player set since the last call (the emulated devices' truth) */
export function takeApplied(page: Page): Promise<AppliedFrame[]> {
  return page.evaluate(() => (window as any).__e2eMotion.takeApplied());
}

/** The emulated devices' pose now */
export function devicePose(page: Page): Promise<{ head: DevicePose; left: ControllerPose; right: ControllerPose } | null> {
  return page.evaluate(() => (window as any).__e2eMotion?.pose() ?? null);
}

/** Connects or disconnects one emulated controller */
export function setControllerConnected(page: Page, side: "left" | "right", connected: boolean): Promise<void> {
  return page.evaluate(({ side, connected }) => {
    (window as any).xrDevice.controllers[side].connected = connected;
  }, { side, connected });
}

/** Whether the page presents an immersive session (renderer.xr.isPresenting) */
export function isPresenting(page: Page): Promise<boolean> {
  return page.evaluate(() => !!(window as any).AFRAME?.scenes?.[0]?.renderer?.xr?.isPresenting);
}

/** Ends the immersive session as the headset's own exit does; resolves once the scene has left VR */
export async function exitVr(page: Page, timeout = 15_000) {
  await page.evaluate(() => (window as any).AFRAME.scenes[0].exitVR());
  await page.waitForFunction(() => !(window as any).AFRAME.scenes[0].renderer.xr.isPresenting, undefined, { timeout });
}

/** Asks the scene for the immersive session again; resolves once it presents */
export async function enterVr(page: Page, timeout = 15_000) {
  await page.evaluate(() => (window as any).AFRAME.scenes[0].enterVR());
  await page.waitForFunction(() => !!(window as any).AFRAME.scenes[0].renderer.xr.isPresenting, undefined, { timeout });
}
