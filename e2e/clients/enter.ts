// Entering a room through the real entry UI (plan 2.3, selectors from TRIALS.md "Entering a room").
import type { Page } from "@playwright/test";
import type { Client } from "./launch";

export type EntryTimings = { load: number; joinVisible: number; profile: number; mic: number; entered: number; mediaServer: number };

export type EnterOptions = {
  displayName: string;
  /** A full avatar URL put into the profile's avatarId before entering, as a user does with a custom avatar URL */
  avatarUrl?: string;
  /** Extra query string, e.g. "?force_tcp" */
  query?: string;
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

  await page.goto(`${client.baseUrl}/${hubId}${opts.query ?? ""}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const load = since();
  if (opts.avatarUrl) {
    await page.waitForFunction(() => (window as any).APP?.store, undefined, { timeout });
    await page.evaluate(url => (window as any).APP.store.update({ profile: { avatarId: url } }), opts.avatarUrl);
  }

  const join = page.getByRole("button", { name: "Join Room" });
  await join.waitFor({ state: "visible", timeout });
  const joinVisible = since();
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
  await skipTour(page);
  return { load, joinVisible, profile, mic, entered, mediaServer };
}

export async function waitEntered(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => (window as any).AFRAME?.scenes?.[0]?.is("entered"), undefined, { timeout });
}

export async function waitMediaServer(page: Page, timeout = 60_000) {
  await page.waitForFunction(() => !!(window as any).APP?.sfu?.isConnected, undefined, { timeout });
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
