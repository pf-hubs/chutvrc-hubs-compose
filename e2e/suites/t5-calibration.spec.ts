// The body calibration of the new solver (fix F4; plan section 3, the F4 rows), beside T5's motion battery:
//
// - T5a, the calibration flow on a headset: the form before the first VR entry (it cannot be passed
//   without a valid height), the saved values, a second entry that skips it, Preferences changing it, the
//   capture of the headset's height (within 10 s on a steady headset) and its fallback to the entered height
//   when the headset keeps moving;
// - T5b, "Fit the avatar to me" seen by two observers, one joining late, then an avatar change: both draw
//   the same size, and the player's height stays across the change;
// - T5c, "Fit me to the avatar": the wearer's eyes at the model's eye height, walking scaled with the rig,
//   an object at arm's length grabbed with the controller, observers drawing the model at its own size;
// - T4.11 with F4: an old-build headset beside the new build, drawn by a new-solver observer at the model's
//   own size, and a calibrated new-build headset in both fits as an old-solver observer draws it.
//
// The emulated headset (QUEST profile, IWER) is held where each step needs it; what the pages applied is read
// with probes/calibration.ts, and the drawn eyes and soles with the inverse kinematics probe (probes/ik.ts).
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { room, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import { enterRoom, fillCalibration, type BodyFit, type EntryTimings } from "../clients/enter";
import * as input from "../clients/input";
import { enterVr, exitVr, playTimeline, startTimeline, stopTimeline, type Keyframe, type Timeline } from "../clients/motion";
import { hideAvatarsExcept, observerPlace, placeRig, type Framing } from "../clients/stage";
import { VR_MOTIONS } from "../motions/battery";
import { MODEL_URL } from "../assets/generate";
import { avatarUrl, AVATARS, type AvatarName } from "../assets/avatars";
import { setAvatar, waitForAvatar } from "../probes/avatars";
import { bodyState, captureLog, lastSessionStart, markXrSessions, ownView, EYE_HEIGHT_SHARE, type BodyState } from "../probes/calibration";
import { KNEE_SLACK, startIk, stopIk, summariseIk, type IkSummary } from "../probes/ik";
import { blockId, runsOn } from "./blocks";
import { closingChecks, frameRateCheck, idOf, mainRoom, startClients, waitUntil } from "./common";
import { readPeers } from "../probes/session";
import { liveConnections } from "../probes/connections";
import { CONTAINER_CERTIFICATE, KNOWN_MIC_WISH_LOST } from "./console-allowlist";

const SERVERS = ["dialog", "livekit"] as const;
const ALLOW = [KNOWN_MIC_WISH_LOST, ...CONTAINER_CERTIFICATE];

const meta = (id: string, server: MediaServer, covers = "V6") => ({
  annotation: [
    { type: "id", description: `${id}-${blockId(server)}` },
    { type: "covers", description: covers }
  ]
});

const NEW_SOLVER = { avatarIkV2: true };
const OLD_SOLVER = { avatarIkV2: false };
const HEIGHT_CM = 173;
/** The capture must end within this on a steady headset, and gives up after it on a moving one */
const CAPTURE_LIMIT_MS = 10_000;
const SIZE_AGREEMENT = 0.01;
const FIT_TITLE: Record<BodyFit, string> = { avatarToPlayer: "Fit the avatar to me", playerToAvatar: "Fit me to the avatar" };

/** The battery's standing pose: head 1.62 m (the eyes of a person 1.73 m tall), controllers at the waist */
const STAND: Keyframe = { ...VR_MOTIONS[0]().timeline.keyframes[0], t: 0 };
const FRAMING: Framing = { subject: { x: 0, z: 0, yawDeg: 0 }, distance: 2.2, bearingDeg: 35, aimHeight: 0.95 };

function hold(ms: number, parts: Partial<Keyframe> = {}): Timeline {
  const k = { ...STAND, ...parts };
  return { name: "hold", keyframes: [{ ...k, t: 0 }, { ...k, t: ms }] };
}
const holdStand = (page: Client["page"], ms: number) => playTimeline(page, hold(ms));

/** The head bobbing 8 cm up and down once a second for `ms`: never a steady second */
function bobbing(ms: number): Timeline {
  const keyframes: Keyframe[] = [];
  for (let t = 0; t <= ms; t += 100) {
    const y = STAND.head!.pos[1] + 0.04 * Math.sin((2 * Math.PI * t) / 1000);
    keyframes.push({ ...STAND, head: { ...STAND.head!, pos: [STAND.head!.pos[0], y, STAND.head!.pos[2]] }, t });
  }
  return { name: "bobbing", keyframes };
}

/** The headset's capture results since a log index, and how long after the last session start they came */
function captureSince(c: Client, from: number) {
  const start = lastSessionStart(c, from);
  const results = captureLog(c, from);
  const first = results[0] ?? null;
  return { sessionStartT: start, result: first, ms: first && start !== null ? first.t - start : null, all: results };
}

/** The drawn eyes and soles of `id`'s model on an observer over `ms` (the inverse kinematics probe) */
async function drawnFor(observer: Client, id: string, ms: number): Promise<IkSummary> {
  const key = `f4-${Date.now()}`;
  await startIk(observer.page, key, id);
  await observer.page.waitForTimeout(ms);
  return summariseIk((await stopIk(observer.page, key)).frames);
}

const near = (a: number | null | undefined, b: number | null | undefined, tol: number) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const fmt = (v: number | null | undefined, d = 3) => (typeof v === "number" ? v.toFixed(d) : "–");
const stateText = (s: BodyState) => `holds ${fmt(s.announced)} m, model eye ${fmt(s.modelEye)} m, ratio ${fmt(s.modelRatio, 4)}, root scale ${fmt(s.rootScale, 4)}, ${s.solver ?? "old"} solver`;

/**
 * Waits until the observer draws `id`'s model with its eye height; when it does not within 15 s, the observer
 * enters the room again once (logged workaround for the one-way failure on Dialog, BASELINE.md #21, #34), with
 * what it held before saved
 */
async function observerHolds(evidence: Evidence, o: Client, subject: Client, id: string, hubId: string, when: string) {
  const look = () =>
    waitUntil(async () => {
      const s = await bodyState(o.page, id);
      return s.eid !== null && s.announced !== null ? s : null;
    }, 15_000);
  const first = await look();
  if (first.value) {
    evidence.note(`${when}: ${o.name} drew A's model with its eye height after ${first.ms} ms`);
    return first.value;
  }
  const peers = await readPeers(o.page);
  const pose = await o.page.evaluate(i => (window as any).APP.avatarPoses.get(i)?.seq ?? null, id);
  evidence.saveJson(`observer-missed-${when.replace(/\W+/g, "-")}.json`, { peers, pose, subjectLog: subject.log.filter(e => /^Avatar of /.test(e.text)).slice(-20), observerLog: o.log.filter(e => /^Avatar of /.test(e.text)).slice(-20) }, `${o.name} did not draw A ${when}: the peers it held, A's pose, both pages' avatar lines`);
  evidence.note(`${when}: ${o.name} held no model of A within 15 s (models for ${peers.models.length} peer(s), poses for ${peers.poses.length}, A's pose ${pose === null ? "never received" : `seq ${pose}`}); workaround applied: ${o.name} enters the room again (known one-way failure on Dialog, BASELINE.md #21, #34)`);
  await enterRoom(o, hubId, { displayName: o.name, preferences: NEW_SOLVER });
  const second = await look();
  evidence.note(`${when}, second attempt: ${o.name} ${second.value ? `drew A after ${second.ms} ms` : "still did not draw A"}`);
  return second.value;
}

// ---------- T5a ----------

async function calibrationFlow(evidence: Evidence, server: MediaServer) {
  test.setTimeout(20 * 60_000);
  const hub = room(mainRoom(server));
  const [q, o] = await startClients(evidence, [
    { identity: "t5a-quest", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "t5-new", slot: "c", name: "C-new-solver" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A-quest: a fresh headset profile with the new solver on and no height saved (preferences put before Join Room), ${AVATARS.rpm.describe}; C-new-solver: a DESK observer with the new solver`);
  await enterRoom(o, hub.hubId, { displayName: o.name, preferences: NEW_SOLVER });

  // 1. The form
  const form: Record<string, unknown> = {};
  const logFrom = q.log.length;
  const first = await enterRoom(q, hub.hubId, {
    displayName: q.name,
    avatarUrl: avatarUrl("rpm"),
    preferences: { ...NEW_SOLVER, bodyHeightCm: 0, bodyPosture: "standing", bodyFit: "avatarToPlayer" },
    calibration: { via: "form", heightCm: HEIGHT_CM, posture: "standing", fit: "avatarToPlayer" },
    onCalibrationForm: async page => {
      const save = page.getByRole("button", { name: "Save and Continue" });
      const height = page.getByLabel("Your height (cm)");
      await evidence.screenshot(q, "calibration-form");
      form.emptyDisabled = await save.isDisabled();
      form.enteredInVrBeforeSave = await page.evaluate(() => !!(window as any).AFRAME.scenes[0].renderer.xr.isPresenting);
      const tryValue = async (v: string) => {
        await height.fill(v);
        await height.blur();
        await page.waitForTimeout(150);
        return { value: v, saveDisabled: await save.isDisabled(), error: (await page.getByText(/Enter your height in centimetres/).count()) > 0 };
      };
      form.tries = [await tryValue("49"), await tryValue("251"), await tryValue("0"), await tryValue("50"), await tryValue("250")];
      // A click on Save with an invalid height saves nothing
      await height.fill("");
      await save.click({ force: true }).catch(() => {});
      form.storeAfterInvalidSave = await page.evaluate(() => (window as any).APP.store.state.preferences.bodyHeightCm);
      await fillCalibration(page, { heightCm: HEIGHT_CM });
      form.validEnabled = !(await save.isDisabled());
      await evidence.screenshot(q, "calibration-form-filled");
    },
    beforeEnter: async page => {
      await markXrSessions(page);
      await holdStand(page, 200);
    }
  });
  await evidence.check("The first VR entry shows the form, which cannot be passed without a valid height (50 to 250 cm)", "V6", async () => {
    const tries = form.tries as { value: string; saveDisabled: boolean; error: boolean }[];
    const ok =
      first.calibration === "form" &&
      form.emptyDisabled === true &&
      form.enteredInVrBeforeSave === false &&
      tries.every(t => (["49", "251", "0"].includes(t.value) ? t.saveDisabled && t.error : !t.saveDisabled && !t.error)) &&
      form.storeAfterInvalidSave === 0 &&
      form.validEnabled === true;
    return {
      ok,
      summary:
        `form shown ${(first.calibrationShown! / 1000).toFixed(1)} s after the room opened, before the microphone step; not in VR yet: ${!form.enteredInVrBeforeSave}; Save disabled while empty: ${form.emptyDisabled}; ` +
        tries.map(t => `${t.value}: Save ${t.saveDisabled ? "disabled" : "enabled"}${t.error ? ", error shown" : ""}`).join("; ") +
        `; saved height after a forced click with an empty field: ${form.storeAfterInvalidSave}; ${HEIGHT_CM} enables Save: ${form.validEnabled}`,
      data: { first, form }
    };
  });
  await evidence.check("The values are saved", "V6", async () => {
    const own = await ownView(q.page);
    const p = own.preferences;
    return { ok: p.bodyHeightCm === HEIGHT_CM && p.bodyPosture === "standing" && p.bodyFit === "avatarToPlayer" && p.avatarIkV2, summary: `preferences: height ${p.bodyHeightCm} cm, ${p.bodyPosture}, ${p.bodyFit}, new solver ${p.avatarIkV2}; in VR ${own.inVr}`, data: own };
  });
  await holdStand(q.page, 2500);
  let qid = await idOf(q);
  await evidence.check(`The capture on a steady headset ends within ${CAPTURE_LIMIT_MS / 1000} s and takes its height; the observer receives it`, "V6", async () => {
    const c = captureSince(q, logFrom);
    const own = await ownView(q.page);
    const seen = await waitUntil(async () => {
      const s = await bodyState(o.page, qid);
      return s.announced !== null ? s : null;
    }, 15_000);
    const ok = c.result?.kind === "captured" && near(c.result.height, STAND.head!.pos[1], 0.005) && c.ms !== null && c.ms <= CAPTURE_LIMIT_MS && near(own.announced, c.result.height, 0.002) && near(seen.value?.announced, c.result.height, 0.002);
    return {
      ok,
      summary: `captured ${fmt(c.result?.height)} m (held at ${STAND.head!.pos[1]}) ${c.ms} ms after the session started; announced ${fmt(own.announced)} m; the observer ${seen.value ? stateText(seen.value) : "holds no eye height"}`,
      data: { capture: c, own, observer: seen.value }
    };
  });
  await evidence.screenshot(q, "own-view-after-capture");

  // 2. The second entry
  const logFrom2 = q.log.length;
  const second = await enterRoom(q, hub.hubId, {
    displayName: q.name,
    preferences: NEW_SOLVER,
    beforeEnter: async page => {
      await markXrSessions(page);
      await holdStand(page, 200);
    }
  });
  await holdStand(q.page, 2500);
  // The page was loaded again: a new client id, which the observer has to draw before its view is read
  qid = await idOf(q);
  await observerHolds(evidence, o, q, qid, hub.hubId, "after A's second entry");
  await evidence.check("The second entry skips the form and captures again", "V6", async () => {
    const c = captureSince(q, logFrom2);
    return {
      ok: second.calibration === "saved" && second.calibrationShown === undefined && c.result?.kind === "captured" && c.ms !== null && c.ms <= CAPTURE_LIMIT_MS,
      summary: `entry: calibration ${second.calibration} (form ${second.calibrationShown === undefined ? "not shown" : "shown"}), in VR after ${((second.presenting ?? 0) / 1000).toFixed(1)} s; capture ${c.result?.kind ?? "none"} ${fmt(c.result?.height)} m after ${c.ms} ms`,
      data: { second, capture: c }
    };
  });

  // 3. Preferences
  const inVrMenu = { moreButtons: await q.page.getByRole("button", { name: "More", exact: true }).count(), moreVisible: await q.page.getByRole("button", { name: "More", exact: true }).isVisible().catch(() => false), bodyClass: await q.page.evaluate(() => document.body.className) };
  await exitVr(q.page);
  await q.page.waitForTimeout(1000);
  const prefs: Record<string, unknown> = { inVrMenu };
  await input.choosePopoverItem(q.page, "More", "Preferences");
  await input.clickFound(q.page, `return document.querySelector('button[aria-label="Select category Misc"]')`, undefined, "the Misc category");
  await q.page.waitForTimeout(500);
  const heightField = q.page.locator('input[name="bodyHeightCm"]');
  await heightField.scrollIntoViewIfNeeded();
  await evidence.screenshot(q, "preferences-body-calibration");
  prefs.shownHeight = await heightField.inputValue();
  prefs.captureButton = await q.page.evaluate(() => {
    const label = [...document.querySelectorAll('[class*="preference-label"]')].find(e => e.textContent?.startsWith("Capture the headset's height again"));
    const button = label?.parentElement?.querySelector("button") as HTMLButtonElement | null;
    return label ? { text: label.textContent, disabled: button?.disabled ?? null } : null;
  });
  await heightField.fill("180");
  await q.page.waitForTimeout(300);
  // The Fit select (PREFERENCE_LIST_ITEM_TYPE.SELECT): the row labelled "Fit"
  prefs.fitSelect = await q.page.evaluate(() => {
    const label = [...document.querySelectorAll('[class*="preference-label"]')].find(e => e.textContent?.trim() === "Fit");
    const select = label?.parentElement?.querySelector("select") as HTMLSelectElement | null;
    return select ? [...select.options].map(o => `${o.value}:${o.text}`) : null;
  });
  const fitSelect = q.page.locator("select").filter({ has: q.page.locator('option[value="playerToAvatar"]') });
  if (await fitSelect.count()) await fitSelect.first().selectOption("playerToAvatar");
  else prefs.fitNote = "no select with a playerToAvatar option; the Fit row is drawn another way";
  await q.page.waitForTimeout(300);
  prefs.after = (await ownView(q.page)).preferences;
  await evidence.screenshot(q, "preferences-changed");
  await input.clickFound(q.page, `return document.querySelector('button[aria-label="Close Preferences Menu"]')`, undefined, "the preferences close button");
  const logFrom3 = q.log.length;
  await holdStand(q.page, 200);
  await enterVr(q.page);
  await holdStand(q.page, 2500);
  const afterPrefs = await ownView(q.page);
  const observerAfterPrefs = await bodyState(o.page, qid);
  await evidence.check("Preferences change the calibration: height and fit saved, applied on the next VR entry", "V6", async () => {
    const p = prefs.after as { bodyHeightCm: number; bodyFit: string };
    const c = captureSince(q, logFrom3);
    const rigWanted = afterPrefs.ownModelEye && c.result?.height ? afterPrefs.ownModelEye / c.result.height : null;
    const ok =
      prefs.shownHeight === String(HEIGHT_CM) &&
      p.bodyHeightCm === 180 &&
      p.bodyFit === "playerToAvatar" &&
      near(afterPrefs.announced, afterPrefs.ownModelEye, 0.002) &&
      near(afterPrefs.rigScale, rigWanted, 0.002) &&
      near(observerAfterPrefs.announced, afterPrefs.ownModelEye, 0.002);
    return {
      ok,
      summary:
        `Preferences > Misc > Body calibration showed ${prefs.shownHeight} cm; set to 180 cm and "Fit me to the avatar": saved ${p.bodyHeightCm} cm, ${p.bodyFit}; ` +
        `back in VR: capture ${fmt(c.result?.height)} m, rig scale ${afterPrefs.rigScale} (model eye ${afterPrefs.ownModelEye} over ${fmt(c.result?.height)} = ${fmt(rigWanted, 4)}), announced ${afterPrefs.announced} (the model's eye height); the observer ${stateText(observerAfterPrefs)}`,
      data: { prefs, afterPrefs, observerAfterPrefs, capture: c }
    };
  });
  await evidence.check('"Capture the headset\'s height again" in Preferences', "V6", async () => {
    const button = prefs.captureButton as { text: string; disabled: boolean | null } | null;
    return {
      ok: "not applicable",
      summary:
        `out of VR the item reads "${button?.text ?? "not found"}" with its button ${button?.disabled ? "disabled" : "enabled"}; in VR the page hides its 2D interface (body class "${inVrMenu.bodyClass}", the More button ${inVrMenu.moreVisible ? "visible" : "not visible"}), ` +
        "so Preferences, and with it the button, cannot be reached while the capture is possible; on this emulation the capture again is only reached by entering VR again",
      data: { button, inVrMenu }
    };
  });

  // 4. The fallback: a headset that keeps moving
  await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyFit: "avatarToPlayer" } }));
  await exitVr(q.page);
  await q.page.waitForTimeout(800);
  const logFrom4 = q.log.length;
  await startTimeline(q.page, bobbing(16_000));
  await enterVr(q.page);
  await q.page.waitForTimeout(2000);
  await evidence.screenshot(q, "capture-prompt-while-moving");
  const ended = await waitUntil(async () => (captureLog(q, logFrom4).length ? true : null), 15_000);
  await stopTimeline(q.page);
  await holdStand(q.page, 1500);
  const fallback = await ownView(q.page);
  const observerFallback = await bodyState(o.page, qid);
  await evidence.check("A headset that keeps moving: the capture gives up after 10 s and the entered height is used", "V6", async () => {
    const c = captureSince(q, logFrom4);
    const entered = 1.8 * EYE_HEIGHT_SHARE;
    const ok = !!ended.value && c.result?.kind === "timedOut" && c.ms !== null && c.ms >= CAPTURE_LIMIT_MS - 300 && c.ms <= CAPTURE_LIMIT_MS + 1500 && near(fallback.announced, entered, 0.002) && near(observerFallback.announced, entered, 0.002);
    return {
      ok,
      summary: `the head bobbing ±4 cm once a second: ${c.result?.kind ?? "no answer"} after ${c.ms} ms; announced ${fallback.announced} m (180 cm x ${EYE_HEIGHT_SHARE} = ${entered.toFixed(3)}); the observer ${stateText(observerFallback)}`,
      data: { capture: c, fallback, observerFallback }
    };
  });
  // The profile keeps the calibration; the next run starts without one (preferences before Join Room)
  await closingChecks(evidence, [q, o], ALLOW);
}

