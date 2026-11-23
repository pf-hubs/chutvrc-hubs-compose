// T5 inverse kinematics (plan 4, T5). One subject (QUEST for VR, DESK for desktop) moves through the motion
// battery (motions/: M1 to M10 and H1 in VR; stand still, look around, snap turn and walk on desktop); a DESK
// observer stands at one spot with a view of it. The observer's inverse kinematics probe (probes/ik.ts) measures
// every frame against the pose its solver was given, and its page is recorded by a screencast with the PC's time
// on every frame. The subject records its own view (its Playwright video): first person in VR; on desktop first
// person during the motions and then ?thirdPerson's camera behind the avatar for a walk and a turn (in that
// camera a mouse drag does not turn the head the client sends).
//
// The client has one body solver, so a motion is judged against fixed limits taken from FIXES.md ("F4 after the
// shoulder fix"): the hand on the controller per motion, the eyes on the headset, the soles on the floor, no joint
// bent to the wrong side, no NaN. The body is always read from the observer: a client shrinks its own head bone in
// first person.
//
// The body calibration (fix F4): a headset subject has a calibrated body, a person 1.73 m tall, its values put
// into the preferences before entry as a player who calibrated earlier has them, confirmed with "Continue" on the
// form every VR entry shows (T5a in t5-calibration.spec.ts fills the form itself). Its headset is held at the first
// pose of the motions when it enters VR, and both triggers take that height. It announces its standing eye
// height, and the observer draws its model at that height over the model's eye height. Each avatar runs in VR with
// both fits, "Fit the avatar to me" (the model drawn at the player's size) and "Fit me to the avatar" (the player's
// rig scaled to the model's eye height), standing; the Ready Player Me sample also seated (the emulated headset
// 0.47 m lower, at 1.15 m, the tracking offset lifting it to the standing eye height) with stand still, crouch,
// reach and walk. On desktop the subject has no calibration: the screen solver draws the model at its own size and
// no eye height is announced. One test per avatar, fit and posture on each media server; a last test per block
// builds the contact sheet and the summary video of each avatar (report/side-by-side.ts) from the tests that ran,
// both fits on one sheet.
//
// Known failure #1 of BASELINE.md (the avatar announced once) is fixed (F2); the logged re-announce still
// runs unless AVATAR_REANNOUNCE=0 turns it off.
import fs from "node:fs";
import path from "node:path";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { runDir, type TestResult } from "../report/evidence";
import { room, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import { enterRoom, type BodyFit, type BodyPosture, type EnterOptions, type EntryTimings } from "../clients/enter";
import { avatarReannounceEnabled } from "../clients/workarounds";
import * as input from "../clients/input";
import { playTimeline, takeApplied, type Keyframe, type Timeline } from "../clients/motion";
import { hideAvatarsExcept, observerPlace, placeRig, sceneLights, type Framing } from "../clients/stage";
import { bodyState, ownView, captureLog, markXrSessions, EYE_HEIGHT_SHARE } from "../probes/calibration";
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
const FITS = ["avatarToPlayer", "playerToAvatar"] as const satisfies readonly BodyFit[];
export const FIT_TITLE: Record<BodyFit, string> = { avatarToPlayer: "Fit the avatar to me", playerToAvatar: "Fit me to the avatar" };
const FIT_TAG: Record<BodyFit, string> = { avatarToPlayer: "fit-avatar", playerToAvatar: "fit-player" };

/** One T5 test's subject: desktop, or a headset with a fit and a posture */
export type Variant = { mode: Mode; fit: BodyFit | null; posture: BodyPosture };
const variantTitle = (v: Variant) => (v.mode === "desktop" ? MODE_TITLE.desktop : `${MODE_TITLE.vr}, "${FIT_TITLE[v.fit!]}", ${v.posture}`);
const variantTag = (v: Variant) => (v.mode === "desktop" ? "desktop" : `vr-${FIT_TAG[v.fit!]}${v.posture === "sitting" ? "-sitting" : ""}`);
export const variantLabel = (v: { mode: Mode; fit?: BodyFit | null; posture?: BodyPosture }) =>
  v.mode === "desktop" ? "desktop" : `VR · ${v.fit ? FIT_TITLE[v.fit] : "?"}${v.posture === "sitting" ? " · seated" : ""}`;

/** The headset subject: a person 1.73 m tall (the motion battery's), so the entered height and the captured headset agree */
const SUBJECT_HEIGHT_CM = 173;
/** The seated headset's height (plan, section 3): the motions are played this much lower than standing */
const SEATED_HEADSET = 1.15;
/** The motions a seated subject plays: stand still, crouch, reach, walk */
const SEATED_MOTIONS: MotionId[] = ["m01", "m03", "m05", "m08"];
/** Limits of the plan's F4 rows: eyes on the headset, soles on the floor, the drawn size */
const EYE_LIMIT_CM = 2;
const SOLE_LIMIT_CM = 1;
const SIZE_AGREEMENT = 0.01;

/** The subject at the crater's centre facing -z (toward the sun); the observers 2.2 m away, 35° to its left, looking at its middle */
const FRAMING: Framing = { subject: { x: 0, z: 0, yawDeg: 0 }, distance: 2.2, bearingDeg: 35, aimHeight: 0.95 };
/** The part of an observer's 1280 x 720 window the videos and the contact sheet show: the subject with room for its reach and steps (the toolbar and side panels left out) */
export const CROP: Crop = { x: 320, y: 48, w: 640, h: 480 };
/**
 * The largest mean distance from hand bone to controller FIXES.md records for each motion after the shoulder fix,
 * in cm: over every avatar, fit and posture on Dialog, and for M05 also on the local LiveKit server (its 6.6)
 */
const HAND_RECORDED_CM: Record<MotionId, number> = { m01: 0, m02: 0.3, m03: 0.4, m04: 0.3, m05: 6.6, m06: 0.3, m07: 0.4, m08: 0, m09: 0.8, m10: 3.1, h1: 1.2 };
/** A motion's limit: the recorded value with the margin of the comparison this replaces (10% and 5 mm) */
const handLimitCm = (id: MotionId) => +(HAND_RECORDED_CM[id] * 1.1 + 0.5).toFixed(2);
/** Below this share of the frames an observer drew the subject on, a motion's numbers are not trusted */
const MIN_FRAME_SHARE = 0.8;

const meta = (avatar: T5Avatar | "summary", variant: Variant | null, server: MediaServer) => ({
  annotation: [
    { type: "id", description: avatar === "summary" ? `t5-summary-${blockId(server)}` : `t5-${avatar}-${variantTag(variant!)}-${blockId(server)}` },
    { type: "covers", description: "V6" }
  ]
});

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
  /** The observer's frame at that moment, relative to the evidence folder */
  frame: string | null;
  cast: { frames: number; perSecond: number };
  ik: IkSummary;
  atTell: IkFrame | null;
  drawn: { frames: number; missing: number; share: number };
  ikErrors: string[];
  /** How far the subject's rig moved and turned (desktop walk, thumbstick, snap turns) */
  subject: { travelled: number; turnedDeg: number };
  video: string | null;
};

