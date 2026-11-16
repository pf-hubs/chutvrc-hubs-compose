// T5 inverse kinematics, old solver against new (plan 4, T5). One subject (QUEST for VR, DESK for desktop)
// moves through the motion battery (motions/: M1 to M10 and H1 in VR; stand still, look around, snap turn
// and walk on desktop); two DESK observers stand at the same spot with the same view of it, one with "Use
// the new avatar body solver (experimental)" off and one with it on. The setting belongs to the viewer, so
// both solve the same received poses and their frames line up. Each observer's inverse kinematics probe
// (probes/ik.ts) measures every frame against the pose its solver was given, and its page is recorded by a
// screencast with the PC's time on every frame, so the two can be put side by side at the same moments.
// The subject records its own view (its Playwright video): first person in VR; on desktop first person during
// the motions and then ?thirdPerson's camera behind the avatar for a walk and a turn (in that camera a mouse
// drag does not turn the head the client sends).
//
// The body calibration (fix F4): a headset subject wears the new solver with a calibrated body, a person
// 1.73 m tall, its values put into the preferences before entry as a player who calibrated earlier has them
// (T5a in t5-calibration.spec.ts goes through the form itself); its headset is held at the first pose of the
// motions when it enters VR, so the capture takes that height. It announces its standing eye height, and the
// new observer draws its model at that height over the model's eye height; the old observer draws the model
// at its own size. Each avatar runs in VR with both fits, "Fit the avatar to me" (the model drawn at the
// player's size) and "Fit me to the avatar" (the player's rig scaled to the model's eye height), standing;
// the Ready Player Me sample also seated (the emulated headset 0.47 m lower, at 1.15 m, the tracking offset
// lifting it to the standing eye height) with stand still, crouch, reach and walk. On desktop the subject
// also has the new solver on, without a calibration: the screen solver draws the model at its own size and
// no eye height is announced. One test per avatar, fit and posture on each media server; a last test per
// block builds the contact sheet and the summary video of each avatar (report/side-by-side.ts) from the
// tests that ran, both fits on one sheet.
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
/** Limits of the plan's F4 rows: eyes on the headset, soles on the floor, both observers the same size */
const EYE_LIMIT_CM = 2;
const SOLE_LIMIT_CM = 1;
const SIZE_AGREEMENT = 0.01;

/** The subject at the crater's centre facing -z (toward the sun); the observers 2.2 m away, 35° to its left, looking at its middle */
const FRAMING: Framing = { subject: { x: 0, z: 0, yawDeg: 0 }, distance: 2.2, bearingDeg: 35, aimHeight: 0.95 };
/** The part of an observer's 1280 x 720 window the videos and the contact sheet show: the subject with room for its reach and steps (the toolbar and side panels left out) */
export const CROP: Crop = { x: 320, y: 48, w: 640, h: 480 };
/** Hand error of the new solver counts as no worse than the old one's within this: 10% and 5 mm */
const HAND_TOLERANCE = { factor: 1.1, cm: 0.5 };
/** Below this share of the frames an observer drew the subject on, a motion's numbers are not trusted */
const MIN_FRAME_SHARE = 0.8;

