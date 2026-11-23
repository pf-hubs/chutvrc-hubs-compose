// Entering a room through the real entry UI (plan 2.3, selectors from TRIALS.md "Entering a room").
import type { Page } from "@playwright/test";
import type { Client } from "./launch";
import { IS_CONNECTED } from "../probes/compat";
import { answerCapturePrompt } from "./motion";

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
   * The body calibration, a step of every VR entry on the current build: "form" when its fields were filled in,
   * "seeded" when the values were put into the preferences before Join Room and the form only confirmed them,
   * "saved" when the profile had them and the form only confirmed them, "none" when the entry has no such step
   * (not in VR, or the previous build)
   */
  calibration?: "form" | "seeded" | "saved" | "none";
  /** When the calibration form showed, from the start */
  calibrationShown?: number;
  /** The label of the form's button when it was pressed: "Continue" with the saved values unchanged */
  calibrationButton?: string;
  /** QUEST: whether both triggers took the headset's height; null when the entry left the prompt unanswered */
  captured?: boolean | null;
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
   * The body calibration of a headset client. Every VR entry shows the form between the name step and the
   * microphone setup, filled in with the saved values. `via: "seed"` (the default) puts the values into the
   * preferences before Join Room, as a player who calibrated earlier has them, and presses "Continue";
   * `via: "form"` fills the client's form as a person does. Left out, a profile with a saved height keeps it and a
   * headset without one is seeded with DEFAULT_CALIBRATION.
   */
  calibration?: Partial<Calibration> & { via?: "seed" | "form" };
  /** Called once the calibration form shows, before it is filled or confirmed (T5a tries the form there) */
  onCalibrationForm?: (page: Page) => Promise<void>;
  /** QUEST: false leaves the height capture's prompt unanswered after the entry; by default both triggers answer it */
  capture?: boolean;
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
  // The previous build has neither the calibration step nor these preferences (its store reports them as invalid)
  const oldBuild = client.profile === "OLD" || client.profile === "OLD_QUEST";
  const calibrates = client.profile === "QUEST";
  // A signed-in profile keeps the fit and posture an earlier test (T5) set; a test that needs others gives them
  const preferences = oldBuild ? opts.preferences : { bodyPosture: "standing", bodyFit: "avatarToPlayer", ...opts.preferences };
  if (preferences) await page.evaluate(preferences => (window as any).APP.store.update({ preferences }), preferences);
  const wanted: Calibration = { ...DEFAULT_CALIBRATION, ...opts.calibration };
  const savedHeight = await page.evaluate(() => (window as any).APP.store.state.preferences.bodyHeightCm as number | undefined);
  const calibrated = typeof savedHeight === "number" && savedHeight >= 50 && savedHeight <= 250;
  let calibration: EntryTimings["calibration"] = !calibrates ? "none" : calibrated ? "saved" : undefined;
  if (calibrates && opts.calibration?.via !== "form" && (!calibrated || opts.calibration)) {
    await page.evaluate(c => (window as any).APP.store.update({ preferences: { bodyHeightCm: c.heightCm, bodyPosture: c.posture, bodyFit: c.fit } }), wanted);
    calibration = "seeded";
  }
  await join.click();

  // The name and avatar step, the body calibration (every VR entry) or the microphone step comes next
  const accept = page.getByRole("button", { name: "Accept" });
  const enter = page.getByRole("button", { name: "Enter Room" });
  const calibrationForm = page.getByLabel("Your height (cm)");
  await accept.or(enter).or(calibrationForm).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await accept.isVisible()) {
    await page.getByLabel("Display Name").fill(opts.displayName);
    await accept.click();
  }
  const profile = since();

  let calibrationShown: number | undefined;
  let calibrationButton: string | undefined;
  if (calibrates) {
    await enter.or(calibrationForm).first().waitFor({ state: "visible", timeout: 60_000 });
    if (!(await calibrationForm.isVisible())) throw new Error(`the body calibration form did not show on a VR entry (saved height ${savedHeight})`);
    calibrationShown = since();
    if (opts.onCalibrationForm) await opts.onCalibrationForm(page);
    if (opts.calibration?.via === "form") {
      await fillCalibration(page, wanted);
      calibration = "form";
    }
    // "Continue" with the saved values unchanged, "Save and Continue" otherwise (BodyCalibrationModal.js)
    const submit = page.getByRole("button", { name: /^(Save and )?Continue$/ });
    calibrationButton = (await submit.textContent())?.trim();
    await submit.click();
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
  let captured: boolean | null = null;
  if (client.profile === "QUEST" || client.profile === "OLD_QUEST") {
    await page.waitForFunction(() => !!(window as any).AFRAME.scenes[0].renderer.xr.isPresenting, undefined, { timeout: 60_000, polling: 100 });
    presenting = since();
    // The capture waits for both triggers, up to a minute, with the cursors off meanwhile
    if (calibrates && opts.capture !== false) captured = await answerCapturePrompt(page);
  } else {
    await skipTour(page);
  }
  return { load, joinVisible, profile, mic, entered, mediaServer, presenting, calibration: calibration ?? "none", calibrationShown, calibrationButton, captured };
}

/** The body calibration form's fields (BodyCalibrationModal.js), filled as a person does; its button is left to the caller */
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
