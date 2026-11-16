// Entering a room through the real entry UI (plan 2.3, selectors from TRIALS.md "Entering a room").
import type { Page } from "@playwright/test";
import type { Client } from "./launch";
import { IS_CONNECTED } from "../probes/compat";

export type EntryTimings = {
  load: number;
  joinVisible: number;
  profile: number;
  mic: number;
  entered: number;
  mediaServer: number;
  /** QUEST: when the immersive session presented (the client requests it itself on Enter Room) */
  presenting?: number;
  /**
   * The body calibration of the new solver (asked before the first VR entry): "form" when the client showed
   * its form and it was filled, "seeded" when the values were put into the preferences before Join Room,
   * "saved" when the profile had them already, "none" when the entry did not need them (old solver, or not in VR)
   */
  calibration?: "form" | "seeded" | "saved" | "none";
  /** When the calibration form showed, from the start (only with "form") */
  calibrationShown?: number;
};

export type BodyPosture = "standing" | "sitting";
export type BodyFit = "avatarToPlayer" | "playerToAvatar";
export type Calibration = { heightCm: number; posture: BodyPosture; fit: BodyFit };

/** The calibration a headset client is given when a test names none: a person 1.73 m tall (the motion battery's), standing, the avatar fitted to them */
export const DEFAULT_CALIBRATION: Calibration = { heightCm: 173, posture: "standing", fit: "avatarToPlayer" };

export type EnterOptions = {
  displayName: string;
  /** A full avatar URL put into the profile's avatarId before entering, as a user does with a custom avatar URL */
  avatarUrl?: string;
  /**
   * Preferences put into the store before Join Room, as a user sets them in Preferences beforehand (a signed-in
   * profile keeps them between runs, so a test that depends on one sets it here)
   */
  preferences?: Record<string, unknown>;
  /**
   * Whether to enter with the microphone muted: switches the "Mute" toggle of the microphone setup step as a user does.
   * The client keeps that choice as the "muteMicOnEntry" preference of the profile, so the next entry starts from it;
   * a test that sets it to true puts it back to false when it ends (setMuteOnEntryPreference). Left out: the toggle is not touched.
   */
  enterMuted?: boolean;
  /** Extra query string, e.g. "?force_tcp" */
  query?: string;
  /**
   * The body calibration a headset client needs with the new solver on ("Use the new avatar body solver
   * (experimental)", preference avatarIkV2) and no height saved: without it the client shows its form between
   * the name step and the microphone setup and cannot enter in VR. `via: "seed"` (the default) puts the values
   * into the preferences before Join Room, as a player who calibrated earlier has them; `via: "form"` fills the
   * client's form as a person does. Left out, a headset client that would be asked is seeded with
   * DEFAULT_CALIBRATION. A form that shows without `via: "form"` fails the entry.
   */
  calibration?: Partial<Calibration> & { via?: "seed" | "form" };
  /** With `calibration.via: "form"`: called once the form shows, before it is filled (T5a tries the form there) */
  onCalibrationForm?: (page: Page) => Promise<void>;
  /** Run just before Enter Room is pressed: e.g. to hold the emulated headset where the height capture should find it */
  beforeEnter?: (page: Page) => Promise<void>;
  /** The page already shows the room's lobby (opened by the test): Join Room is pressed there without loading the page again */
  alreadyOpen?: boolean;
  timeout?: number;
};

/**
 * Opens the room, then Join Room, the name and avatar step (shown until a profile has accepted it once),
 * the microphone setup and Enter Room; waits until the scene is entered and the media server connected,
 * and closes the welcome tour. Returns how long each step took from the start, in milliseconds.
 */