export type T5Record = {
  avatar: T5Avatar;
  avatarTitle: string;
  mode: Mode;
  /** VR: the subject's fit and posture; null and "standing" on desktop */
  fit: BodyFit | null;
  posture: BodyPosture;
  /** What the calibration check read: the subject's own view and the observer's drawn size */
  calibration: unknown;
  server: MediaServer;
  block: string;
  url: string;
  info: IkInfo | null;
  motions: MotionResult[];
  crop: Crop;
};

// ---------- The session ----------

type Session = {
  subject: Client;
  observer: Client;
  ids: { subject: string; observer: string };
  url: string;
  mode: Mode;
  variant: Variant;
  /** How far the motions are moved up or down from the battery's standing poses (seated: the headset lower) */
  dy: number;
  entry: EntryTimings | null;
};

/** The battery's standing headset height: its first keyframe (the eyes of a person 1.73 m tall) */
const STANDING_HEADSET = VR_MOTIONS[0]().timeline.keyframes[0].head!.pos[1];

/** A timeline with every pose moved up by dy (negative: down), as a seated player's headset and controllers are lower */
export function shiftTimeline(tl: Timeline, dy: number): Timeline {
  if (!dy) return tl;
  const move = <P extends { pos: [number, number, number] }>(p: P | undefined): P | undefined => (p ? { ...p, pos: [p.pos[0], p.pos[1] + dy, p.pos[2]] } : p);
  return { ...tl, keyframes: tl.keyframes.map(k => ({ ...k, head: move(k.head), left: move(k.left), right: move(k.right) }) as Keyframe) };
}

/** Holds the motions' first pose (moved by dy) for `ms` */
function holdFirstPose(dy: number, ms: number): Timeline {
  const first = shiftTimeline(VR_MOTIONS[0]().timeline, dy).keyframes[0];
  return { name: "hold the first pose", keyframes: [{ ...first, t: 0 }, { ...first, t: ms }] };
}