// ---------- T5b ----------

async function twoObservers(evidence: Evidence, server: MediaServer) {
  test.setTimeout(20 * 60_000);
  const hub = room(mainRoom(server));
  const [q, b, c] = await startClients(evidence, [
    { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "t5-new", slot: "b", name: "B-new-solver" },
    { identity: "t5-old", slot: "c", name: "C-late-new-solver" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A-quest: new solver, ${HEIGHT_CM} cm, standing, "Fit the avatar to me", ${AVATARS.rpm.describe}; B and C both with the new solver; C enters after A has captured its height`);
  await enterRoom(b, hub.hubId, { displayName: b.name, preferences: NEW_SOLVER });
  await enterRoom(q, hub.hubId, {
    displayName: q.name,
    avatarUrl: avatarUrl("rpm"),
    preferences: NEW_SOLVER,
    calibration: { via: "seed", heightCm: HEIGHT_CM, posture: "standing", fit: "avatarToPlayer" },
    beforeEnter: page => holdStand(page, 200)
  });
  await holdStand(q.page, 3000);
  const qid = await idOf(q);
  const t0 = Date.now();
  await enterRoom(c, hub.hubId, { displayName: c.name, preferences: NEW_SOLVER });
  const lateModel = await waitUntil(async () => {
    const s = await bodyState(c.page, qid);
    return s.eid !== null && s.announced !== null && s.modelRatio !== null ? s : null;
  }, 20_000);
  evidence.note(`C entered ${((Date.now() - t0) / 1000).toFixed(1)} s after A had captured (the entry itself included); C drew A's model with its eye height ${lateModel.value ? `${lateModel.ms} ms after its entry` : "not within 20 s"}`);
  let late = lateModel.value;
  if (!late) {
    // Diagnose, then the logged workaround for the one-way failure of a joint or late join on Dialog (BASELINE.md #21, #34)
    const peers = await readPeers(c.page);
    const poseOfA = await c.page.evaluate(id => (window as any).APP.avatarPoses.get(id)?.seq ?? null, qid);
    const bSees = await bodyState(b.page, qid);
    evidence.saveJson("late-joiner-first-attempt.json", { peers, poseOfA, bSees, connections: await liveConnections(c.page).catch(e => String(e)) }, "the late joiner's first attempt: the peers it holds models and poses for, A's pose sequence, B's view of A");
    evidence.note(
      `first attempt: C held models for ${peers.models.length} peer(s), poses for ${peers.poses.length}, A's pose ${poseOfA === null ? "never received" : `received (seq ${poseOfA})`}, ` +
        `B meanwhile ${stateText(bSees)}; workaround applied: C enters the room again (known one-way failure on Dialog, BASELINE.md #21, #34)`
    );
    await enterRoom(c, hub.hubId, { displayName: c.name, preferences: NEW_SOLVER });
    late = (
      await waitUntil(async () => {
        const s = await bodyState(c.page, qid);
        return s.eid !== null && s.announced !== null && s.modelRatio !== null ? s : null;
      }, 20_000)
    ).value;
    evidence.note(`second attempt: C ${late ? "drew A's model with its eye height" : "still did not draw A's model"}`);
  }
  for (const k of [b, c]) {
    const place = observerPlace(FRAMING);
    await placeRig(k.page, place.x + (k === c ? 0.4 : 0), place.z, place.yawDeg, place.pitchDeg);
    await hideAvatarsExcept(k, [qid]);
  }
  await placeRig(q.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  await frameRateCheck(evidence, [q, b, c]);

  const compare = async (label: string, url: string) => {
    await holdStand(q.page, 1500);
    const states = { b: await bodyState(b.page, qid), c: await bodyState(c.page, qid) };
    const drawn = { b: await drawnFor(b, qid, 1500), c: await drawnFor(c, qid, 1500) };
    const own = await ownView(q.page);
    await evidence.screenshot(b, `${label}-B`);
    await evidence.screenshot(c, `${label}-C`);
    return { label, url, states, drawn, own };
  };
  const before = await compare("rpm", avatarUrl("rpm"));
  await evidence.check("Both observers draw the same size within 1%, the late joiner too", "V6", async () => {
    const { b: sb, c: sc } = before.states;
    const eyeB = before.drawn.b.eyeHeightMean, eyeC = before.drawn.c.eyeHeightMean;
    const ok =
      !!late &&
      sb.modelRatio !== null && sc.modelRatio !== null &&
      Math.abs(sb.modelRatio - sc.modelRatio) <= SIZE_AGREEMENT * sb.modelRatio &&
      eyeB !== null && eyeC !== null && Math.abs(eyeB - eyeC) <= SIZE_AGREEMENT * eyeB &&
      near(sb.announced, before.own.announced, 0.002);
    return {
      ok,
      summary:
        `A announces ${fmt(before.own.announced)} m; B ${stateText(sb)}; C (late) ${stateText(sc)}; ratios differ by ${sb.modelRatio && sc.modelRatio ? ((Math.abs(sb.modelRatio - sc.modelRatio) / sb.modelRatio) * 100).toFixed(3) : "?"}%; ` +
        `drawn eyes over the floor: B ${fmt(eyeB)} m, C ${fmt(eyeC)} m (the announced height less the knee slack ${fmt(KNEE_SLACK * (sb.modelRatio ?? 1))} m: ${fmt((before.own.announced ?? 0) - KNEE_SLACK * (sb.modelRatio ?? 1))}); eyes to headset with the slack: B ${fmt(before.drawn.b.eyeErrSlackMean, 2)} cm, C ${fmt(before.drawn.c.eyeErrSlackMean, 2)} cm (raw ${fmt(before.drawn.b.eyeErrMean, 2)}, ${fmt(before.drawn.c.eyeErrMean, 2)})`,
      data: { lateModel, late, before }
    };
  });

  // The avatar change
  const next = avatarUrl("vrm0");
  await setAvatar(q, next);
  const loads = { b: await waitForAvatar(b.page, qid, next), c: await waitForAvatar(c.page, qid, next) };
  await q.page.waitForTimeout(1500);
  await hideAvatarsExcept(b, [qid]);
  await hideAvatarsExcept(c, [qid]);
  const after = await compare("vrm0", next);
  await evidence.check("After an avatar change the player's height is kept: the same eye height announced, the new model drawn at it by both", "V6", async () => {
    const { b: sb, c: sc } = after.states;
    const want = sb.announced && sb.modelEye ? sb.announced / sb.modelEye : null;
    const eyeB = after.drawn.b.eyeHeightMean, eyeC = after.drawn.c.eyeHeightMean;
    const ok =
      loads.b.loaded && loads.c.loaded &&
      near(after.own.announced, before.own.announced, 0.001) &&
      near(sb.announced, before.states.b.announced, 0.001) &&
      want !== null && near(sb.modelRatio, want, SIZE_AGREEMENT * want) && near(sc.modelRatio, sb.modelRatio, SIZE_AGREEMENT * (sb.modelRatio ?? 1)) &&
      near(eyeB, before.drawn.b.eyeHeightMean, 0.01) && near(eyeC, eyeB, 0.01 * (eyeB ?? 1));
    return {
      ok,
      summary:
        `A changed to ${next.split("/").pop()} (B loaded it in ${loads.b.ms} ms, C in ${loads.c.ms} ms); A announces ${fmt(after.own.announced)} m (before ${fmt(before.own.announced)}); B ${stateText(sb)}; C ${stateText(sc)}; ` +
        `drawn eyes over the floor: B ${fmt(eyeB)} m, C ${fmt(eyeC)} m (before the change ${fmt(before.drawn.b.eyeHeightMean)} m)`,
      data: { loads, after }
    };
  });
  await closingChecks(evidence, [q, b, c], ALLOW);
}

// ---------- T5c ----------

async function playerToAvatar(evidence: Evidence, server: MediaServer, avatar: AvatarName) {
  test.setTimeout(20 * 60_000);
  const hub = room(mainRoom(server));
  // Both signed in as the room's owner: placing and moving objects needs the permission members lack here
  const [q, o] = await startClients(evidence, [
    { identity: "quest-admin", account: "admin", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "admin", account: "admin", slot: "c", name: "C-new-solver" }
  ]);
  const url = avatarUrl(avatar);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A-quest: new solver, ${HEIGHT_CM} cm, standing, "Fit me to the avatar", ${AVATARS[avatar].describe}; both clients signed in as the room's owner (to place and grab an object); C-new-solver a DESK observer`);
  await enterRoom(o, hub.hubId, { displayName: o.name, preferences: NEW_SOLVER });
  await enterRoom(q, hub.hubId, {
    displayName: q.name,
    avatarUrl: url,
    preferences: NEW_SOLVER,
    calibration: { via: "seed", heightCm: HEIGHT_CM, posture: "standing", fit: "playerToAvatar" },
    beforeEnter: page => holdStand(page, 200)
  });
  await holdStand(q.page, 3000);
  const qid = await idOf(q);
  await frameRateCheck(evidence, [q, o]);
  const own = await ownView(q.page);
  const seen = await waitUntil(async () => {
    const s = await bodyState(o.page, qid);
    return s.modelRatio !== null && s.announced !== null ? s : null;
  }, 15_000);
  await evidence.check("The wearer's eyes stand at the model's eye height within 1 cm; the rig is scaled by the model's eye height over the player's", "V6", async () => {
    const captured = captureLog(q).filter(c => c.kind === "captured").pop()?.height ?? null;
    const rigWanted = own.ownModelEye && captured ? own.ownModelEye / captured : null;
    return {
      ok: near(own.viewHeight, own.ownModelEye, 0.01) && near(own.rigScale, rigWanted, 0.002) && near(own.announced, own.ownModelEye, 0.002),
      summary: `the view ${fmt(own.viewHeight)} m over the floor, the model's eyes ${fmt(own.ownModelEye)} m (difference ${own.ownModelEye !== null ? ((own.viewHeight - own.ownModelEye) * 100).toFixed(2) : "?"} cm); rig scale ${own.rigScale} (${fmt(own.ownModelEye)} / captured ${fmt(captured)} = ${fmt(rigWanted, 4)}); announced ${own.announced}; the headset itself at ${own.deviceHeadY} m`,
      data: { own, captured }
    };
  });
  await evidence.check("Observers draw the model at its own size", "V6", async () => {
    const s = seen.value;
    return {
      ok: !!s && near(s.modelRatio, 1, SIZE_AGREEMENT) && near(s.rootScale, s.modelRatio, 1e-4),
      summary: s ? `the observer ${stateText(s)} (the announced height is rounded to the millimetre)` : "the observer held no eye height within 15 s",
      data: s
    };
  });
  {
    const place = observerPlace(FRAMING);
    await placeRig(o.page, place.x, place.z, place.yawDeg, place.pitchDeg);
    await hideAvatarsExcept(o, [qid]);
    await placeRig(q.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
    await holdStand(q.page, 1000);
    const drawn = await drawnFor(o, qid, 1500);
    await evidence.screenshot(o, "observer-sees-subject");
    await evidence.screenshot(q, "own-view");
    evidence.note(`the observer's drawn model standing: eyes ${fmt(drawn.eyeHeightMean)} m over the floor, ${fmt(drawn.eyeErrSlackMean, 2)} cm from the headset with the knee slack (raw ${fmt(drawn.eyeErrMean, 2)}), soles ${fmt(drawn.footMin, 1)} to ${fmt(drawn.footMax, 1)} cm, hands ${fmt(drawn.handErrMean, 2)} cm from the controllers`);
  }

  // Walking 3 s with the thumbstick at both fits
  const rigXZ = () => q.page.evaluate(() => { const r = (document.querySelector("#avatar-rig") as any).object3D; return [r.position.x, r.position.z] as [number, number]; });
  const walks: { fit: BodyFit; rigScale: number; metres: number }[] = [];
  for (const fit of ["playerToAvatar", "avatarToPlayer"] as const) {
    await q.page.evaluate(f => (window as any).APP.store.update({ preferences: { bodyFit: f } }), fit);
    await holdStand(q.page, 1500);
    await placeRig(q.page, 0, 0, 0);
    await q.page.waitForTimeout(300);
    const a = await rigXZ();
    const rigScale = (await ownView(q.page)).rigScale;
    const push = { ...STAND.left!, stick: [0, -1] as [number, number] };
    await playTimeline(q.page, { name: "walk 3 s", keyframes: [{ ...STAND, left: push, t: 0 }, { ...STAND, left: push, t: 3000 }, { ...STAND, t: 3001 }] });
    await q.page.waitForTimeout(800);
    const b = await rigXZ();
    walks.push({ fit, rigScale, metres: +Math.hypot(b[0] - a[0], b[1] - a[1]).toFixed(3) });
  }
  await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyFit: "playerToAvatar" } }));
  await holdStand(q.page, 1500);
  await placeRig(q.page, 0, 0, 0);
  await evidence.check("The distance walked in 3 s scales with the rig", "V6", async () => {
    const [scaled, plain] = walks;
    const ratio = scaled.metres / plain.metres;
    return {
      ok: near(ratio, scaled.rigScale, 0.02 * scaled.rigScale),
      summary: `thumbstick forward for 3 s: "Fit me to the avatar" (rig scale ${scaled.rigScale}) ${scaled.metres} m, "Fit the avatar to me" (scale ${plain.rigScale}) ${plain.metres} m; ratio ${ratio.toFixed(4)} against the rig scale ${scaled.rigScale}`,
      data: walks
    };
  });

  // An object at arm's length, grabbed with the grip
  await evidence.check("An object at arm's length is grabbed with the controller and follows it, on both pages", "V6", async () => {
    await placeRig(o.page, 0, 2.5, 180);
    await input.placeFromUrl(o.page, MODEL_URL);
    const placed = await waitUntil(() => objectAt(q, MODEL_URL), 30_000);
    if (!placed.value) return { ok: false, summary: "the object did not appear on the headset's page within 30 s" };
    // The battery's full reach forward at shoulder height, in the device's own frame (real metres)
    const reachDevice: [number, number, number] = [0.19, 1.43, -0.6];
    const reach = { ...STAND.right!, pos: reachDevice };
    await playTimeline(q.page, hold(1000, { right: reach }));
    const controller = await q.page.evaluate(() => {
      const T = (window as any).AFRAME.THREE;
      const w = new T.Vector3();
      (document.querySelector("#player-right-controller") as any).object3D.getWorldPosition(w);
      const r = (document.querySelector("#avatar-rig") as any).object3D;
      return { world: [w.x, w.y, w.z], rig: [r.position.x, r.position.y, r.position.z], scale: r.scale.y };
    });
    // The owner (the observer placed it) moves it to where the controller is
    await o.page.evaluate(({ finder, src, p }) => {
      const el = new Function("arg", finder)({ src });
      el.object3D.position.set(p[0], p[1], p[2]);
      el.object3D.matrixNeedsUpdate = true;
    }, { finder: input.FIND_MEDIA_CODE, src: MODEL_URL, p: controller.world });
    await q.page.waitForTimeout(2000);
    const before = { subject: await objectAt(q, MODEL_URL), observer: await objectAt(o, MODEL_URL) };
    const hovered = await q.page.evaluate(() => !!(window as any).AFRAME.scenes[0].systems.interaction.state.rightHand.hovered);
    const lift = 0.3;
    const up = { ...reach, pos: [reachDevice[0], reachDevice[1] + lift, reachDevice[2]] as [number, number, number] };
    await playTimeline(q.page, {
      name: "grab and lift",
      keyframes: [
        { ...STAND, right: { ...reach, buttons: { squeeze: 0 } }, t: 0 },
        { ...STAND, right: { ...reach, buttons: { squeeze: 1 } }, t: 300 },
        { ...STAND, right: { ...reach, buttons: { squeeze: 1 } }, t: 800 },
        { ...STAND, right: { ...up, buttons: { squeeze: 1 } }, t: 1800 },
        { ...STAND, right: { ...up, buttons: { squeeze: 1 } }, t: 2200 }
      ]
    });
    const held = await q.page.evaluate(() => !!(window as any).AFRAME.scenes[0].systems.interaction.state.rightHand.held);
    await evidence.screenshot(q, "grabbed");
    await playTimeline(q.page, hold(500, { right: { ...up, buttons: { squeeze: 0 } } }));
    await q.page.waitForTimeout(1500);
    const after = { subject: await objectAt(q, MODEL_URL), observer: await objectAt(o, MODEL_URL) };
    await evidence.screenshot(o, "observer-sees-grabbed");
    const rose = (x: typeof before.subject, y: typeof after.subject) => (x && y ? +(y[1] - x[1]).toFixed(3) : null);
    const want = lift * controller.scale;
    const ok = hovered && held && near(rose(before.subject, after.subject), want, 0.03) && near(rose(before.observer, after.observer), want, 0.03);
    return {
      ok,
      summary:
        `the controller at full reach (the device ${reachDevice.join(", ")} real metres) is at (${controller.world.map(v => v.toFixed(3)).join(", ")}) in the room with the rig scaled ${controller.scale.toFixed(4)}; the object put there: hand hovering ${hovered}, held with the grip ${held}; ` +
        `lifted ${lift} m (real), the object rose ${rose(before.subject, after.subject)} m on the headset and ${rose(before.observer, after.observer)} m on the observer (wanted ${want.toFixed(3)})`,
      data: { controller, before, after, hovered, held }
    };
  });
  await closingChecks(evidence, [q, o], ALLOW);
}

function objectAt(c: Client, src: string): Promise<[number, number, number] | null> {
  return c.page.evaluate(({ finder, src }) => {
    const el = new Function("arg", finder)({ src });
    if (!el) return null;
    const T = (window as any).AFRAME.THREE;
    el.object3D.updateMatrixWorld(true);
    const w = new T.Vector3().setFromMatrixPosition(el.object3D.matrixWorld);
    return [+w.x.toFixed(3), +w.y.toFixed(3), +w.z.toFixed(3)] as [number, number, number];
  }, { finder: input.FIND_MEDIA_CODE, src });
}

// ---------- T4.11 with F4 ----------

async function oldBuildWithCalibration(evidence: Evidence, server: MediaServer) {
  test.setTimeout(20 * 60_000);
  const hub = room(mainRoom(server));
  const [old, q, d] = await startClients(evidence, [
    { identity: "old-quest", slot: "c", name: "C-old-quest", profile: "OLD_QUEST" },
    { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "t5-new", slot: "b", name: "B-observer" }
  ]);
  evidence.note(
    `room ${hub.hubId} (${hub.mediaServer}); C-old-quest: the previous build (hubs feature/sfu-refactor) in the emulated headset, ${AVATARS.rpm.describe}; A-quest: the new build, new solver, ${HEIGHT_CM} cm standing, ${AVATARS.vrm0.describe}; ` +
      "B-observer: DESK, the new solver first (drawing the old build's headset), then the old solver (drawing A in both fits)"
  );
  await enterRoom(d, hub.hubId, { displayName: d.name, preferences: NEW_SOLVER });
  await enterRoom(old, hub.hubId, { displayName: old.name, avatarUrl: avatarUrl("rpm") });
  await enterRoom(q, hub.hubId, {
    displayName: q.name,
    avatarUrl: avatarUrl("vrm0"),
    preferences: NEW_SOLVER,
    calibration: { via: "seed", heightCm: HEIGHT_CM, posture: "standing", fit: "avatarToPlayer" },
    beforeEnter: page => holdStand(page, 200)
  });
  await Promise.all([holdStand(q.page, 3000), holdStand(old.page, 3000)]);
  await frameRateCheck(evidence, [old, q, d]);
  const [idOld, idq] = [await idOf(old), await idOf(q)];

  // The old build's headset, as the new solver draws it
  const place = observerPlace(FRAMING);
  await placeRig(old.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg).catch(() => {});
  await placeRig(q.page, FRAMING.subject.x + 3, FRAMING.subject.z, FRAMING.subject.yawDeg);
  await placeRig(d.page, place.x, place.z, place.yawDeg, place.pitchDeg);
  await hideAvatarsExcept(d, [idOld]);
  await holdStand(old.page, 1000);
  const oldState = await bodyState(d.page, idOld);
  const oldDrawn = await drawnFor(d, idOld, 2000);
  await evidence.screenshot(d, "new-solver-draws-old-build");
  await evidence.check("An old-build headset is drawn by the new solver at the model's own size, without errors", "V9 V6", async () => {
    const errors = d.log.filter(e => (e.type === "error" || e.type === "pageerror") && /avatar|ik|solve|ratio/i.test(e.text)).map(e => e.text.slice(0, 200));
    return {
      ok: oldState.announced === null && near(oldState.modelRatio, 1, 1e-6) && near(oldState.rootScale, 1, 1e-6) && oldState.solver === "vr" && oldDrawn.nanFrames === 0 && errors.length === 0,
      summary:
        `B ${stateText(oldState)}; drawn: eyes ${fmt(oldDrawn.eyeErrMean, 2)} cm from the headset raw (${fmt(oldDrawn.eyeErrSlackMean, 2)} with the slack), eyes ${fmt(oldDrawn.eyeHeightMean)} m over the floor, soles ${fmt(oldDrawn.footMin, 1)} to ${fmt(oldDrawn.footMax, 1)} cm, hands ${fmt(oldDrawn.handErrMean, 2)} cm, NaN frames ${oldDrawn.nanFrames}; ` +
        `errors about avatars in B's log: ${errors.length}`,
      data: { oldState, oldDrawn, errors }
    };
  });

  // The old build watching the new one walk
  const before = await old.page.evaluate(id => { const p = (window as any).APP?.avatarPoses?.get?.(id); return p ? { seq: p.seq, x: p.rig.pos.x, z: p.rig.pos.z } : null; }, idq).catch(() => null);
  const nafBefore = await old.page.evaluate(id => { const el = document.querySelector(`[networked-avatar]`); return !!el; }, idq).catch(() => null);
  const push = { ...STAND.left!, stick: [0, -1] as [number, number] };
  await playTimeline(q.page, { name: "walk", keyframes: [{ ...STAND, left: push, t: 0 }, { ...STAND, left: push, t: 1500 }, { ...STAND, t: 1501 }] });
  await q.page.waitForTimeout(800);
  const after = await old.page.evaluate(id => { const p = (window as any).APP?.avatarPoses?.get?.(id); return p ? { seq: p.seq, x: p.rig.pos.x, z: p.rig.pos.z } : null; }, idq).catch(() => null);
  await evidence.screenshot(old, "old-build-view");
  await evidence.check("The old build sees the new client move (recorded)", "V9", async () => {
    const moved = before && after ? Math.hypot(after.x - before.x, after.z - before.z) : null;
    return {
      ok: true,
      summary: `recorded only: the old build ${after ? `holds A's pose (moved ${moved?.toFixed(2)} m, ${after.seq - (before?.seq ?? 0)} packets) while A walked 1.5 s` : "holds no pose of A"} (the same as T4.11 before F4, FIXES.md); networked avatar elements on its page: ${nafBefore}`,
      data: { before, after }
    };
  });

  // The old solver's picture of a calibrated headset, both fits
  await placeRig(old.page, FRAMING.subject.x + 3, FRAMING.subject.z, FRAMING.subject.yawDeg).catch(() => {});
  await placeRig(q.page, FRAMING.subject.x, FRAMING.subject.z, FRAMING.subject.yawDeg);
  await d.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: false } }));
  // A's model was moved out of B's view for the first part: back to its place, the old build's out
  await d.page.evaluate(id => {
    const APP = (window as any).APP;
    const model = APP.world.eid2obj.get(APP.sfu.avatarSync.models.avatarEidByClientId.get(id));
    if (model) {
      model.position.y = 0;
      model.matrixNeedsUpdate = true;
      model.updateMatrix();
    }
  }, idq);
  await hideAvatarsExcept(d, [idq]);
  const fits: Record<string, unknown> = {};
  for (const fit of ["avatarToPlayer", "playerToAvatar"] as const) {
    await q.page.evaluate(f => (window as any).APP.store.update({ preferences: { bodyFit: f } }), fit);
    await holdStand(q.page, 2000);
    const st = await bodyState(d.page, idq);
    const standing = await drawnFor(d, idq, 1500);
    await evidence.screenshot(d, `old-solver-${fit}-standing`);
    await startTimeline(q.page, hold(2500, { right: { ...STAND.right!, pos: [0.19, 1.43, -0.6] }, left: { ...STAND.left!, pos: [-0.19, 1.6, -0.45] } }));
    await q.page.waitForTimeout(800);
    const reaching = await drawnFor(d, idq, 1200);
    await evidence.screenshot(d, `old-solver-${fit}-reaching`);
    fits[fit] = { state: st, own: await ownView(q.page), standing, reaching };
  }
  await evidence.check('The old solver\'s picture of a calibrated headset, "Fit the avatar to me" and "Fit me to the avatar" (recorded)', "V6", async () => {
    const line = (fit: BodyFit) => {
      const f = fits[fit] as { state: BodyState; own: { rigScale: number; announced: number | null }; standing: IkSummary; reaching: IkSummary };
      return `${FIT_TITLE[fit]} (A's rig scale ${f.own.rigScale}, announces ${fmt(f.own.announced)}): root scale ${fmt(f.state.rootScale)}; standing: hands ${fmt(f.standing.handErrMean, 1)} cm from the controllers, eyes ${fmt(f.standing.eyeErrMean, 1)} cm from the headset, soles ${fmt(f.standing.footMin, 1)} cm; reaching: hands ${fmt(f.reaching.handErrMean, 1)} cm`;
    };
    return { ok: true, summary: `recorded only (the old solver draws the model at its own size): ${line("avatarToPlayer")}; ${line("playerToAvatar")}`, data: fits };
  });
  await d.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: true } }));
  await closingChecks(evidence, [old, q, d], ALLOW);
}

// ---------- Tests ----------

for (const server of SERVERS) {
  test.describe(`T5 body calibration on ${server === "dialog" ? "Dialog" : "LiveKit"}`, () => {
    test(`T5a the body calibration flow in the headset, on ${server}`, meta("t5a", server), async ({ evidence }) => {
      runsOn(server);
      await calibrationFlow(evidence, server);
    });
    test(`T5b "Fit the avatar to me" seen by two observers, one late, and an avatar change, on ${server}`, meta("t5b", server), async ({ evidence }) => {
      runsOn(server);
      await twoObservers(evidence, server);
    });
    for (const avatar of ["rpm", "vrm0"] as const) {
      test(`T5c "Fit me to the avatar" with the ${AVATARS[avatar].file} model, on ${server}`, meta(`t5c-${avatar}`, server), async ({ evidence }) => {
        runsOn(server);
        await playerToAvatar(evidence, server, avatar);
      });
    }
    test(`T4.11 with the body calibration: an old-build headset beside the new build, on ${server}`, meta("t4.11-f4", server, "V9 V6"), async ({ evidence }) => {
      runsOn(server);
      await oldBuildWithCalibration(evidence, server);
    });
  });
}