export async function enterRoom(client: Client, hubId: string, opts: EnterOptions): Promise<EntryTimings> {
  const page = client.page;
  const timeout = opts.timeout ?? 240_000;
  const t0 = Date.now();
  const since = () => Date.now() - t0;

  if (!opts.alreadyOpen) await page.goto(client.roomUrl(hubId, opts.query), { waitUntil: "domcontentloaded", timeout: 120_000 });
  const load = since();
  const join = page.getByRole("button", { name: "Join Room" });
  await join.waitFor({ state: "visible", timeout });
  const joinVisible = since();
  // Only once the lobby shows: a profile change is sent on the room's channel (HubChannel.sendProfileUpdate),
  // which throws while the channel does not exist yet
  if (opts.avatarUrl) await page.evaluate(url => (window as any).APP.store.update({ profile: { avatarId: url } }), opts.avatarUrl);
  const vr = client.profile === "QUEST" || client.profile === "OLD_QUEST";
  // E2E_QUEST_NEW_SOLVER=1: a headset test that does not set the solver itself runs with the new one on and no
  // height saved, so its entry goes through the calibration (seeded, below): the existing VR tests with F4
  // Otherwise a test that does not set the solver gets the client's default, the old solver, and the default
  // fit and posture: a signed-in profile keeps what an earlier test (T5) set. The previous build's store has no
  // such preferences and reports them as invalid, so it is left alone
  const preferences =
    opts.preferences?.avatarIkV2 !== undefined || client.profile === "OLD" || client.profile === "OLD_QUEST"
      ? opts.preferences
      : client.profile === "QUEST" && process.env.E2E_QUEST_NEW_SOLVER === "1"
        ? { ...opts.preferences, avatarIkV2: true, bodyHeightCm: 0 }
        : { ...opts.preferences, avatarIkV2: false, bodyPosture: "standing", bodyFit: "avatarToPlayer" };
  if (preferences) await page.evaluate(preferences => (window as any).APP.store.update({ preferences }), preferences);
  const wanted: Calibration = { ...DEFAULT_CALIBRATION, ...opts.calibration };
  const saved = await page.evaluate(() => {
    const p = (window as any).APP.store.state.preferences;
    return { newSolver: !!p.avatarIkV2, heightCm: p.bodyHeightCm as number | undefined };
  });
  const calibrated = typeof saved.heightCm === "number" && saved.heightCm >= 50 && saved.heightCm <= 250;
  let calibration: EntryTimings["calibration"] = !vr || !saved.newSolver ? "none" : calibrated ? "saved" : undefined;
  if (vr && saved.newSolver && opts.calibration?.via !== "form" && (!calibrated || opts.calibration)) {
    await page.evaluate(c => (window as any).APP.store.update({ preferences: { bodyHeightCm: c.heightCm, bodyPosture: c.posture, bodyFit: c.fit } }), wanted);
    calibration = "seeded";
  }
  await join.click();

  // The name and avatar step, the body calibration (new solver, first VR entry) or the microphone step comes next
  const accept = page.getByRole("button", { name: "Accept" });
  const enter = page.getByRole("button", { name: "Enter Room" });
  const saveCalibration = page.getByRole("button", { name: "Save and Continue" });
  await accept.or(enter).or(saveCalibration).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await accept.isVisible()) {
    await page.getByLabel("Display Name").fill(opts.displayName);
    await accept.click();
  }
  const profile = since();

  let calibrationShown: number | undefined;
  await enter.or(saveCalibration).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await saveCalibration.isVisible()) {
    calibrationShown = since();
    if (opts.calibration?.via !== "form") throw new Error("the body calibration form showed although the test gave no calibration to fill (calibration.via \"form\")");
    if (opts.onCalibrationForm) await opts.onCalibrationForm(page);
    await fillCalibration(page, wanted);
    await saveCalibration.click();
    calibration = "form";
  } else if (opts.calibration?.via === "form") {
    throw new Error(`the body calibration form did not show (the profile's preferences: new solver ${saved.newSolver}, height ${saved.heightCm})`);
  }

  await enter.waitFor({ state: "visible", timeout: 60_000 });
  if (opts.enterMuted !== undefined) await setMuteToggle(page, opts.enterMuted);
  // Enabled once the microphone has been granted and opened
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === "Enter Room" && !b.disabled),
    undefined,
    { timeout: 60_000 }
  );
  const mic = since();
  if (opts.beforeEnter) await opts.beforeEnter(page);
  await enter.click();

  await waitEntered(page, 60_000);
  const entered = since();
  await waitMediaServer(page, 60_000);
  const mediaServer = since();
  // With the Quest Browser's user agent the client forces VR entry: Enter Room requests the immersive
  // session, which IWER provides (TRIALS.md, trial b)
  let presenting: number | undefined;
  if (client.profile === "QUEST" || client.profile === "OLD_QUEST") {
    await page.waitForFunction(() => !!(window as any).AFRAME.scenes[0].renderer.xr.isPresenting, undefined, { timeout: 60_000 });
    presenting = since();
  } else {
    await skipTour(page);
  }
  return { load, joinVisible, profile, mic, entered, mediaServer, presenting, calibration: calibration ?? "none", calibrationShown };
}