async function startSession(evidence: Evidence, server: MediaServer, avatar: T5Avatar, variant: Variant): Promise<Session> {
  const mode = variant.mode;
  const missing = missingAvatars();
  if (missing.length) throw new Error(`avatar files missing (${missing.join(", ")}): npx tsx assets/avatars.ts`);
  const hub = room(mainRoom(server));
  const url = avatarUrl(avatar);
  const [subject, observer] = await startClients(evidence, [
    mode === "vr" ? { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" } : { identity: "t5-subject", slot: "a", name: "A-desk" },
    { identity: "t5-new", slot: "c", name: "C-observer", recordVideo: false }
  ]);
  const dy = mode === "vr" && variant.posture === "sitting" ? SEATED_HEADSET - STANDING_HEADSET : 0;
  evidence.note(
    `room ${hub.hubId} (${hub.mediaServer}); subject ${subject.name} (${subject.profile}) with ${AVATARS[avatar].describe} (${url}); ` +
      `observer C-observer (DESK); its page is recorded by the DevTools screencast (time-stamped frames), not by Playwright's video`
  );
  evidence.note(
    mode === "vr"
      ? `subject: body calibration ${SUBJECT_HEIGHT_CM} cm, ${variant.posture}, "${FIT_TITLE[variant.fit!]}", put into its preferences before entry and confirmed on the form; its headset held at ${(STANDING_HEADSET + dy).toFixed(2)} m when it enters VR, both triggers pressed to take that height` +
          (dy ? ` (seated: every motion played ${Math.abs(dy).toFixed(2)} m lower than standing; the tracking offset lifts it to the standing eye height)` : "")
      : "subject: no height saved (desktop needs no calibration)"
  );
  const session = { subject, observer, url, mode, variant, dy, entry: null } as unknown as Session;
  const [entry] = await Promise.all([enterSubject(session, hub.hubId), enterRoom(observer, hub.hubId, { displayName: observer.name })]);
  session.entry = entry;
  if (mode === "desktop") {
    evidence.note(
      "subject's own view: first person during the motions (in the third-person camera a mouse drag does not turn the head the client sends, TRIALS.md step 7), then ?thirdPerson's camera behind the avatar (the O key) for a walk and a turn at the end"
    );
  } else {
    evidence.note("subject's own view: first person in the emulated headset (IWER draws one eye into the window)");
  }
  session.ids = { subject: await idOf(subject), observer: await idOf(observer) };
  return session;
}

/**
 * The subject enters with its avatar. In VR its calibration is put into the preferences before Join Room,
 * the form confirms it, and its headset is held at the motions' first pose (moved for a seated subject) when it
 * enters VR, where both triggers take that height; the page logs each session start (markXrSessions). On
 * desktop with ?thirdPerson, which lets the O key move the camera behind the avatar, and no height saved.
 */
async function enterSubject(s: Session, hubId: string): Promise<EntryTimings> {
  const vr = s.mode === "vr";
  const opts: EnterOptions = {
    displayName: s.subject.name,
    avatarUrl: s.url,
    query: vr ? undefined : "?thirdPerson",
    preferences: vr ? undefined : { bodyHeightCm: 0 },
    calibration: vr ? { via: "seed", heightCm: SUBJECT_HEIGHT_CM, posture: s.variant.posture, fit: s.variant.fit! } : undefined,
    beforeEnter: vr
      ? async page => {
          await markXrSessions(page);
          await playTimeline(page, holdFirstPose(s.dy, 200));
        }
      : undefined
  };
  return enterRoom(s.subject, hubId, opts);
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
 * The observer must have the subject's model (with the subject's avatar) and receive its poses. The
 * announcement is sent again until it does (known failure #1). When it receives no pose from the subject, the
 * subject's sending failed (the one-way failure, BASELINE.md #3 and #21) and the subject enters the room again;
 * when that did not help, the observer enters again; each once.
 */
async function ensureObserverSeesSubject(evidence: Evidence, s: Session, hubId: string) {
  const sees = async () => {
    const state = await avatarState(s.observer.page, s.ids.subject).catch(() => null);
    const pose = await s.observer.page.evaluate(id => (window as any).APP.avatarPoses?.get(id)?.seq ?? -1, s.ids.subject);
    return { model: !!state && state.eid !== null && state.avatarId === s.url, pose };
  };
  const tries: string[] = [];
  let observerReentered = false;
  let subjectReentered = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (avatarReannounceEnabled()) await s.subject.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
    await s.subject.page.waitForTimeout(3000);
    const before = await sees();
    await s.subject.page.waitForTimeout(600);
    const after = await sees();
    const arriving = after.pose > before.pose;
    tries.push(`try ${attempt}: model ${after.model ? "yes" : "no"}, poses ${arriving ? "arriving" : "not arriving"}`);
    if (after.model && arriving) {
      evidence.note(
        avatarReannounceEnabled()
          ? `workaround applied: the subject's avatar announcement (#avatarId) sent ${attempt} time(s) after entry until the observer drew its model (known failure: the first one goes out before the channel is open); ${tries.join(" | ")}`
          : `the observer drew the subject's model and received its poses (avatar re-announce workaround off), after ${attempt} look(s): ${tries.join(" | ")}`
      );
      return true;
    }
    if (attempt >= 3 && after.pose === before.pose) {
      if (!subjectReentered) {
        subjectReentered = true;
        tries.push("the observer received no pose from the subject (one-way failure on the subject's side): the subject enters the room again");
        s.entry = await enterSubject(s, hubId);
        s.ids.subject = await idOf(s.subject);
      } else if (!observerReentered) {
        observerReentered = true;
        tries.push("still no pose from the subject (one-way failure): the observer enters the room again");
        await enterRoom(s.observer, hubId, { displayName: s.observer.name });
        s.ids.observer = await idOf(s.observer);
      }
    }
  }
  evidence.note(`the observer did not draw the subject: ${tries.join(" | ")}`);
  return false;
}

/** The subject and the observer in their places; the observer's own model hidden from its view */
async function stage(evidence: Evidence, s: Session) {
  const place = observerPlace(FRAMING);
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  await placeRig(s.observer.page, place.x, place.z, place.yawDeg, place.pitchDeg);
  const hidden = await hideAvatarsExcept(s.observer, [s.ids.subject]);
  evidence.note(`${s.observer.name}: models moved out of its view (they stand where its camera is): ${hidden.length}`);
  const lights = await sceneLights(s.subject.page);
  evidence.saveJson("staging.json", { framing: FRAMING, observer: place, crop: CROP, lights }, "where the subject and the observer stand, the observer's crop, the scene's lights");
}

/**
 * The subject stands still at its place, and what the calibration did is read: in VR the headset's capture,
 * the announced eye height (the observer holds it), the subject's own view height and rig scale, and the size
 * the observer draws the model at (the announced eye height over the model's own). On desktop the screen solver
 * draws the model at its own size and nothing is announced. Returns what it read, for the record.
 */
async function checkCalibration(evidence: Evidence, s: Session): Promise<unknown> {
  if (s.mode === "vr") {
    await playTimeline(s.subject.page, holdFirstPose(s.dy, 1500));
    await takeApplied(s.subject.page);
  } else {
    await s.subject.page.waitForTimeout(1500);
  }
  const own = await ownView(s.subject.page);
  const drawn = await bodyState(s.observer.page, s.ids.subject);
  const captures = captureLog(s.subject);
  const read = { entry: s.entry?.calibration ?? null, own, drawn, captures };
  if (s.mode !== "vr") {
    await evidence.check("Desktop: no calibration step, the screen solver, the model's own size, no eye height announced", "V6", async () => {
      const ok =
        s.entry?.calibration === "none" &&
        s.entry?.calibrationShown === undefined &&
        own.announced === null &&
        own.rigScale === 1 &&
        drawn.solver === "screen" &&
        Math.abs((drawn.rootScale ?? 0) - 1) < 1e-4 &&
        drawn.announced === null;
      return {
        ok,
        summary:
          `entry calibration ${s.entry?.calibration} (form ${s.entry?.calibrationShown === undefined ? "not shown" : "shown"}); the subject announces ${own.announced ?? "nothing"}, rig scale ${own.rigScale}; ` +
          `the observer: ${drawn.solver ?? "no"} solver, root scale ${drawn.rootScale}, eye height held ${drawn.announced ?? "none"}`,
        data: read
      };
    });
    return read;
  }

  const v = s.variant;
  const captured = captures.filter(c => c.kind === "captured").pop()?.height ?? null;
  const entered = (SUBJECT_HEIGHT_CM / 100) * EYE_HEIGHT_SHARE;
  // P: the captured standing headset, or the entered height seated (the plan's F4.2)
  const player = v.posture === "sitting" ? entered : captured;
  const modelEye = own.ownModelEye;
  const announcedWanted = v.fit === "playerToAvatar" ? modelEye : player;
  const rigWanted = v.fit === "playerToAvatar" && modelEye && player ? modelEye / player : 1;
  const viewWanted = player !== null ? player * rigWanted : null;
  await evidence.check("The body calibration as applied on the subject: capture, announced eye height, its own view", "V6", async () => {
    const near = (a: number | null, b: number | null, tol: number) => a !== null && b !== null && Math.abs(a - b) <= tol;
    const wantCapture = STANDING_HEADSET + s.dy;
    const ok =
      near(captured, wantCapture, 0.005) &&
      near(own.announced, announcedWanted, 0.002) &&
      near(own.rigScale, rigWanted, 0.002) &&
      near(own.viewHeight, viewWanted, 0.01);
    return {
      ok,
      summary:
        `entry: calibration ${s.entry?.calibration}, form button "${s.entry?.calibrationButton ?? "?"}", triggers answered ${s.entry?.captured ?? "?"}; captured headset ${captured?.toFixed(3) ?? "none"} m (held at ${wantCapture.toFixed(3)}); the player's standing eye height ${player?.toFixed(3) ?? "?"} m` +
        `${v.posture === "sitting" ? ` (from ${SUBJECT_HEIGHT_CM} cm: ${entered.toFixed(3)}; tracking offset ${captured !== null && player !== null ? (player - captured).toFixed(3) : "?"} m)` : ""}; ` +
        `announced ${own.announced ?? "nothing"} (wanted ${announcedWanted?.toFixed(3)}); rig scale ${own.rigScale} (wanted ${rigWanted.toFixed(4)}); ` +
        `the wearer's view ${own.viewHeight.toFixed(3)} m over the floor (wanted ${viewWanted?.toFixed(3)}: ${v.posture === "sitting" ? "standing eye height, " : ""}${v.fit === "playerToAvatar" ? "the model's eye height" : "the player's"}); sends the head at ${own.sentHeadY} m`,
      data: { ...read, captured, player, announcedWanted, rigWanted, viewWanted }
    };
  });
  await evidence.check("The observer draws the model at the announced eye height over the model's", "V6", async () => {
    const want = drawn.announced && drawn.modelEye ? Math.min(2, Math.max(0.3, drawn.announced / drawn.modelEye)) : null;
    const ok =
      want !== null &&
      drawn.modelRatio !== null &&
      Math.abs(drawn.modelRatio - want) <= SIZE_AGREEMENT * want &&
      Math.abs((drawn.rootScale ?? 0) - drawn.modelRatio) < 1e-4 &&
      drawn.solver === "vr";
    return {
      ok,
      summary: `the observer holds ${drawn.announced ?? "no"} m, model eye ${drawn.modelEye} m, ratio ${drawn.modelRatio} (wanted ${want?.toFixed(4) ?? "?"}), root scale ${drawn.rootScale}, ${drawn.solver} solver`,
      data: drawn
    };
  });
  return { ...read, captured, player, announcedWanted, rigWanted, viewWanted };
}

// ---------- One motion ----------

type Raw = {
  from: number;
  to: number;
  tellPc0: number;
  own: FrameSample[];
  copy: FrameSample[];
  ik: Awaited<ReturnType<typeof stopIk>>;
  cast: CastFrame[];
};

/** Records the subject's own pose, the observer's copy, its probe and its screencast while `during` runs */
async function record(s: Session, castDir: string, during: () => Promise<number>): Promise<Raw> {
  const key = `t5-${Date.now()}`;
  await startFrameRecorder(s.subject.page, key, [SELF]);
  await startFrameRecorder(s.observer.page, key, [s.ids.subject]);
  await startIk(s.observer.page, key, s.ids.subject);
  const screencast = await Screencast.start(s.observer, castDir);
  const from = Date.now();
  await s.subject.page.waitForTimeout(250);
  let tellPc0 = from;
  try {
    tellPc0 = await during();
  } finally {
    // The observer shows a pose about 100 ms after it was sent (the interpolation delay)
    await s.subject.page.waitForTimeout(600);
  }
  const to = Date.now();
  const cast = await screencast.stop();
  const own = (await stopFrameRecorder(s.subject.page, key))[SELF] ?? [];
  const copy = (await stopFrameRecorder(s.observer.page, key))[s.ids.subject] ?? [];
  const ik = await stopIk(s.observer.page, key);
  return { from, to, tellPc0, own, copy, ik, cast };
}

/** The headset and controllers to the motion's first pose, held, so the observers have settled on it before recording */
async function settleVr(s: Session, motion: Motion) {
  const first = shiftTimeline(motion.timeline, s.dy).keyframes[0];
  await playTimeline(s.subject.page, { name: "settle", keyframes: [{ ...first, t: 0 }, { ...first, t: 700 }] } as Timeline);
  await takeApplied(s.subject.page);
  await s.subject.page.waitForTimeout(300);
}

async function playVr(s: Session, motion: Motion): Promise<number> {
  await playTimeline(s.subject.page, shiftTimeline(motion.timeline, s.dy));
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

/** How far the observer's copy runs behind the subject's own pose, from the channel that moved most */
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
  const lag = estimateLag(raw.own, raw.copy);
  const lagMs = lag.lagMs === null ? null : Math.round(lag.lagMs);
  if (lagMs !== null) lags.push(lagMs);
  const usedLag = lagMs ?? (lags.length ? lags[lags.length - 1] : DEFAULT_LAG_MS);
  const tellPc = raw.tellPc0 + usedLag;

  let frame: string | null = null;
  const shot = frameAt(raw.cast, tellPc);
  if (shot) {
    frame = `t5-frames/${s.mode}-${motion.id}.jpg`;
    fs.mkdirSync(evidence.file("t5-frames"), { recursive: true });
    fs.copyFileSync(shot.file, evidence.file(frame));
    evidence.addFile(frame, "screenshot", `${s.mode === "vr" ? "VR" : "desktop"} ${motion.id.toUpperCase()} ${motion.title}: ${motion.tellWhat}`, s.observer.name);
  }
  const result: MotionResult = {
    id: motion.id,
    title: motion.title,
    summary: motion.summary,
    mode: s.mode,
    tellWhat: motion.tellWhat,
    window: { from: raw.from, to: raw.to },
    tellPc,
    lagMs,
    lagFrom: lagMs === null ? `not measured (${lag.from}), ${usedLag} ms used` : `${lagMs} ms from ${lag.from}`,
    frame,
    cast: { frames: raw.cast.length, perSecond: castRate(raw.cast) },
    ik: summariseIk(raw.ik.frames),
    atTell: nearestIkFrame(raw.ik.frames, tellPc),
    drawn: { frames: raw.ik.frames.length, missing: raw.ik.missing, share: +(raw.ik.frames.length / Math.max(1, raw.ik.frames.length + raw.ik.missing)).toFixed(3) },
    ikErrors: raw.ik.errors,
    subject: subjectMovement(raw.own),
    video: null
  };
  return { result, raw };
}

// ---------- The test ----------

const pass = (r: MotionResult) => ({
  nan: r.ik.nanFrames === 0,
  sides: r.ik.elbowWrong === 0 && r.ik.kneeWrong === 0,
  /** VR: the mean distance from hand bone to controller within the motion's limit */
  hand: r.mode !== "vr" || r.ik.handErrMean === null ? null : r.ik.handErrMean <= handLimitCm(r.id),
  /** VR (F4): the drawn eyes within 2 cm of the headset on average, the knee slack taken into account */
  eyes: r.mode !== "vr" || r.ik.eyeErrSlackMean === null ? null : r.ik.eyeErrSlackMean < EYE_LIMIT_CM,
  /**
   * F4: no sole more than 1 cm under the floor; standing still, both within 1 cm of it once settled (the second
   * half of the motion: feet step over time, so one may still be landing when the recording starts)
   */
  soles:
    r.ik.footMin === null
      ? null
      : r.ik.footMin >= -SOLE_LIMIT_CM && (r.id !== "m01" || (r.ik.footMaxSettled !== null && r.ik.footMaxSettled <= SOLE_LIMIT_CM))
});

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

async function ikTest(evidence: Evidence, server: MediaServer, avatar: T5Avatar, variant: Variant) {
  test.setTimeout(40 * 60_000);
  const mode = variant.mode;
  const hub = room(mainRoom(server));
  const s = await startSession(evidence, server, avatar, variant);
  const seen = await ensureObserverSeesSubject(evidence, s, hub.hubId);
  if (!seen) throw new Error("the observer does not draw the subject; nothing can be measured");
  await stage(evidence, s);
  const calibration = await checkCalibration(evidence, s);
  await s.subject.page.waitForTimeout(1000);
  await evidence.screenshot(s.observer, "framing-observer");
  await evidence.screenshot(s.subject, "own-view");
  await frameRateCheck(evidence, [s.subject, s.observer]);

  const info = await ikInfo(s.observer.page, s.ids.subject);
  await evidence.check("The probe's maths against known answers", "V6", async () => {
    const cases = ikSelfTest();
    const own = mode === "vr" ? await ikOwnCheck(s.subject.page) : null;
    const ownOk = !own || (["head", "left", "right"] as const).every(p => own[p].positionMm < 1 && own[p].turnDeg < 0.1);
    return {
      ok: cases.every(c => c.ok) && ownOk,
      summary:
        `${cases.filter(c => c.ok).length} of ${cases.length} cases with known answers (rig to room, YXZ turns, elbow and knee sides, the hand grip)` +
        (own ? `; the headset's own pose through the probe against the scene's own objects: head ${own.head.positionMm} mm, hands ${own.left.positionMm} and ${own.right.positionMm} mm, turns ${own.head.turnDeg}°, ${own.left.turnDeg}°, ${own.right.turnDeg}°` : ""),
      data: { cases, own, info }
    };
  });

  const rawDir = evidence.file(".raw-frames");
  const battery: (Motion | DesktopMotion)[] = mode === "vr" ? [...VR_MOTIONS.map(m => m()), convertBotRecording()] : DESKTOP_MOTIONS;
  const all = variant.posture === "sitting" ? battery.filter(m => SEATED_MOTIONS.includes(m.id)) : battery;
  if (variant.posture === "sitting") evidence.note(`seated: the motions ${SEATED_MOTIONS.join(", ")} (stand still, crouch, reach, walk), each ${Math.abs(s.dy).toFixed(2)} m lower than the battery's standing poses`);
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
    csvRows.push({ labels: { avatar, mode, motion: motion.id }, frames: raw.ik.frames });
  }
  if (mode === "desktop") await thirdPersonOwnView(evidence, s);
  // Back at the start, so the closing screenshots show the subject
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);

  evidence.saveText("ik-metrics.csv", ikCsv(csvRows), "every observer frame of every motion: the inverse kinematics probe's numbers (probes/ik.ts)", "data");
  const summaryRows = [["avatar", "mode", "motion", ...Object.keys(results[0].ik)].join(",")];
  for (const r of results) summaryRows.push([avatar, mode, r.id, ...Object.values(r.ik).map(v => (v === null ? "" : v))].join(","));
  evidence.saveText("ik-summary.csv", summaryRows.join("\n") + "\n", "per motion: hand, eye and head errors, wrong-side joints, feet, jumps, twist, NaN", "data");
  const record: T5Record = { avatar, avatarTitle: AVATAR_TITLE[avatar], mode, fit: variant.fit, posture: variant.posture, calibration, server, block: blockId(server), url: s.url, info, motions: results, crop: CROP };
  evidence.saveJson("t5.json", record, "the motions with their summaries, the frames shown and the lag used (read by the T5 summary test)");
  evidence.saveJson("motions.json", motions.map(m => ("timeline" in m ? { id: m.id, title: m.title, summary: m.summary, tellAtMs: m.tellAtMs, client: m.client } : m)), "the motions played: the poses the client was to send (VR) or the input steps (desktop)");

  await evidence.check("The observer drew the subject throughout every motion", "V6", async () => {
    const low = results.filter(r => r.drawn.share < MIN_FRAME_SHARE || r.drawn.frames < 60);
    return {
      ok: low.length === 0,
      summary: low.length ? `too few frames: ${low.map(r => `${r.id} (${r.drawn.frames})`).join(", ")}` : `every motion: ${results.map(r => `${r.id} ${r.drawn.frames}`).join(", ")} frames`,
      data: results.map(r => ({ id: r.id, drawn: r.drawn, cast: r.cast, lag: r.lagFrom, ikErrors: r.ikErrors }))
    };
  });
  await evidence.check("No NaN in any bone", "V6", async () => {
    const bad = results.filter(r => !pass(r).nan);
    return { ok: bad.length === 0, summary: bad.length ? bad.map(r => `${r.id}: ${r.ik.nanFrames} frames`).join(", ") : `none in ${results.reduce((a, r) => a + r.ik.frames, 0)} frames` };
  });
  await evidence.check("No elbow or knee bent to the wrong side", "V6", async () => {
    const rows = results.map(r => `${r.id} ${r.ik.elbowWrong}/${r.ik.kneeWrong}`);
    return {
      ok: results.every(r => pass(r).sides),
      summary: `frames with an elbow / a knee on the wrong side (bent 20° or more, folding over 90° away from the anatomical way): ${rows.join(", ")}`,
      data: results.map(r => ({ id: r.id, elbowWrong: r.ik.elbowWrong, elbowSideMax: r.ik.elbowSideMax, kneeWrong: r.ik.kneeWrong, kneeSideMax: r.ik.kneeSideMax }))
    };
  });
  if (mode === "vr") {
    await evidence.check("Hand error within each motion's limit (FIXES.md after the shoulder fix, plus 10% and 5 mm)", "V6", async () => {
      const judged = results.filter(r => pass(r).hand !== null);
      const rows = judged.map(r => `${r.id} ${n(r.ik.handErrMean, 2)} of ${n(handLimitCm(r.id), 2)} cm${pass(r).hand ? "" : " (over)"}`);
      const ratio = results.find(r => r.ik.modelRatio !== null)?.ik.modelRatio ?? null;
      return {
        ok: judged.length > 0 && judged.every(r => pass(r).hand),
        summary: `mean distance from hand bone to controller against the limit: ${rows.join(", ")}; the model is drawn at ${ratio ?? "?"} of its size; hands measured from ${info?.handSource.left ?? "nothing"} and ${info?.handSource.right ?? "nothing"}`,
        data: judged.map(r => ({ id: r.id, mean: r.ik.handErrMean, max: r.ik.handErrMax, rotMean: r.ik.handRotErrMean, rotMax: r.ik.handRotErrMax, modelRatio: r.ik.modelRatio, recordedCm: HAND_RECORDED_CM[r.id], limitCm: handLimitCm(r.id) }))
      };
    });
    await evidence.check(`Eyes on the headset, under ${EYE_LIMIT_CM} cm with the knee slack taken into account (raw distance beside it)`, "V6", async () => {
      const rows = results.map(r => `${r.id} ${n(r.ik.eyeErrSlackMean)} (raw ${n(r.ik.eyeErrMean)}, eyes ${n(r.ik.eyeDyMean)} cm against the headset)${pass(r).eyes === false ? " NG" : ""}`);
      return {
        ok: results.every(r => pass(r).eyes !== false),
        summary: `mean distance from the eyes to the headset less the slack of 3 cm x ${results[0]?.ik.modelRatio ?? "?"}, per motion, cm: ${rows.join(", ")}`,
        data: results.map(r => ({ id: r.id, slackMean: r.ik.eyeErrSlackMean, slackMax: r.ik.eyeErrSlackMax, rawMean: r.ik.eyeErrMean, rawMax: r.ik.eyeErrMax, dyMean: r.ik.eyeDyMean }))
      };
    });
  } else {
    evidence.note("desktop: the pose has no controllers (hands untracked), so hand error is not judged");
  }
  await evidence.check(`Soles on the floor (none more than ${SOLE_LIMIT_CM} cm under it; standing still, both within ${SOLE_LIMIT_CM} cm once settled)`, "V6", async () => {
    const rows = results.map(r => `${r.id} ${n(r.ik.footMin)} to ${n(r.ik.footMax)}${r.id === "m01" ? ` (settled ${n(r.ik.footMaxSettled)})` : ""}${pass(r).soles === false ? " NG" : ""}`);
    return {
      ok: results.every(r => pass(r).soles !== false),
      summary: `lowest to highest sole over the floor per motion, cm (a foot lifts in a step): ${rows.join(", ")}`,
      data: results.map(r => ({ id: r.id, min: r.ik.footMin, max: r.ik.footMax, maxSettled: r.ik.footMaxSettled, below: r.ik.belowFloorFrames }))
    };
  });
  await closingChecks(evidence, [s.subject, s.observer], [
    {
      pattern: /^Tried to toggle mic but there's no producer\. /,
      types: ["error"],
      reason: "known failure #2 of BASELINE.md (Dialog: the microphone wish lost at entry), already on develop; T5 does not use the microphone"
    }
  ]);

  // The videos are made once the browsers are closed, so ffmpeg does not take their processor time
  for (const c of [s.subject, s.observer]) await c.close();
  const workDir = evidence.file(".ffmpeg");
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = `t5-${mode}-${r.id}.mp4`;
    try {
      sideBySideVideo({
        panes: [{ frames: raws[i].cast, label: "seen by the observer" }],
        from: r.window.from,
        to: r.window.to,
        crop: CROP,
        title: `${AVATAR_TITLE[avatar]} · ${variantLabel(variant)} · ${r.id.toUpperCase()} ${r.title} · ${blockTitle(server)}`,
        out: evidence.file(name),
        workDir
      });
      r.video = name;
      evidence.addFile(name, "video", `${r.id.toUpperCase()} ${r.title}, as the observer drew it`);
    } catch (e) {
      evidence.note(`video of ${r.id} not made: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  evidence.saveJson("t5.json", record, "the motions with their summaries, the frames shown and the lag used (read by the T5 summary test)");
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.rmSync(workDir, { recursive: true, force: true });
}

// ---------- Summary per avatar ----------

const METRIC_ROWS: { label: string; get: (s: IkSummary) => number | null; unit: string; d?: number }[] = [
  { label: "hand error mean", get: s => s.handErrMean, unit: "cm" },
  { label: "hand error max", get: s => s.handErrMax, unit: "cm" },
  { label: "hand turn error mean", get: s => s.handRotErrMean, unit: "°" },
  { label: "wrist bend max", get: s => s.wristMax, unit: "°", d: 0 },
  { label: "eyes to headset mean (raw)", get: s => s.eyeErrMean, unit: "cm" },
  { label: "eyes to headset, knee slack off", get: s => s.eyeErrSlackMean, unit: "cm" },
  { label: "drawn size / model's own", get: s => s.modelRatio, unit: "", d: 3 },
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
      const verdictText = [verdict.nan ? "" : "NaN", verdict.sides ? "" : "wrong-side joint", verdict.hand === false ? `hand error over ${n(handLimitCm(r.id), 2)} cm` : "", verdict.eyes === false ? "eyes off the headset" : "", verdict.soles === false ? "sole off the floor" : ""].filter(Boolean);
      const src = r.frame ? path.relative(summaryDir, path.join(dir, r.frame)).replace(/\\/g, "/") : "";
      const at = r.atTell;
      const atText = at
        ? [
            at.handErrL !== null || at.handErrR !== null ? `hands ${n(at.handErrL)} / ${n(at.handErrR)} cm` : "",
            at.elbowSideL !== null || at.elbowSideR !== null ? `elbow side ${n(at.elbowSideL, 0)}° / ${n(at.elbowSideR, 0)}°` : "",
            `soles ${n(at.footL)} / ${n(at.footR)} cm`,
            `twist ${n(at.twistHipsChest, 0)}°`
          ].filter(Boolean).join(" · ")
        : "no probe frame";
      const cell = `<div class="cell"><div class="crop" style="width:${CROP.w * scale}px;height:${CROP.h * scale}px">${src ? `<img src="${esc(src)}" style="left:${-CROP.x * scale}px;top:${-CROP.y * scale}px;width:${1280 * scale}px">` : '<span class="none">no frame</span>'}</div><div class="cap">${esc(atText)}</div></div>`;
      const metrics = METRIC_ROWS.map(m => {
        const value = m.get(r.ik);
        return value === null ? "" : `<tr><th>${esc(m.label)}</th><td>${n(value, m.d ?? 1)}</td><td class="u">${m.unit}</td></tr>`;
      }).join("");
      return `<div class="row">
        <div class="label"><div class="mode">${esc(variantLabel(record))}</div><b>${r.id.toUpperCase()}</b> ${esc(r.title)}<div class="muted">${esc(r.summary)}</div><div class="muted">shown: ${esc(r.tellWhat)}</div>
          <div class="verdict ${verdictText.length ? "ng" : "ok"}">${verdictText.length ? `NG (${esc(verdictText.join(", "))})` : "OK"}</div></div>
        ${cell}
        <table class="m">${metrics}<tr><th>bone that jumped most</th><td>${esc(r.ik.jumpBone ?? "–")}</td><td></td></tr></table>
      </div>`;
    })
  );
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px; font: 13px/1.35 "Segoe UI", system-ui, sans-serif; background: #f6f7f9; color: #1d2330; width: 1460px; }
    h1 { font-size: 20px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #5d6677; }
    .row { display: grid; grid-template-columns: 240px 480px 340px; gap: 10px; background: #fff; border: 1px solid #dde1e8; border-radius: 6px; padding: 8px; margin-bottom: 8px; align-items: start; }
    .label { font-size: 13px; } .label .muted { color: #5d6677; font-size: 12px; margin-top: 4px; }
    .mode { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 3px; background: #e4eff1; color: #3d6670; margin-bottom: 4px; }
    .verdict { margin-top: 6px; font-weight: 600; } .verdict.ok { color: #1e7f4f; } .verdict.ng { color: #b42335; }
    .crop { position: relative; overflow: hidden; background: #222; border-radius: 4px; } .crop img { position: absolute; }
    .none { color: #aaa; position: absolute; top: 45%; left: 40%; }
    .cap { font-size: 11px; color: #5d6677; margin-top: 3px; }
    table.m { border-collapse: collapse; font-size: 11.5px; width: 100%; } table.m th { text-align: left; font-weight: 400; color: #5d6677; padding: 1px 4px 1px 0; }
    table.m td { text-align: right; padding: 1px 4px; font-variant-numeric: tabular-nums; } table.m td.u { text-align: left; color: #5d6677; }
  </style></head><body>
    <h1>${esc(title)}</h1>
    <p>Each row: one motion; the frame is what the observer drew at that moment (PC time, after the measured lag), cropped to the subject; the values under it are that frame's, the table holds the whole motion. Hand numbers exist only in VR, where the pose has controllers.</p>
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
  const csv = [["avatar", "mode", "motion", ...Object.keys(found[0].record.motions[0].ik)].join(",")];
  const verdicts: Record<string, unknown>[] = [];
  for (const avatar of T5_AVATARS) {
    const order = (r: T5Record) => (r.mode === "desktop" ? 9 : (r.fit === "playerToAvatar" ? 2 : 0) + (r.posture === "sitting" ? 4 : 0));
    const mine = found.filter(f => f.record.avatar === avatar).sort((a, b) => order(a.record) - order(b.record));
    if (!mine.length) continue;
    const title = `T5 contact sheet: ${AVATAR_TITLE[avatar]} (${AVATARS[avatar].file}) on ${blockTitle(server)}, both fits`;
    const html = evidence.file(`sheet-${avatar}.html`);
    fs.writeFileSync(html, sheetHtml(title, mine, evidence.dir));
    await renderHtmlToPng(html, evidence.file(`sheet-${avatar}.png`));
    evidence.addFile(`sheet-${avatar}.png`, "sheet", title);
    evidence.addFile(`sheet-${avatar}.html`, "data", `${title} (HTML, the same with selectable numbers)`);
    const videos = mine.flatMap(f => f.record.motions.filter(r => r.video).map(r => path.join(f.dir, r.video!)));
    if (videos.length) {
      try {
        joinVideos(videos, evidence.file(`summary-${avatar}.mp4`), evidence.file(".ffmpeg"));
        evidence.addFile(`summary-${avatar}.mp4`, "video", `${AVATAR_TITLE[avatar]}: every motion of every fit, as the observer drew it`);
      } catch (e) {
        evidence.note(`summary video of ${avatar} not made: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    for (const f of mine) {
      const res: TestResult | null = fs.existsSync(path.join(f.dir, "result.json")) ? JSON.parse(fs.readFileSync(path.join(f.dir, "result.json"), "utf8")) : null;
      for (const r of f.record.motions) csv.push([avatar, variantLabel(f.record), r.id, ...Object.values(r.ik).map(v => (v === null ? "" : v))].join(","));
      const m = f.record.motions.map(r => r.ik);
      const vals = (g: (s: IkSummary) => number | null) => m.map(g).filter((v): v is number => v !== null);
      const avg = (v: number[]) => (v.length ? +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2) : null);
      const top = (v: number[]) => (v.length ? +Math.max(...v).toFixed(2) : null);
      const low = (v: number[]) => (v.length ? +Math.min(...v).toFixed(2) : null);
      const ik = {
        handErrMean: avg(vals(s => s.handErrMean)),
        handErrMax: top(vals(s => s.handErrMax)),
        eyeErrMean: avg(vals(s => s.eyeErrMean)),
        eyeErrSlackMean: avg(vals(s => s.eyeErrSlackMean)),
        eyeErrSlackMax: top(vals(s => s.eyeErrSlackMax)),
        footMax: top(vals(s => s.footMax)),
        modelRatio: m.length ? m[m.length - 1].modelRatio : null,
        elbowWrong: m.reduce((a, s) => a + s.elbowWrong, 0),
        kneeWrong: m.reduce((a, s) => a + s.kneeWrong, 0),
        footMin: low(vals(s => s.footMin)),
        belowFloorFrames: m.reduce((a, s) => a + s.belowFloorFrames, 0),
        jumpPosMax: top(vals(s => s.jumpPosMax)),
        jumpExcessMax: top(vals(s => s.jumpExcessMax)),
        twistMax: top(vals(s => s.twistMax)),
        nanFrames: m.reduce((a, s) => a + s.nanFrames, 0)
      };
      verdicts.push({ avatar, mode: variantLabel(f.record), test: f.id, status: res?.status ?? "unknown", ik, failedChecks: res?.checks.filter(c => c.status === "NG").map(c => c.name) ?? [] });
    }
  }
  evidence.saveText("t5-summary.csv", csv.join("\n") + "\n", "every avatar, mode and motion of this block (the tests' ik-summary.csv together)", "data");
  evidence.saveJson("t5-verdicts.json", verdicts, "per avatar and mode: the numbers over all motions, and the test's status");
  await evidence.check("Per avatar and mode, over all motions", "V6", async () => {
    const line = (v: any) =>
      `${v.avatar} ${v.mode}: ${v.status}; hand ${n(v.ik.handErrMean)} cm (max ${n(v.ik.handErrMax)}), eyes ${n(v.ik.eyeErrMean)} raw, ${n(v.ik.eyeErrSlackMean)} with the slack (max ${n(v.ik.eyeErrSlackMax)}), ratio ${v.ik.modelRatio ?? "–"}, wrong elbows ${v.ik.elbowWrong}, knees ${v.ik.kneeWrong}, sole ${n(v.ik.footMin)} cm, jump ${n(v.ik.jumpPosMax)} cm, NaN ${v.ik.nanFrames}`;
    return { ok: verdicts.every(v => v.status === "OK"), summary: verdicts.map(line).join("; "), data: verdicts };
  });
  fs.rmSync(evidence.file(".ffmpeg"), { recursive: true, force: true });
}

// ---------- Tests ----------

for (const server of SERVERS) {
  const title = blockTitle(server);
  test.describe(`T5 inverse kinematics on ${title}`, () => {
    for (const avatar of T5_AVATARS) {
      const variants: Variant[] = [
        ...FITS.map(fit => ({ mode: "vr" as const, fit, posture: "standing" as const })),
        ...(avatar === "rpm" ? FITS.map(fit => ({ mode: "vr" as const, fit, posture: "sitting" as const })) : []),
        { mode: "desktop", fit: null, posture: "standing" }
      ];
      for (const variant of variants) {
        test(`T5 inverse kinematics: ${AVATAR_TITLE[avatar]}, ${variantTitle(variant)}, on ${title}`, meta(avatar, variant, server), async ({ evidence }) => {
          runsOn(server);
          await ikTest(evidence, server, avatar, variant);
        });
      }
    }
    test(`T5 contact sheets and summary videos per avatar, on ${title}`, meta("summary", null, server), async ({ evidence }) => {
      runsOn(server);
      await summaryTest(evidence, server);
    });
  });
}

