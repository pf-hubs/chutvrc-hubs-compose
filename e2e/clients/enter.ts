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
};

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
  if (opts.preferences) await page.evaluate(preferences => (window as any).APP.store.update({ preferences }), opts.preferences);
  await join.click();

  // Either the name and avatar step or the microphone step comes next
  const accept = page.getByRole("button", { name: "Accept" });
  const enter = page.getByRole("button", { name: "Enter Room" });
  await accept.or(enter).first().waitFor({ state: "visible", timeout: 60_000 });
  if (await accept.isVisible()) {
    await page.getByLabel("Display Name").fill(opts.displayName);
    await accept.click();
  }
  const profile = since();

  await enter.waitFor({ state: "visible", timeout: 60_000 });
  if (opts.enterMuted !== undefined) await setMuteToggle(page, opts.enterMuted);
  // Enabled once the microphone has been granted and opened
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === "Enter Room" && !b.disabled),
    undefined,
    { timeout: 60_000 }
  );
  const mic = since();
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
  return { load, joinVisible, profile, mic, entered, mediaServer, presenting };
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
