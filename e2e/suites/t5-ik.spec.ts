// T5 inverse kinematics, old solver against new (plan 4, T5). One subject (QUEST for VR, DESK for desktop)
// moves through the motion battery (motions/: M1 to M10 and H1 in VR; stand still, look around, snap turn
// and walk on desktop); two DESK observers stand at the same spot with the same view of it, one with "Use
// the new avatar body solver (experimental)" off and one with it on. The setting belongs to the viewer, so
// both solve the same received poses and their frames line up. Each observer's inverse kinematics probe
// (probes/ik.ts) measures every frame against the pose its solver was given, and its page is recorded by a
// screencast with the PC's time on every frame, so the two can be put side by side at the same moments.
// The subject records its own view (its Playwright video): first person in VR; on desktop first person during
// the motions and then ?thirdPerson's camera behind the avatar for a walk and a turn (in that camera a mouse
// drag does not turn the head the client sends). Every client starts with the old solver; the new observer
// turns the new one on once the subject stands still, so its height calibration is a standing headset's
// (TRIALS.md, step 7). One test per avatar and mode on each media server; a last test per block builds the
// contact sheet and the summary video of each avatar (report/side-by-side.ts) from the tests that ran.
//
// Known failure #1 of BASELINE.md (Dialog: the avatar is announced once, often before the channel is open,
// so the others draw no model for it) is worked around here with the logged re-announce: T5 is not about
// loading.
import fs from "node:fs";
import path from "node:path";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { runDir, type TestResult } from "../report/evidence";
import { room, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import * as input from "../clients/input";
import { playTimeline, takeApplied, type Timeline } from "../clients/motion";
import { hideAvatarsExcept, observerPlace, placeRig, sceneLights, setNewSolver, type Framing } from "../clients/stage";
import { DESKTOP_MOTIONS, VR_MOTIONS, type DesktopMotion, type Motion, type MotionId } from "../motions/battery";
import { convertBotRecording } from "../motions/convert-bot-recording";
import { ikCsv, ikInfo, ikOwnCheck, ikSelfTest, startIk, stopIk, summariseIk, type IkFrame, type IkInfo, type IkSummary } from "../probes/ik";
import { HEAD_WORLD, LEFT_HAND, RIG, RIGHT_HAND, SELF, align, startFrameRecorder, stopFrameRecorder, type Channel, type FrameSample } from "../probes/poses";
import { avatarState } from "../probes/avatars";
import { AVATARS, avatarUrl, missingAvatars, type AvatarName } from "../assets/avatars";
import { Screencast, castRate, frameAt, type CastFrame } from "../report/screencast";
import { joinVideos, renderHtmlToPng, sideBySideVideo, type Crop } from "../report/side-by-side";
import { blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, frameRateCheck, idOf, mainRoom, startClients } from "./common";

const SERVERS = ["dialog", "livekit"] as const;
const T5_AVATARS = ["rpm", "vrm0", "vrm1"] as const satisfies readonly AvatarName[];
type T5Avatar = (typeof T5_AVATARS)[number];
const MODES = ["vr", "desktop"] as const;
type Mode = (typeof MODES)[number];

export const AVATAR_TITLE: Record<T5Avatar, string> = { rpm: "Ready Player Me sample", vrm0: "VRM 0.x sample", vrm1: "VRM 1.0 sample" };
const MODE_TITLE: Record<Mode, string> = { vr: "headset (VR)", desktop: "desktop" };

/** The subject at the crater's centre facing -z (toward the sun); the observers 2.2 m away, 35° to its left, looking at its middle */
const FRAMING: Framing = { subject: { x: 0, z: 0, yawDeg: 0 }, distance: 2.2, bearingDeg: 35, aimHeight: 0.95 };
/** The part of an observer's 1280 x 720 window the videos and the contact sheet show: the subject with room for its reach and steps (the toolbar and side panels left out) */
export const CROP: Crop = { x: 320, y: 48, w: 640, h: 480 };
/** Hand error of the new solver counts as no worse than the old one's within this: 10% and 5 mm */
const HAND_TOLERANCE = { factor: 1.1, cm: 0.5 };
/** Below this share of the frames an observer drew the subject on, a motion's numbers are not trusted */
const MIN_FRAME_SHARE = 0.8;

const meta = (avatar: T5Avatar | "summary", mode: Mode | null, server: MediaServer) => ({
  annotation: [
    { type: "id", description: avatar === "summary" ? `t5-summary-${blockId(server)}` : `t5-${avatar}-${mode}-${blockId(server)}` },
    { type: "covers", description: "V6" }
  ]
});

type Solver = "old" | "new";
const SOLVERS: Solver[] = ["old", "new"];

export type MotionResult = {
  id: MotionId;
  title: string;
  summary: string;
  mode: Mode;
  tellWhat: string;
  /** PC time of the recording window and of the frame the contact sheet shows */
  window: { from: number; to: number };
  tellPc: number;
  lagMs: number | null;
  lagFrom: string;
  /** The observers' frames at that moment, relative to the evidence folder */
  frames: Record<Solver, string | null>;
  cast: Record<Solver, { frames: number; perSecond: number }>;
  ik: Record<Solver, IkSummary>;
  atTell: Record<Solver, IkFrame | null>;
  drawn: Record<Solver, { frames: number; missing: number; share: number }>;
  ikErrors: string[];
  /** How far the subject's rig moved and turned (desktop walk, thumbstick, snap turns) */
  subject: { travelled: number; turnedDeg: number };
  video: string | null;
};

export type T5Record = {
  avatar: T5Avatar;
  avatarTitle: string;
  mode: Mode;
  server: MediaServer;
  block: string;
  url: string;
  info: Record<Solver, IkInfo | null>;
  motions: MotionResult[];
  crop: Crop;
};

// ---------- The session ----------

type Session = { subject: Client; observers: Record<Solver, Client>; ids: { subject: string; old: string; new: string }; url: string; mode: Mode };

async function startSession(evidence: Evidence, server: MediaServer, avatar: T5Avatar, mode: Mode): Promise<Session> {
  const missing = missingAvatars();
  if (missing.length) throw new Error(`avatar files missing (${missing.join(", ")}): npx tsx assets/avatars.ts`);
  const hub = room(mainRoom(server));
  const url = avatarUrl(avatar);
  const [subject, oldObserver, newObserver] = await startClients(evidence, [
    mode === "vr" ? { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" } : { identity: "t5-subject", slot: "a", name: "A-desk" },
    { identity: "t5-old", slot: "b", name: "B-old-solver", recordVideo: false },
    { identity: "t5-new", slot: "c", name: "C-new-solver", recordVideo: false }
  ]);
  evidence.note(
    `room ${hub.hubId} (${hub.mediaServer}); subject ${subject.name} (${subject.profile}) with ${AVATARS[avatar].describe} (${url}); ` +
      `observers B-old-solver ("Use the new avatar body solver" off) and C-new-solver (on), both DESK at the same spot with the same view; ` +
      `their pages are recorded by the DevTools screencast (time-stamped frames), not by Playwright's video`
  );
  // Every client starts with the old solver (a profile keeps the setting from an earlier run): the new
  // solver is turned on once the subject stands still in place (enableNewSolver), so it calibrates the
  // subject's height from a standing headset rather than from the frames of entering VR
  await Promise.all([
    enterSubject(subject, hub.hubId, url, mode),
    enterRoom(oldObserver, hub.hubId, { displayName: oldObserver.name, preferences: OLD_SOLVER }),
    enterRoom(newObserver, hub.hubId, { displayName: newObserver.name, preferences: OLD_SOLVER })
  ]);
  if (mode === "desktop") {
    evidence.note(
      "subject's own view: first person during the motions (in the third-person camera a mouse drag does not turn the head the client sends, TRIALS.md step 7), then ?thirdPerson's camera behind the avatar (the O key) for a walk and a turn at the end; its own avatar is solved with the new solver"
    );
  } else {
    evidence.note("subject's own view: first person in the emulated headset (IWER draws one eye into the window); its own avatar is solved with the new solver");
  }
  const ids = { subject: await idOf(subject), old: await idOf(oldObserver), new: await idOf(newObserver) };
  return { subject, observers: { old: oldObserver, new: newObserver }, ids, url, mode };
}

const OLD_SOLVER = { avatarIkV2: false };

/** The subject enters with its avatar and the old solver; on desktop with ?thirdPerson, which lets the O key move the camera behind the avatar */
async function enterSubject(subject: Client, hubId: string, url: string, mode: Mode) {
  await enterRoom(subject, hubId, { displayName: subject.name, avatarUrl: url, query: mode === "desktop" ? "?thirdPerson" : undefined, preferences: OLD_SOLVER });
}

/**
 * The desktop subject's own view from behind: ?thirdPerson's camera (O: third person near), a short walk, a
 * snap turn and back, then O twice to return to first person (the modes cycle near, far, first person)
 */
async function thirdPersonOwnView(evidence: Evidence, s: Session) {
  const mode = () => s.subject.page.evaluate(() => (window as any).AFRAME.scenes[0].systems["hubs-systems"].cameraSystem.mode as number);
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  await input.holdKey(s.subject.page, "o", 120);
  await s.subject.page.waitForTimeout(600);
  const third = await mode();
  await evidence.screenshot(s.subject, "own-view-third-person");
  await input.walk(s.subject.page, "w", 300);
  await input.snapTurn(s.subject.page, "left", 2);
  await s.subject.page.waitForTimeout(500);
  await evidence.screenshot(s.subject, "own-view-third-person-turned");
  await input.snapTurn(s.subject.page, "right", 2);
  await input.walk(s.subject.page, "s", 300);
  await input.holdKey(s.subject.page, "o", 120);
  await s.subject.page.waitForTimeout(200);
  await input.holdKey(s.subject.page, "o", 120);
  await s.subject.page.waitForTimeout(400);
  evidence.note(`subject's own view from behind (?thirdPerson, camera mode ${third === 1 ? "third person near" : `${third}, not third person`}): a walk and two snap turns, in its video and the own-view-third-person screenshots; back to camera mode ${await mode()}`);
}

/**
 * Both observers must have the subject's model (with the subject's avatar) and receive its poses. The
 * announcement is sent again until they do (known failure #1). When neither observer receives a pose from
 * the subject, the subject's sending failed (the one-way failure, BASELINE.md #3 and #21) and the subject
 * enters the room again; when one does not, that observer enters again; each once.
 */
async function ensureObserversSeeSubject(evidence: Evidence, s: Session, hubId: string) {
  const sees = async (o: Client) => {
    const state = await avatarState(o.page, s.ids.subject).catch(() => null);
    const pose = await o.page.evaluate(id => (window as any).APP.avatarPoses?.get(id)?.seq ?? -1, s.ids.subject);
    return { model: !!state && state.eid !== null && state.avatarId === s.url, pose };
  };
  const tries: string[] = [];
  let reentered = false;
  let subjectReentered = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await s.subject.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
    await s.subject.page.waitForTimeout(3000);
    const before = await Promise.all(SOLVERS.map(k => sees(s.observers[k])));
    await s.subject.page.waitForTimeout(600);
    const after = await Promise.all(SOLVERS.map(k => sees(s.observers[k])));
    const ok = SOLVERS.map((_, i) => after[i].model && after[i].pose > before[i].pose);
    tries.push(`try ${attempt}: ${SOLVERS.map((k, i) => `${k} observer model ${after[i].model ? "yes" : "no"}, poses ${after[i].pose > before[i].pose ? "arriving" : "not arriving"}`).join("; ")}`);
    if (ok.every(Boolean)) {
      evidence.note(
        `workaround applied: the subject's avatar announcement (#avatarId) sent ${attempt} time(s) after entry until both observers drew its model (known failure: the first one goes out before the channel is open); ${tries.join(" | ")}`
      );
      return true;
    }
    const silent = SOLVERS.filter((_, i) => after[i].pose === before[i].pose);
    if (attempt >= 3 && silent.length === SOLVERS.length && !subjectReentered) {
      subjectReentered = true;
      tries.push("neither observer received a pose from the subject (one-way failure on the subject's side): the subject enters the room again");
      await enterSubject(s.subject, hubId, s.url, s.mode);
      s.ids.subject = await idOf(s.subject);
    } else if (attempt >= 3 && silent.length && !reentered) {
      reentered = true;
      for (const k of silent) {
        tries.push(`the ${k} observer received no pose from the subject (one-way failure): it enters the room again`);
        await enterRoom(s.observers[k], hubId, { displayName: s.observers[k].name, preferences: OLD_SOLVER });
        s.ids[k] = await idOf(s.observers[k]);
      }
    }
  }
  evidence.note(`the observers did not both draw the subject: ${tries.join(" | ")}`);
  return false;
}

/** The subject and the observers in their places; the observers' own and each other's models hidden from their views */
async function stage(evidence: Evidence, s: Session) {
  const place = observerPlace(FRAMING);
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  for (const k of SOLVERS) {
    await placeRig(s.observers[k].page, place.x, place.z, place.yawDeg, place.pitchDeg);
    const hidden = await hideAvatarsExcept(s.observers[k], [s.ids.subject]);
    evidence.note(`${s.observers[k].name}: models moved out of its view (they stand where its camera is): ${hidden.length}`);
  }
  const lights = await sceneLights(s.subject.page);
  evidence.saveJson("staging.json", { framing: FRAMING, observers: place, crop: CROP, lights }, "where the subject and the observers stand, the observers' crop, the scene's lights");
}

/**
 * Turns "Use the new avatar body solver" on for the new observer (and for the subject's own view) while the
 * subject stands still at its place, as a viewer turning the setting on while watching. The new solver
 * takes its height scale from the first frame it solves in VR and keeps it (calibration.ts), so this makes
 * the scale come from the standing headset. TRIALS.md (step 7) has what happens when that first frame is
 * one of the headset entering VR.
 */
async function enableNewSolver(evidence: Evidence, s: Session) {
  if (s.mode === "vr") {
    const stand = VR_MOTIONS[0]().timeline.keyframes[0];
    await playTimeline(s.subject.page, { name: "stand", keyframes: [{ ...stand, t: 0 }, { ...stand, t: 1500 }] } as Timeline);
    await takeApplied(s.subject.page);
  }
  await setNewSolver(s.observers.new, true);
  await setNewSolver(s.subject, true);
  await s.subject.page.waitForTimeout(800);
  if (s.mode !== "vr") {
    evidence.note("the new solver turned on for C-new-solver and for the subject's own view once the subject stood in place (desktop: no height calibration)");
    return;
  }
  await evidence.check("The new solver's height scale comes from the standing headset", "V6", async () => {
    const read = await s.observers.new.page.evaluate(id => {
      const APP = (window as any).APP;
      const eid = APP.sfu.avatarSync.models.avatarEidByClientId.get(id);
      const ik = APP.world.eid2Ik.get(eid);
      return { scale: ik?.ikState?.calibration?.heightScale ?? null, headY: APP.avatarPoses.get(id)?.head.pos.y ?? null };
    }, s.ids.subject);
    const info = await ikInfo(s.observers.new.page, s.ids.subject);
    const expected = read.headY && info?.restEyeHeight ? read.headY / info.restEyeHeight : null;
    return {
      ok: read.scale !== null && expected !== null && Math.abs(read.scale - expected) <= 0.01 * expected,
      summary: `scale ${read.scale?.toFixed(4) ?? "none"}; the standing headset ${read.headY?.toFixed(3)} m over the model's eye height ${info?.restEyeHeight} m is ${expected?.toFixed(4) ?? "?"}`,
      data: { ...read, restEyeHeight: info?.restEyeHeight, expected }
    };
  });
  evidence.note("the new solver turned on for C-new-solver and for the subject's own view once the subject stood in place, so both calibrated its height from the standing headset");
}

// ---------- One motion ----------

type Raw = {
  from: number;
  to: number;
  tellPc0: number;
  own: FrameSample[];
  copies: Record<Solver, FrameSample[]>;
  ik: Record<Solver, Awaited<ReturnType<typeof stopIk>>>;
  casts: Record<Solver, CastFrame[]>;
};

/** Records the subject's own pose, the observers' copies, their probes and their screencasts while `during` runs */
async function record(s: Session, castDir: string, during: () => Promise<number>): Promise<Raw> {
  const key = `t5-${Date.now()}`;
  await startFrameRecorder(s.subject.page, key, [SELF]);
  for (const k of SOLVERS) {
    await startFrameRecorder(s.observers[k].page, key, [s.ids.subject]);
    await startIk(s.observers[k].page, key, s.ids.subject);
  }
  const casts = { old: await Screencast.start(s.observers.old, path.join(castDir, "old")), new: await Screencast.start(s.observers.new, path.join(castDir, "new")) };
  const from = Date.now();
  await s.subject.page.waitForTimeout(250);
  let tellPc0 = from;
  try {
    tellPc0 = await during();
  } finally {
    // The observers show a pose about 100 ms after it was sent (the interpolation delay)
    await s.subject.page.waitForTimeout(600);
  }
  const to = Date.now();
  const castFrames = { old: await casts.old.stop(), new: await casts.new.stop() };
  const own = (await stopFrameRecorder(s.subject.page, key))[SELF] ?? [];
  const copies = { old: (await stopFrameRecorder(s.observers.old.page, key))[s.ids.subject] ?? [], new: (await stopFrameRecorder(s.observers.new.page, key))[s.ids.subject] ?? [] };
  const ik = { old: await stopIk(s.observers.old.page, key), new: await stopIk(s.observers.new.page, key) };
  return { from, to, tellPc0, own, copies, ik, casts: castFrames };
}

/** The headset and controllers to the motion's first pose, held, so the observers have settled on it before recording */
async function settleVr(s: Session, motion: Motion) {
  const first = motion.timeline.keyframes[0];
  await playTimeline(s.subject.page, { name: "settle", keyframes: [{ ...first, t: 0 }, { ...first, t: 700 }] } as Timeline);
  await takeApplied(s.subject.page);
  await s.subject.page.waitForTimeout(300);
}

async function playVr(s: Session, motion: Motion): Promise<number> {
  await playTimeline(s.subject.page, motion.timeline);
  const applied = await takeApplied(s.subject.page);
  return (applied[0]?.t ?? Date.now()) + motion.tellAtMs;
}

async function playDesktop(s: Session, motion: DesktopMotion): Promise<number> {
  let mark = 0;
  for (const step of motion.steps) {
    if (step.kind === "wait") await s.subject.page.waitForTimeout(step.ms);
    else if (step.kind === "key") await input.holdKey(s.subject.page, step.key, step.ms);
    else if (step.kind === "look") await input.look(s.subject.page, step.dx, step.dy, Math.max(4, Math.round(step.ms / 30)));
    else if (step.kind === "mark" && !mark) mark = Date.now();
  }
  return mark || Date.now();
}

/** How far the observers' copy runs behind the subject's own pose, from the channel that moved most */
function estimateLag(own: FrameSample[], copy: FrameSample[]): { lagMs: number | null; from: string } {
  const channels: [string, Channel][] = [
    ["head", HEAD_WORLD],
    ["right hand", RIGHT_HAND],
    ["left hand", LEFT_HAND],
    ["rig", RIG]
  ];
  let best: { lagMs: number; travel: number; name: string } | null = null;
  for (const [name, channel] of channels) {
    const a = align(own, copy, channel, { maxLagMs: 600 });
    if (a && a.senderTravel > 0.05 && (!best || a.senderTravel > best.travel)) best = { lagMs: a.lagMs, travel: a.senderTravel, name };
  }
  return best ? { lagMs: best.lagMs, from: `${best.name} (${(best.travel * 100).toFixed(0)} cm travelled)` } : { lagMs: null, from: "no channel moved enough" };
}

const DEFAULT_LAG_MS = 110;

function subjectMovement(own: FrameSample[]) {
  let travelled = 0;
  let turned = 0;
  for (let i = 1; i < own.length; i++) {
    travelled += Math.hypot(own[i].rig[0] - own[i - 1].rig[0], own[i].rig[2] - own[i - 1].rig[2]);
    turned += Math.abs(Math.atan2(Math.sin(own[i].yaw - own[i - 1].yaw), Math.cos(own[i].yaw - own[i - 1].yaw)));
  }
  return { travelled: +travelled.toFixed(2), turnedDeg: +((turned * 180) / Math.PI).toFixed(1) };
}

function nearestIkFrame(frames: IkFrame[], t: number): IkFrame | null {
  let best: IkFrame | null = null;
  for (const f of frames) if (!best || Math.abs((f.t as number) - t) < Math.abs((best.t as number) - t)) best = f;
  return best;
}

async function runMotion(evidence: Evidence, s: Session, motion: Motion | DesktopMotion, rawDir: string, lags: number[]): Promise<{ result: MotionResult; raw: Raw }> {
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  if ("timeline" in motion) await settleVr(s, motion);
  await s.subject.page.waitForTimeout(400);
  const castDir = path.join(rawDir, `${s.mode}-${motion.id}`);
  const raw = await record(s, castDir, () => ("timeline" in motion ? playVr(s, motion) : playDesktop(s, motion)));
  const lags2 = SOLVERS.map(k => estimateLag(raw.own, raw.copies[k]));
  const measured = lags2.map(l => l.lagMs).filter((v): v is number => v !== null);
  const lagMs = measured.length ? Math.round(measured.reduce((a, v) => a + v, 0) / measured.length) : null;
  if (lagMs !== null) lags.push(lagMs);
  const usedLag = lagMs ?? (lags.length ? lags[lags.length - 1] : DEFAULT_LAG_MS);
  const tellPc = raw.tellPc0 + usedLag;

  const frames: Record<Solver, string | null> = { old: null, new: null };
  for (const k of SOLVERS) {
    const frame = frameAt(raw.casts[k], tellPc);
    if (!frame) continue;
    const name = `t5-frames/${s.mode}-${motion.id}-${k}.jpg`;
    fs.mkdirSync(evidence.file("t5-frames"), { recursive: true });
    fs.copyFileSync(frame.file, evidence.file(name));
    frames[k] = name;
    evidence.addFile(name, "screenshot", `${s.mode === "vr" ? "VR" : "desktop"} ${motion.id.toUpperCase()} ${motion.title}: ${k} solver, ${motion.tellWhat}`, s.observers[k].name);
  }
  const drawn = Object.fromEntries(
    SOLVERS.map(k => [k, { frames: raw.ik[k].frames.length, missing: raw.ik[k].missing, share: +(raw.ik[k].frames.length / Math.max(1, raw.ik[k].frames.length + raw.ik[k].missing)).toFixed(3) }])
  ) as MotionResult["drawn"];
  const result: MotionResult = {
    id: motion.id,
    title: motion.title,
    summary: motion.summary,
    mode: s.mode,
    tellWhat: motion.tellWhat,
    window: { from: raw.from, to: raw.to },
    tellPc,
    lagMs,
    lagFrom: lagMs === null ? `not measured (${lags2.map(l => l.from).join("; ")}), ${usedLag} ms used` : lags2.map((l, i) => `${SOLVERS[i]}: ${l.lagMs ?? "?"} ms from ${l.from}`).join("; "),
    frames,
    cast: { old: { frames: raw.casts.old.length, perSecond: castRate(raw.casts.old) }, new: { frames: raw.casts.new.length, perSecond: castRate(raw.casts.new) } },
    ik: { old: summariseIk(raw.ik.old.frames), new: summariseIk(raw.ik.new.frames) },
    atTell: { old: nearestIkFrame(raw.ik.old.frames, tellPc), new: nearestIkFrame(raw.ik.new.frames, tellPc) },
    drawn,
    ikErrors: [...raw.ik.old.errors.map(e => `old: ${e}`), ...raw.ik.new.errors.map(e => `new: ${e}`)],
    subject: subjectMovement(raw.own),
    video: null
  };
  return { result, raw };
}

// ---------- The test ----------

const pass = (r: MotionResult) => ({
  nan: r.ik.new.nanFrames === 0,
  sides: r.ik.new.elbowWrong === 0 && r.ik.new.kneeWrong === 0,
  hand:
    r.mode !== "vr" || r.ik.old.handErrMean === null || r.ik.new.handErrMean === null
      ? null
      : r.ik.new.handErrMean <= r.ik.old.handErrMean * HAND_TOLERANCE.factor + HAND_TOLERANCE.cm
});

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

async function ikTest(evidence: Evidence, server: MediaServer, avatar: T5Avatar, mode: Mode) {
  test.setTimeout(40 * 60_000);
  const hub = room(mainRoom(server));
  const s = await startSession(evidence, server, avatar, mode);
  const seen = await ensureObserversSeeSubject(evidence, s, hub.hubId);
  if (!seen) throw new Error("the observers do not both draw the subject; the solvers cannot be compared");
  await stage(evidence, s);
  await enableNewSolver(evidence, s);
  await s.subject.page.waitForTimeout(1000);
  for (const k of SOLVERS) await evidence.screenshot(s.observers[k], `framing-${k}-solver`);
  await evidence.screenshot(s.subject, "own-view");
  await frameRateCheck(evidence, [s.subject, s.observers.old, s.observers.new]);

  const info = { old: await ikInfo(s.observers.old.page, s.ids.subject), new: await ikInfo(s.observers.new.page, s.ids.subject) };
  await evidence.check("The probe's maths against known answers", "V6", async () => {
    const cases = ikSelfTest();
    const own = mode === "vr" ? await ikOwnCheck(s.subject.page) : null;
    const ownOk = !own || (["head", "left", "right"] as const).every(p => own[p].positionMm < 1 && own[p].turnDeg < 0.1);
    return {
      ok: cases.every(c => c.ok) && ownOk,
      summary:
        `${cases.filter(c => c.ok).length} of ${cases.length} cases with known answers (rig to room, YXZ turns, elbow and knee sides)` +
        (own ? `; the headset's own pose through the probe against the scene's own objects: head ${own.head.positionMm} mm, hands ${own.left.positionMm} and ${own.right.positionMm} mm, turns ${own.head.turnDeg}°, ${own.left.turnDeg}°, ${own.right.turnDeg}°` : ""),
      data: { cases, own, info }
    };
  });

  const rawDir = evidence.file(".raw-frames");
  const all: (Motion | DesktopMotion)[] = mode === "vr" ? [...VR_MOTIONS.map(m => m()), convertBotRecording()] : DESKTOP_MOTIONS;
  // T5_MOTIONS=m01,m05 runs only those (for a quick look; the full battery is the test)
  const only = process.env.T5_MOTIONS?.split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const motions = only?.length ? all.filter(m => only.includes(m.id)) : all;
  if (only?.length) evidence.note(`only the motions ${motions.map(m => m.id).join(", ")} (T5_MOTIONS)`);
  const results: MotionResult[] = [];
  const raws: Raw[] = [];
  const lags: number[] = [];
  const csvRows: { labels: Record<string, string>; frames: IkFrame[] }[] = [];
  for (const motion of motions) {
    const { result, raw } = await runMotion(evidence, s, motion, rawDir, lags);
    results.push(result);
    raws.push(raw);
    for (const k of SOLVERS) csvRows.push({ labels: { avatar, mode, motion: motion.id, solver: k }, frames: raw.ik[k].frames });
  }
  if (mode === "desktop") await thirdPersonOwnView(evidence, s);
  // Back at the start, so the closing screenshots show the subject
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);

  evidence.saveText("ik-metrics.csv", ikCsv(csvRows), "every observer frame of every motion: the inverse kinematics probe's numbers (probes/ik.ts)", "data");
  const summaryRows = [["avatar", "mode", "motion", "solver", ...Object.keys(results[0].ik.old)].join(",")];
  for (const r of results) for (const k of SOLVERS) summaryRows.push([avatar, mode, r.id, k, ...Object.values(r.ik[k]).map(v => (v === null ? "" : v))].join(","));
  evidence.saveText("ik-summary.csv", summaryRows.join("\n") + "\n", "per motion and solver: hand, eye and head errors, wrong-side joints, feet, jumps, twist, NaN", "data");
  const record: T5Record = { avatar, avatarTitle: AVATAR_TITLE[avatar], mode, server, block: blockId(server), url: s.url, info, motions: results, crop: CROP };
  evidence.saveJson("t5.json", record, "the motions with their per-solver summaries, the frames shown and the lag used (read by the T5 summary test)");
  evidence.saveJson("motions.json", motions.map(m => ("timeline" in m ? { id: m.id, title: m.title, summary: m.summary, tellAtMs: m.tellAtMs, client: m.client } : m)), "the motions played: the poses the client was to send (VR) or the input steps (desktop)");

  await evidence.check("Both observers drew the subject throughout every motion", "V6", async () => {
    const low = results.filter(r => SOLVERS.some(k => r.drawn[k].share < MIN_FRAME_SHARE || r.drawn[k].frames < 60));
    return {
      ok: low.length === 0,
      summary: low.length ? `too few frames: ${low.map(r => `${r.id} (old ${r.drawn.old.frames}, new ${r.drawn.new.frames})`).join(", ")}` : `every motion: ${results.map(r => `${r.id} ${r.drawn.old.frames}/${r.drawn.new.frames}`).join(", ")} frames (old/new)`,
      data: results.map(r => ({ id: r.id, drawn: r.drawn, cast: r.cast, lag: r.lagFrom, ikErrors: r.ikErrors }))
    };
  });
  await evidence.check("New solver: no NaN in any bone", "V6", async () => {
    const bad = results.filter(r => !pass(r).nan);
    return { ok: bad.length === 0, summary: bad.length ? bad.map(r => `${r.id}: ${r.ik.new.nanFrames} frames`).join(", ") : `none in ${results.reduce((a, r) => a + r.ik.new.frames, 0)} frames (old solver: ${results.reduce((a, r) => a + r.ik.old.nanFrames, 0)} frames with NaN)` };
  });
  await evidence.check("New solver: no elbow or knee bent to the wrong side", "V6", async () => {
    const rows = results.map(r => `${r.id} ${r.ik.new.elbowWrong}/${r.ik.new.kneeWrong} (old ${r.ik.old.elbowWrong}/${r.ik.old.kneeWrong})`);
    return {
      ok: results.every(r => pass(r).sides),
      summary: `frames with an elbow / a knee on the wrong side (bent 20° or more, folding over 90° away from the anatomical way): ${rows.join(", ")}`,
      data: results.map(r => ({ id: r.id, new: { elbowWrong: r.ik.new.elbowWrong, elbowSideMax: r.ik.new.elbowSideMax, kneeWrong: r.ik.new.kneeWrong, kneeSideMax: r.ik.new.kneeSideMax }, old: { elbowWrong: r.ik.old.elbowWrong, elbowSideMax: r.ik.old.elbowSideMax, kneeWrong: r.ik.old.kneeWrong, kneeSideMax: r.ik.old.kneeSideMax } }))
    };
  });
  if (mode === "vr") {
    await evidence.check("New solver: hand error no worse than the old solver's", "V6", async () => {
      const judged = results.filter(r => pass(r).hand !== null);
      const rows = judged.map(r => `${r.id} ${n(r.ik.old.handErrMean)} → ${n(r.ik.new.handErrMean)} cm${pass(r).hand ? "" : " (worse)"}`);
      const calib = results.find(r => r.ik.new.calib !== null)?.ik.new.calib ?? null;
      return {
        ok: judged.length > 0 && judged.every(r => pass(r).hand),
        summary:
          `mean distance from hand bone to controller, old → new: ${rows.join(", ")} (no worse: within 10% and 5 mm)` +
          (calib ? `; the new solver scales heights by 1/${calib} (the user's eye height over the model's): against that target its mean is ${judged.map(r => `${r.id} ${n(r.ik.new.handErrScaledMean)}`).join(", ")} cm` : ""),
        data: judged.map(r => ({ id: r.id, old: { mean: r.ik.old.handErrMean, max: r.ik.old.handErrMax, rotMean: r.ik.old.handRotErrMean }, new: { mean: r.ik.new.handErrMean, max: r.ik.new.handErrMax, scaledMean: r.ik.new.handErrScaledMean, rotMean: r.ik.new.handRotErrMean } }))
      };
    });
  } else {
    evidence.note("desktop: the pose has no controllers (hands untracked), so hand error is not judged; both solvers hang the arms by their own rules");
  }
  await evidence.check("Old solver: its numbers stored as the baseline", "V6", async () => {
    const o = (r: MotionResult) => r.ik.old;
    return {
      ok: true,
      summary: results
        .map(r => `${r.id}: hand ${n(o(r).handErrMean)}/${n(o(r).handErrMax)} cm, eyes ${n(o(r).eyeErrMean)} cm, wrong elbows ${o(r).elbowWrong}, knees ${o(r).kneeWrong}, sole ${n(o(r).footMin)} cm, jump ${n(o(r).jumpPosMax)} cm, twist ${n(o(r).twistMax, 0)}°, NaN ${o(r).nanFrames}`)
        .join("; "),
      data: Object.fromEntries(results.map(r => [r.id, r.ik.old]))
    };
  });
  await closingChecks(evidence, [s.subject, s.observers.old, s.observers.new], [
    {
      pattern: /^Tried to toggle mic but there's no producer\. /,
      types: ["error"],
      reason: "known failure #2 of BASELINE.md (Dialog: the microphone wish lost at entry), already on develop; T5 does not use the microphone"
    }
  ]);

  // The videos are made once the browsers are closed, so ffmpeg does not take their processor time
  for (const c of [s.subject, s.observers.old, s.observers.new]) await c.close();
  const workDir = evidence.file(".ffmpeg");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = `t5-${mode}-${r.id}.mp4`;
    try {
      sideBySideVideo({
        panes: [
          { frames: raws[i].casts.old, label: "old solver" },
          { frames: raws[i].casts.new, label: "new solver (experimental)" }
        ],
        from: r.window.from,
        to: r.window.to,
        crop: CROP,
        title: `${AVATAR_TITLE[avatar]} · ${MODE_TITLE[mode]} · ${r.id.toUpperCase()} ${r.title} · ${blockTitle(server)}`,
        out: evidence.file(name),
        workDir
      });
      r.video = name;
      evidence.addFile(name, "video", `${r.id.toUpperCase()} ${r.title}: old solver | new solver, same moments`);
    } catch (e) {
      evidence.note(`video of ${r.id} not made: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  evidence.saveJson("t5.json", record, "the motions with their per-solver summaries, the frames shown and the lag used (read by the T5 summary test)");
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

// ---------- Summary per avatar ----------

const METRIC_ROWS: { label: string; get: (s: IkSummary) => number | null; unit: string; d?: number }[] = [
  { label: "hand error mean", get: s => s.handErrMean, unit: "cm" },
  { label: "hand error max", get: s => s.handErrMax, unit: "cm" },
  { label: "hand turn error mean", get: s => s.handRotErrMean, unit: "°" },
  { label: "wrist bend max", get: s => s.wristMax, unit: "°", d: 0 },
  { label: "eyes to headset mean", get: s => s.eyeErrMean, unit: "cm" },
  { label: "head facing error mean", get: s => s.headDirErrMean, unit: "°" },
  { label: "elbow wrong side (frames)", get: s => s.elbowWrong, unit: "", d: 0 },
  { label: "knee wrong side (frames)", get: s => s.kneeWrong, unit: "", d: 0 },
  { label: "lowest sole", get: s => s.footMin, unit: "cm" },
  { label: "foot sliding", get: s => s.slide, unit: "cm" },
  { label: "largest joint jump", get: s => s.jumpPosMax, unit: "cm" },
  { label: "jump beyond the input", get: s => s.jumpExcessMax, unit: "cm" },
  { label: "spine twist max", get: s => s.twistMax, unit: "°", d: 0 },
  { label: "body turned from the head, max", get: s => s.bodyTurnMax, unit: "°", d: 0 },
  { label: "body turned from the head, at the end", get: s => s.bodyTurnEnd, unit: "°", d: 0 },
  { label: "NaN frames", get: s => s.nanFrames, unit: "", d: 0 }
];

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function sheetHtml(title: string, records: { dir: string; record: T5Record }[], summaryDir: string): string {
  const scale = 480 / CROP.w;
  const rows = records.flatMap(({ dir, record }) =>
    record.motions.map(r => {
      const verdict = pass(r);
      const verdictText = [verdict.nan ? "" : "NaN", verdict.sides ? "" : "wrong-side joint", verdict.hand === false ? "hand error worse" : ""].filter(Boolean);
      const cell = (k: Solver) => {
        const file = r.frames[k];
        const src = file ? path.relative(summaryDir, path.join(dir, file)).replace(/\\/g, "/") : "";
        const at = r.atTell[k];
        const atText = at
          ? [
              at.handErrL !== null || at.handErrR !== null ? `hands ${n(at.handErrL)} / ${n(at.handErrR)} cm` : "",
              at.elbowSideL !== null || at.elbowSideR !== null ? `elbow side ${n(at.elbowSideL, 0)}° / ${n(at.elbowSideR, 0)}°` : "",
              `soles ${n(at.footL)} / ${n(at.footR)} cm`,
              `twist ${n(at.twistHipsChest, 0)}°`
            ].filter(Boolean).join(" · ")
          : "no probe frame";
        return `<div class="cell"><div class="crop" style="width:${CROP.w * scale}px;height:${CROP.h * scale}px">${src ? `<img src="${esc(src)}" style="left:${-CROP.x * scale}px;top:${-CROP.y * scale}px;width:${1280 * scale}px">` : '<span class="none">no frame</span>'}</div><div class="cap"><b>${k === "old" ? "old solver" : "new solver"}</b> · ${esc(atText)}</div></div>`;
      };
      const metrics = METRIC_ROWS.map(m => {
        const o = m.get(r.ik.old);
        const nv = m.get(r.ik.new);
        if (o === null && nv === null) return "";
        const worse = o !== null && nv !== null && Math.abs(nv) > Math.abs(o) * 1.1 + 0.5 && !["lowest sole"].includes(m.label);
        return `<tr><th>${esc(m.label)}</th><td>${n(o, m.d ?? 1)}</td><td class="${worse ? "worse" : ""}">${n(nv, m.d ?? 1)}</td><td class="u">${m.unit}</td></tr>`;
      }).join("");
      return `<div class="row">
        <div class="label"><div class="mode">${record.mode === "vr" ? "VR" : "desktop"}</div><b>${r.id.toUpperCase()}</b> ${esc(r.title)}<div class="muted">${esc(r.summary)}</div><div class="muted">shown: ${esc(r.tellWhat)}</div>
          <div class="verdict ${verdictText.length ? "ng" : "ok"}">new solver: ${verdictText.length ? `NG (${esc(verdictText.join(", "))})` : "OK"}</div></div>
        ${cell("old")}${cell("new")}
        <table class="m"><tr><th></th><td class="h">old</td><td class="h">new</td><td></td></tr>${metrics}<tr><th>bone that jumped most</th><td>${esc(r.ik.old.jumpBone ?? "–")}</td><td>${esc(r.ik.new.jumpBone ?? "–")}</td><td></td></tr></table>
      </div>`;
    })
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px; font: 13px/1.35 "Segoe UI", system-ui, sans-serif; background: #f6f7f9; color: #1d2330; width: 1460px; }
    h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #5d6677; }
    .row { display: grid; grid-template-columns: 170px 480px 480px 300px; gap: 10px; background: #fff; border: 1px solid #dde1e8; border-radius: 6px; padding: 8px; margin-bottom: 8px; align-items: start; }
    .label { font-size: 13px; } .label .muted { color: #5d6677; font-size: 12px; margin-top: 4px; }
    .mode { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 3px; background: #e4eff1; color: #3d6670; margin-bottom: 4px; }
    .verdict { margin-top: 6px; font-weight: 600; } .verdict.ok { color: #1e7f4f; } .verdict.ng { color: #b42335; }
    .crop { position: relative; overflow: hidden; background: #222; border-radius: 4px; } .crop img { position: absolute; }
    .none { color: #aaa; position: absolute; top: 45%; left: 40%; }
    .cap { font-size: 11px; color: #5d6677; margin-top: 3px; }
    table.m { border-collapse: collapse; font-size: 11.5px; width: 100%; } table.m th { text-align: left; font-weight: 400; color: #5d6677; padding: 1px 4px 1px 0; }
    table.m td { text-align: right; padding: 1px 4px; font-variant-numeric: tabular-nums; } table.m td.h { font-weight: 600; text-align: right; } table.m td.u { text-align: left; color: #5d6677; }
    td.worse { color: #b42335; font-weight: 600; }
  </style></head><body>
    <h1>${esc(title)}</h1>
    <p>Each row: one motion; the frames are what the two observers drew at the same moment (PC time, after the measured lag), cropped to the subject; the values under each frame are that frame's, the table holds the whole motion (old solver, new solver; red: the new solver more than 10% and 5 mm or units worse). Hand numbers exist only in VR, where the pose has controllers.</p>
    ${rows.join("")}
  </body></html>`;
}

async function summaryTest(evidence: Evidence, server: MediaServer) {
  test.setTimeout(20 * 60_000);
  const dir = runDir();
  const block = blockId(server);
  const found = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name.startsWith("t5-") && !d.name.startsWith("t5-summary") && d.name.endsWith(`-${block}`) && fs.existsSync(path.join(dir, d.name, "t5.json")))
    .map(d => ({ dir: path.join(dir, d.name), id: d.name, record: JSON.parse(fs.readFileSync(path.join(dir, d.name, "t5.json"), "utf8")) as T5Record }));
  if (!found.length) {
    test.skip(true, `no T5 test of this block (${block}) ran in this run`);
    return;
  }
  const csv = [["avatar", "mode", "motion", "solver", ...Object.keys(found[0].record.motions[0].ik.old)].join(",")];
  const verdicts: Record<string, unknown>[] = [];
  for (const avatar of T5_AVATARS) {
    const mine = found.filter(f => f.record.avatar === avatar).sort((a, b) => (a.record.mode === "vr" ? -1 : 1) - (b.record.mode === "vr" ? -1 : 1));
    if (!mine.length) continue;
    const title = `T5 contact sheet: ${AVATAR_TITLE[avatar]} (${AVATARS[avatar].file}) on ${blockTitle(server)}`;
    const html = evidence.file(`sheet-${avatar}.html`);
    fs.writeFileSync(html, sheetHtml(title, mine, evidence.dir));
    await renderHtmlToPng(html, evidence.file(`sheet-${avatar}.png`));
    evidence.addFile(`sheet-${avatar}.png`, "sheet", title);
    evidence.addFile(`sheet-${avatar}.html`, "data", `${title} (HTML, the same with selectable numbers)`);
    const videos = mine.flatMap(f => f.record.motions.filter(r => r.video).map(r => path.join(f.dir, r.video!)));
    if (videos.length) {
      try {
        joinVideos(videos, evidence.file(`summary-${avatar}.mp4`), evidence.file(".ffmpeg"));
        evidence.addFile(`summary-${avatar}.mp4`, "video", `${AVATAR_TITLE[avatar]}: every motion, old solver | new solver`);
      } catch (e) {
        evidence.note(`summary video of ${avatar} not made: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    for (const f of mine) {
      const res: TestResult | null = fs.existsSync(path.join(f.dir, "result.json")) ? JSON.parse(fs.readFileSync(path.join(f.dir, "result.json"), "utf8")) : null;
      for (const r of f.record.motions) for (const k of SOLVERS) csv.push([avatar, f.record.mode, r.id, k, ...Object.values(r.ik[k]).map(v => (v === null ? "" : v))].join(","));
      const agg = (k: Solver) => {
        const m = f.record.motions.map(r => r.ik[k]);
        const vals = (g: (s: IkSummary) => number | null) => m.map(g).filter((v): v is number => v !== null);
        const avg = (v: number[]) => (v.length ? +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2) : null);
        const top = (v: number[]) => (v.length ? +Math.max(...v).toFixed(2) : null);
        const low = (v: number[]) => (v.length ? +Math.min(...v).toFixed(2) : null);
        return {
          handErrMean: avg(vals(s => s.handErrMean)),
          handErrMax: top(vals(s => s.handErrMax)),
          elbowWrong: m.reduce((a, s) => a + s.elbowWrong, 0),
          kneeWrong: m.reduce((a, s) => a + s.kneeWrong, 0),
          footMin: low(vals(s => s.footMin)),
          belowFloorFrames: m.reduce((a, s) => a + s.belowFloorFrames, 0),
          jumpPosMax: top(vals(s => s.jumpPosMax)),
          jumpExcessMax: top(vals(s => s.jumpExcessMax)),
          twistMax: top(vals(s => s.twistMax)),
          nanFrames: m.reduce((a, s) => a + s.nanFrames, 0)
        };
      };
      verdicts.push({ avatar, mode: f.record.mode, test: f.id, status: res?.status ?? "unknown", old: agg("old"), new: agg("new"), failedChecks: res?.checks.filter(c => c.status === "NG").map(c => c.name) ?? [] });
    }
  }
  evidence.saveText("t5-summary.csv", csv.join("\n") + "\n", "every avatar, mode, motion and solver of this block (the tests' ik-summary.csv together)", "data");
  evidence.saveJson("t5-verdicts.json", verdicts, "per avatar and mode: the old and the new solver over all motions, and the test's status");
  await evidence.check("Per avatar and mode: the new solver against the old (all motions)", "V6", async () => {
    const line = (v: any) =>
      `${v.avatar} ${v.mode}: ${v.status}; hand ${n(v.old.handErrMean)}→${n(v.new.handErrMean)} cm (max ${n(v.old.handErrMax)}→${n(v.new.handErrMax)}), wrong elbows ${v.old.elbowWrong}→${v.new.elbowWrong}, knees ${v.old.kneeWrong}→${v.new.kneeWrong}, sole ${n(v.old.footMin)}→${n(v.new.footMin)} cm, jump ${n(v.old.jumpPosMax)}→${n(v.new.jumpPosMax)} cm, NaN ${v.old.nanFrames}→${v.new.nanFrames}`;
    return { ok: verdicts.every(v => v.status === "OK"), summary: verdicts.map(line).join("; "), data: verdicts };
  });
  fs.rmSync(evidence.file(".ffmpeg"), { recursive: true, force: true });
}

// ---------- Tests ----------

for (const server of SERVERS) {
  const title = blockTitle(server);
  test.describe(`T5 inverse kinematics on ${title}`, () => {
    for (const avatar of T5_AVATARS) {
      for (const mode of MODES) {
        test(`T5 inverse kinematics, old solver against new: ${AVATAR_TITLE[avatar]}, ${MODE_TITLE[mode]}, on ${title}`, meta(avatar, mode, server), async ({ evidence }) => {
          runsOn(server);
          await ikTest(evidence, server, avatar, mode);
        });
      }
    }
    test(`T5 contact sheets and summary videos per avatar, on ${title}`, meta("summary", null, server), async ({ evidence }) => {
      runsOn(server);
      await summaryTest(evidence, server);
    });
  });
}