const meta = (avatar: T5Avatar | "summary", variant: Variant | null, server: MediaServer) => ({
  annotation: [
    { type: "id", description: avatar === "summary" ? `t5-summary-${blockId(server)}` : `t5-${avatar}-${variantTag(variant!)}-${blockId(server)}` },
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
  /** VR: the subject's fit and posture; null and "standing" on desktop */
  fit: BodyFit | null;
  posture: BodyPosture;
  /** What the calibration check read: the subject's own view and the observers' drawn size */
  calibration: unknown;
  server: MediaServer;
  block: string;
  url: string;
  info: Record<Solver, IkInfo | null>;
  motions: MotionResult[];
  crop: Crop;
};

// ---------- The session ----------

type Session = {
  subject: Client;
  observers: Record<Solver, Client>;
  ids: { subject: string; old: string; new: string };
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
  const [subject, oldObserver, newObserver] = await startClients(evidence, [
    mode === "vr" ? { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" } : { identity: "t5-subject", slot: "a", name: "A-desk" },
    { identity: "t5-old", slot: "b", name: "B-old-solver", recordVideo: false },
    { identity: "t5-new", slot: "c", name: "C-new-solver", recordVideo: false }
  ]);
  const dy = mode === "vr" && variant.posture === "sitting" ? SEATED_HEADSET - STANDING_HEADSET : 0;
  evidence.note(
    `room ${hub.hubId} (${hub.mediaServer}); subject ${subject.name} (${subject.profile}) with ${AVATARS[avatar].describe} (${url}); ` +
      `observers B-old-solver ("Use the new avatar body solver" off) and C-new-solver (on), both DESK at the same spot with the same view; ` +
      `their pages are recorded by the DevTools screencast (time-stamped frames), not by Playwright's video`
  );
  evidence.note(
    mode === "vr"
      ? `subject: the new solver on, body calibration ${SUBJECT_HEIGHT_CM} cm, ${variant.posture}, "${FIT_TITLE[variant.fit!]}", put into its preferences before entry; its headset held at ${(STANDING_HEADSET + dy).toFixed(2)} m when it enters VR` +
          (dy ? ` (seated: every motion played ${Math.abs(dy).toFixed(2)} m lower than standing; the tracking offset lifts it to the standing eye height)` : "")
      : "subject: the new solver on and no height saved (desktop needs no calibration)"
  );
  const session = { subject, observers: { old: oldObserver, new: newObserver }, url, mode, variant, dy, entry: null } as unknown as Session;
  // The observers' solvers are set before entry and kept (a profile keeps the setting from an earlier run).
  // The new solver no longer guesses the subject's height from its first frame in VR (F4), so the new
  // observer has it on from the start.
  const [entry] = await Promise.all([
    enterSubject(session, hub.hubId),
    enterRoom(oldObserver, hub.hubId, { displayName: oldObserver.name, preferences: OLD_SOLVER }),
    enterRoom(newObserver, hub.hubId, { displayName: newObserver.name, preferences: NEW_SOLVER })
  ]);
  session.entry = entry;
  if (mode === "desktop") {
    evidence.note(
      "subject's own view: first person during the motions (in the third-person camera a mouse drag does not turn the head the client sends, TRIALS.md step 7), then ?thirdPerson's camera behind the avatar (the O key) for a walk and a turn at the end; its own avatar is solved with the new solver"
    );
  } else {
    evidence.note("subject's own view: first person in the emulated headset (IWER draws one eye into the window); its own avatar is solved with the new solver");
  }
  session.ids = { subject: await idOf(subject), old: await idOf(oldObserver), new: await idOf(newObserver) };
  return session;
}

const OLD_SOLVER = { avatarIkV2: false };
const NEW_SOLVER = { avatarIkV2: true };
const observerPreferences = (k: Solver) => (k === "old" ? OLD_SOLVER : NEW_SOLVER);

/**
 * The subject enters with its avatar and the new solver. In VR its calibration is put into the preferences
 * before Join Room and its headset is held at the motions' first pose (moved for a seated subject) when it
 * enters VR, so the capture takes that height; the page logs each session start (markXrSessions). On
 * desktop with ?thirdPerson, which lets the O key move the camera behind the avatar, and no height saved.
 */
async function enterSubject(s: Session, hubId: string): Promise<EntryTimings> {
  const vr = s.mode === "vr";
  const opts: EnterOptions = {
    displayName: s.subject.name,
    avatarUrl: s.url,
    query: vr ? undefined : "?thirdPerson",
    preferences: vr ? NEW_SOLVER : { ...NEW_SOLVER, bodyHeightCm: 0 },
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
    if (avatarReannounceEnabled()) await s.subject.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
    await s.subject.page.waitForTimeout(3000);
    const before = await Promise.all(SOLVERS.map(k => sees(s.observers[k])));
    await s.subject.page.waitForTimeout(600);
    const after = await Promise.all(SOLVERS.map(k => sees(s.observers[k])));
    const ok = SOLVERS.map((_, i) => after[i].model && after[i].pose > before[i].pose);
    tries.push(`try ${attempt}: ${SOLVERS.map((k, i) => `${k} observer model ${after[i].model ? "yes" : "no"}, poses ${after[i].pose > before[i].pose ? "arriving" : "not arriving"}`).join("; ")}`);
    if (ok.every(Boolean)) {
      evidence.note(
        avatarReannounceEnabled()
          ? `workaround applied: the subject's avatar announcement (#avatarId) sent ${attempt} time(s) after entry until both observers drew its model (known failure: the first one goes out before the channel is open); ${tries.join(" | ")}`
          : `both observers drew the subject's model and received its poses (avatar re-announce workaround off), after ${attempt} look(s): ${tries.join(" | ")}`
      );
      return true;
    }
    const silent = SOLVERS.filter((_, i) => after[i].pose === before[i].pose);
    if (attempt >= 3 && silent.length === SOLVERS.length && !subjectReentered) {
      subjectReentered = true;
      tries.push("neither observer received a pose from the subject (one-way failure on the subject's side): the subject enters the room again");
      s.entry = await enterSubject(s, hubId);
      s.ids.subject = await idOf(s.subject);
    } else if (attempt >= 3 && silent.length && !reentered) {
      reentered = true;
      for (const k of silent) {
        tries.push(`the ${k} observer received no pose from the subject (one-way failure): it enters the room again`);
        await enterRoom(s.observers[k], hubId, { displayName: s.observers[k].name, preferences: observerPreferences(k) });
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
 * The subject stands still at its place, and what the calibration did is read: in VR the headset's capture,
 * the announced eye height (both observers hold it), the subject's own view height and rig scale, and the
 * size each observer draws the model at (the new observer: the announced eye height over the model's own;
 * the old observer: the model's own size). On desktop the screen solver draws the model at its own size and
 * nothing is announced. Returns what it read, for the record.
 */
async function checkCalibration(evidence: Evidence, s: Session): Promise<unknown> {
  if (s.mode === "vr") {
    await playTimeline(s.subject.page, holdFirstPose(s.dy, 1500));
    await takeApplied(s.subject.page);
  } else {
    await s.subject.page.waitForTimeout(1500);
  }
  const own = await ownView(s.subject.page);
  const drawn = { old: await bodyState(s.observers.old.page, s.ids.subject), new: await bodyState(s.observers.new.page, s.ids.subject) };
  const captures = captureLog(s.subject);
  const read = { entry: s.entry?.calibration ?? null, own, drawn, captures };
  if (s.mode !== "vr") {
    await evidence.check("Desktop with the new solver: no calibration step, the screen solver, the model's own size, no eye height announced", "V6", async () => {
      const ok =
        s.entry?.calibration === "none" &&
        s.entry?.calibrationShown === undefined &&
        own.announced === null &&
        own.rigScale === 1 &&
        drawn.new.solver === "screen" &&
        Math.abs((drawn.new.rootScale ?? 0) - 1) < 1e-4 &&
        drawn.new.announced === null &&
        drawn.old.announced === null &&
        Math.abs((drawn.old.rootScale ?? 0) - 1) < 1e-4;
      return {
        ok,
        summary:
          `entry calibration ${s.entry?.calibration} (form ${s.entry?.calibrationShown === undefined ? "not shown" : "shown"}); the subject announces ${own.announced ?? "nothing"}, rig scale ${own.rigScale}; ` +
          `the new observer: ${drawn.new.solver ?? "no"} solver, root scale ${drawn.new.rootScale}, eye height held ${drawn.new.announced ?? "none"}; the old observer: root scale ${drawn.old.rootScale}, eye height held ${drawn.old.announced ?? "none"}`,
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
        `entry: calibration ${s.entry?.calibration}; captured headset ${captured?.toFixed(3) ?? "none"} m (held at ${wantCapture.toFixed(3)}); the player's standing eye height ${player?.toFixed(3) ?? "?"} m` +
        `${v.posture === "sitting" ? ` (from ${SUBJECT_HEIGHT_CM} cm: ${entered.toFixed(3)}; tracking offset ${captured !== null && player !== null ? (player - captured).toFixed(3) : "?"} m)` : ""}; ` +
        `announced ${own.announced ?? "nothing"} (wanted ${announcedWanted?.toFixed(3)}); rig scale ${own.rigScale} (wanted ${rigWanted.toFixed(4)}); ` +
        `the wearer's view ${own.viewHeight.toFixed(3)} m over the floor (wanted ${viewWanted?.toFixed(3)}: ${v.posture === "sitting" ? "standing eye height, " : ""}${v.fit === "playerToAvatar" ? "the model's eye height" : "the player's"}); sends the head at ${own.sentHeadY} m`,
      data: { ...read, captured, player, announcedWanted, rigWanted, viewWanted }
    };
  });
  await evidence.check("Each observer draws the model at the size it should: the new solver at the announced eye height over the model's, the old at the model's own", "V6", async () => {
    const want = drawn.new.announced && drawn.new.modelEye ? Math.min(2, Math.max(0.3, drawn.new.announced / drawn.new.modelEye)) : null;
    const ok =
      want !== null &&
      drawn.new.modelRatio !== null &&
      Math.abs(drawn.new.modelRatio - want) <= SIZE_AGREEMENT * want &&
      Math.abs((drawn.new.rootScale ?? 0) - drawn.new.modelRatio) < 1e-4 &&
      drawn.new.solver === "vr" &&
      drawn.old.announced !== null &&
      Math.abs((drawn.old.rootScale ?? 0) - 1) < 1e-4;
    return {
      ok,
      summary:
        `new observer: holds ${drawn.new.announced ?? "no"} m, model eye ${drawn.new.modelEye} m, ratio ${drawn.new.modelRatio} (wanted ${want?.toFixed(4) ?? "?"}), root scale ${drawn.new.rootScale}, ${drawn.new.solver} solver; ` +
        `old observer: holds ${drawn.old.announced ?? "no"} m, root scale ${drawn.old.rootScale} (the old solver draws the model's own size)`,
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
      : r.ik.new.handErrMean <= r.ik.old.handErrMean * HAND_TOLERANCE.factor + HAND_TOLERANCE.cm,
  /** VR (F4): the drawn eyes within 2 cm of the headset on average, the knee slack taken into account */
  eyes: r.mode !== "vr" || r.ik.new.eyeErrSlackMean === null ? null : r.ik.new.eyeErrSlackMean < EYE_LIMIT_CM,
  /** F4: no sole more than 1 cm under the floor; standing still, both within 1 cm of it */
  soles:
    r.ik.new.footMin === null
      ? null
      : r.ik.new.footMin >= -SOLE_LIMIT_CM && (r.id !== "m01" || (r.ik.new.footMax !== null && r.ik.new.footMax <= SOLE_LIMIT_CM))
});

const n = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "–" : v.toFixed(d));

async function ikTest(evidence: Evidence, server: MediaServer, avatar: T5Avatar, variant: Variant) {
  test.setTimeout(40 * 60_000);
  const mode = variant.mode;
  const hub = room(mainRoom(server));
  const s = await startSession(evidence, server, avatar, variant);
  const seen = await ensureObserversSeeSubject(evidence, s, hub.hubId);
  if (!seen) throw new Error("the observers do not both draw the subject; the solvers cannot be compared");
  await stage(evidence, s);
  const calibration = await checkCalibration(evidence, s);
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
    for (const k of SOLVERS) csvRows.push({ labels: { avatar, mode, motion: motion.id, solver: k }, frames: raw.ik[k].frames });
  }
  if (mode === "desktop") await thirdPersonOwnView(evidence, s);
  // Back at the start, so the closing screenshots show the subject
  await placeRig(s.subject.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);

  evidence.saveText("ik-metrics.csv", ikCsv(csvRows), "every observer frame of every motion: the inverse kinematics probe's numbers (probes/ik.ts)", "data");
  const summaryRows = [["avatar", "mode", "motion", "solver", ...Object.keys(results[0].ik.old)].join(",")];
  for (const r of results) for (const k of SOLVERS) summaryRows.push([avatar, mode, r.id, k, ...Object.values(r.ik[k]).map(v => (v === null ? "" : v))].join(","));
  evidence.saveText("ik-summary.csv", summaryRows.join("\n") + "\n", "per motion and solver: hand, eye and head errors, wrong-side joints, feet, jumps, twist, NaN", "data");
  const record: T5Record = { avatar, avatarTitle: AVATAR_TITLE[avatar], mode, fit: variant.fit, posture: variant.posture, calibration, server, block: blockId(server), url: s.url, info, motions: results, crop: CROP };
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
      const ratio = results.find(r => r.ik.new.modelRatio !== null)?.ik.new.modelRatio ?? null;
      return {
        ok: judged.length > 0 && judged.every(r => pass(r).hand),
        summary: `mean distance from hand bone to controller, old → new: ${rows.join(", ")} (no worse: within 10% and 5 mm); the new solver draws the model at ${ratio ?? "?"} of its size`,
        data: judged.map(r => ({ id: r.id, old: { mean: r.ik.old.handErrMean, max: r.ik.old.handErrMax, rotMean: r.ik.old.handRotErrMean }, new: { mean: r.ik.new.handErrMean, max: r.ik.new.handErrMax, rotMean: r.ik.new.handRotErrMean, modelRatio: r.ik.new.modelRatio } }))
      };
    });
    await evidence.check(`New solver: eyes on the headset, under ${EYE_LIMIT_CM} cm with the knee slack taken into account (raw distance beside it)`, "V6", async () => {
      const rows = results.map(r => `${r.id} ${n(r.ik.new.eyeErrSlackMean)} (raw ${n(r.ik.new.eyeErrMean)}, eyes ${n(r.ik.new.eyeDyMean)} cm against the headset; old ${n(r.ik.old.eyeErrMean)})${pass(r).eyes === false ? " NG" : ""}`);
      return {
        ok: results.every(r => pass(r).eyes !== false),
        summary: `mean distance from the eyes to the headset less the slack of 3 cm x ${results[0]?.ik.new.modelRatio ?? "?"}, per motion, cm: ${rows.join(", ")}`,
        data: results.map(r => ({ id: r.id, new: { slackMean: r.ik.new.eyeErrSlackMean, slackMax: r.ik.new.eyeErrSlackMax, rawMean: r.ik.new.eyeErrMean, rawMax: r.ik.new.eyeErrMax, dyMean: r.ik.new.eyeDyMean }, old: { rawMean: r.ik.old.eyeErrMean, rawMax: r.ik.old.eyeErrMax } }))
      };
    });
  } else {
    evidence.note("desktop: the pose has no controllers (hands untracked), so hand error is not judged; both solvers hang the arms by their own rules");
  }
  await evidence.check(`New solver: soles on the floor (none more than ${SOLE_LIMIT_CM} cm under it; standing still, both within ${SOLE_LIMIT_CM} cm)`, "V6", async () => {
    const rows = results.map(r => `${r.id} ${n(r.ik.new.footMin)} to ${n(r.ik.new.footMax)}${pass(r).soles === false ? " NG" : ""}`);
    return {
      ok: results.every(r => pass(r).soles !== false),
      summary: `lowest to highest sole over the floor per motion, cm (a foot lifts in a step): ${rows.join(", ")}; old solver's lowest: ${results.map(r => `${r.id} ${n(r.ik.old.footMin)}`).join(", ")}`,
      data: results.map(r => ({ id: r.id, new: { min: r.ik.new.footMin, max: r.ik.new.footMax, below: r.ik.new.belowFloorFrames }, old: { min: r.ik.old.footMin, max: r.ik.old.footMax } }))
    };
  });
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
        title: `${AVATAR_TITLE[avatar]} · ${variantLabel(variant)} · ${r.id.toUpperCase()} ${r.title} · ${blockTitle(server)}`,
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
      const verdictText = [verdict.nan ? "" : "NaN", verdict.sides ? "" : "wrong-side joint", verdict.hand === false ? "hand error worse" : "", verdict.eyes === false ? "eyes off the headset" : "", verdict.soles === false ? "sole off the floor" : ""].filter(Boolean);
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
        <div class="label"><div class="mode">${esc(variantLabel(record))}</div><b>${r.id.toUpperCase()}</b> ${esc(r.title)}<div class="muted">${esc(r.summary)}</div><div class="muted">shown: ${esc(r.tellWhat)}</div>
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
        evidence.addFile(`summary-${avatar}.mp4`, "video", `${AVATAR_TITLE[avatar]}: every motion of every fit, old solver | new solver`);
      } catch (e) {
        evidence.note(`summary video of ${avatar} not made: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    for (const f of mine) {
      const res: TestResult | null = fs.existsSync(path.join(f.dir, "result.json")) ? JSON.parse(fs.readFileSync(path.join(f.dir, "result.json"), "utf8")) : null;
      for (const r of f.record.motions) for (const k of SOLVERS) csv.push([avatar, variantLabel(f.record), r.id, k, ...Object.values(r.ik[k]).map(v => (v === null ? "" : v))].join(","));
      const agg = (k: Solver) => {
        const m = f.record.motions.map(r => r.ik[k]);
        const vals = (g: (s: IkSummary) => number | null) => m.map(g).filter((v): v is number => v !== null);
        const avg = (v: number[]) => (v.length ? +(v.reduce((a, x) => a + x, 0) / v.length).toFixed(2) : null);
        const top = (v: number[]) => (v.length ? +Math.max(...v).toFixed(2) : null);
        const low = (v: number[]) => (v.length ? +Math.min(...v).toFixed(2) : null);
        return {
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
      };
      verdicts.push({ avatar, mode: variantLabel(f.record), test: f.id, status: res?.status ?? "unknown", old: agg("old"), new: agg("new"), failedChecks: res?.checks.filter(c => c.status === "NG").map(c => c.name) ?? [] });
    }
  }
  evidence.saveText("t5-summary.csv", csv.join("\n") + "\n", "every avatar, mode, motion and solver of this block (the tests' ik-summary.csv together)", "data");
  evidence.saveJson("t5-verdicts.json", verdicts, "per avatar and mode: the old and the new solver over all motions, and the test's status");
  await evidence.check("Per avatar and mode: the new solver against the old (all motions)", "V6", async () => {
    const line = (v: any) =>
      `${v.avatar} ${v.mode}: ${v.status}; hand ${n(v.old.handErrMean)}→${n(v.new.handErrMean)} cm (max ${n(v.old.handErrMax)}→${n(v.new.handErrMax)}), eyes ${n(v.old.eyeErrMean)}→${n(v.new.eyeErrMean)} raw, ${n(v.new.eyeErrSlackMean)} with the slack (max ${n(v.new.eyeErrSlackMax)}), ratio ${v.new.modelRatio ?? "–"}, wrong elbows ${v.old.elbowWrong}→${v.new.elbowWrong}, knees ${v.old.kneeWrong}→${v.new.kneeWrong}, sole ${n(v.old.footMin)}→${n(v.new.footMin)} cm, jump ${n(v.old.jumpPosMax)}→${n(v.new.jumpPosMax)} cm, NaN ${v.old.nanFrames}→${v.new.nanFrames}`;
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
        test(`T5 inverse kinematics, old solver against new: ${AVATAR_TITLE[avatar]}, ${variantTitle(variant)}, on ${title}`, meta(avatar, variant, server), async ({ evidence }) => {
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