/** The body calibration form's fields (BodyCalibrationModal.js), filled as a person does; the Save button is left to the caller */
export async function fillCalibration(page: Page, c: Partial<Calibration>) {
  if (c.posture) await checkRadio(page, c.posture === "sitting" ? /^Sitting/ : /^Standing/);
  if (c.heightCm !== undefined) await page.getByLabel("Your height (cm)").fill(String(c.heightCm));
  if (c.fit) await checkRadio(page, c.fit === "playerToAvatar" ? /^Fit me to the avatar/ : /^Fit the avatar to me/);
}

/** A radio option of the client's RadioInputOption (the input may be drawn over by its label): its label is clicked when the input will not take the click */
async function checkRadio(page: Page, name: RegExp) {
  const radio = page.getByRole("radio", { name });
  if (await radio.isChecked()) return;
  await radio.check({ timeout: 5_000 }).catch(() => page.locator("label").filter({ has: radio }).click());
  if (!(await radio.isChecked())) throw new Error(`the radio option ${name} did not become checked`);
}

/**
 * The microphone setup step's "Mute" toggle (MicSetupModal.js: a checkbox inside a label, drawn as a switch; the
 * checkbox itself is 0 x 0 and transparent, so the click goes to its label, as a person's click on the switch does).
 * It appears once the browser has given the page the microphone.
 */
export async function setMuteToggle(page: Page, muted: boolean) {
  const checkbox = page.getByRole("checkbox", { name: "Mute", exact: true });
  await checkbox.waitFor({ state: "attached", timeout: 60_000 });
  if ((await checkbox.isChecked()) !== muted) await page.locator("label").filter({ has: checkbox }).click();
  if ((await checkbox.isChecked()) !== muted) throw new Error(`the microphone setup's Mute toggle did not become ${muted ? "on" : "off"}`);
}

/** Puts the "mute the microphone on entry" preference back (the toggle above changes it for the profile) */
export function setMuteOnEntryPreference(page: Page, muted: boolean) {
  return page.evaluate(muted => (window as any).APP.store.update({ preferences: { muteMicOnEntry: muted } }), muted);
}

export async function waitEntered(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as any).AFRAME?.scenes?.[0]?.is("entered"), undefined, { timeout });
}

export async function waitMediaServer(page: Page, timeout = 60_000) {
  await page.waitForFunction(IS_CONNECTED, undefined, { timeout });
}

/** Closes the "Welcome to ..." tour if it is shown; it covers the lower middle of the window */
export async function skipTour(page: Page) {
  const skip = page.getByRole("button", { name: "Skip tour" });
  await skip.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  if (await skip.isVisible()) await skip.click();
}

/** Enters several clients at once; each gets its own display name */
export function enterTogether(clients: Client[], hubId: string, opts: Omit<EnterOptions, "displayName"> = {}) {
  return Promise.all(clients.map(c => enterRoom(c, hubId, { ...opts, displayName: c.name })));
}
