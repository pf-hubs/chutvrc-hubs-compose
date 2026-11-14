// Desktop input (plan 2.4): keyboard and mouse events as a person makes them. W A S D move, Q and E
// snap-turn, a left-button drag looks around; toolbar buttons are clicked by their labels; in-world
// objects are clicked at the point of the screen where the page draws them.
import type { Download, Locator, Page } from "@playwright/test";

/** Takes keyboard focus away from any text field, so keys reach the scene */
async function releaseFocus(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** Holds a key for `ms` (W A S D move while held) */
export async function holdKey(page: Page, key: string, ms: number) {
  await releaseFocus(page);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

export const walk = (page: Page, direction: "w" | "a" | "s" | "d", ms: number) => holdKey(page, direction, ms);

/**
 * Snap turns: each press of Q (left) or E (right) turns the avatar by the snap angle. The key is held for
 * a few frames, since the client reads key states once a frame and misses a press shorter than that.
 */
export async function snapTurn(page: Page, direction: "left" | "right", times = 1) {
  await releaseFocus(page);
  const key = direction === "left" ? "q" : "e";
  for (let i = 0; i < times; i++) {
    await page.keyboard.down(key);
    await page.waitForTimeout(120);
    await page.keyboard.up(key);
    await page.waitForTimeout(250);
  }
}

/**
 * Looks around by dragging with the left button from the upper middle of the window (sky in most views,
 * so the press does not grab an object). Positive dx looks right, positive dy looks down.
 */
export async function look(page: Page, dx: number, dy: number, steps = 20) {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
  const [x, y] = [width / 2, height * 0.22];
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}

export type FaceTarget = { clientId: string } | { mediaSrc: string } | { selector: string };

/**
 * Turns the avatar with Q and E until a target is roughly ahead (within half a snap turn): another
 * client's avatar, where this client shows it, a placed object, or any element of the scene (a CSS selector). Returns the angle left, in degrees
 * (positive: the target is to the left), or null when this client has no such target.
 */
export async function faceTowards(page: Page, target: FaceTarget, snapDegrees = 45): Promise<number | null> {
  const angleTo = () =>
    page.evaluate(
      ({ target, findMedia }) => {
        const THREE = (window as any).AFRAME.THREE;
        let point: { x: number; z: number } | null = null;
        if ("clientId" in target) {
          point = (window as any).APP.avatarPoses.get(target.clientId)?.rig.pos ?? null;
        } else if ("selector" in target) {
          const el = document.querySelector(target.selector) as any;
          point = el ? new THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld) : null;
        } else {
          const el = new Function("arg", findMedia)({ src: target.mediaSrc });
          point = el ? new THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld) : null;
        }
        if (!point) return null;
        const camera = (window as any).AFRAME.scenes[0].camera;
        const at = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
        const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
        const yaw = (x: number, z: number) => Math.atan2(-x, -z);
        const delta = yaw(point.x - at.x, point.z - at.z) - yaw(ahead.x, ahead.z);
        return (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
      },
      { target, findMedia: FIND_MEDIA }
    );
  let angle = await angleTo();
  if (angle === null) return null;
  const turns = Math.round(Math.abs(angle) / snapDegrees);
  if (turns > 0) await snapTurn(page, angle > 0 ? "left" : "right", turns);
  await page.waitForTimeout(300);
  angle = await angleTo();
  return angle === null ? null : +angle.toFixed(1);
}

/** A toolbar button by its label ("Voice", "Recording", "Place", "Leave", ...) */
export function toolbarButton(page: Page, label: string): Locator {
  return page.getByRole("button", { name: label, exact: true });
}

/** Clicks the toolbar's Voice button (mute or unmute the microphone) */
export async function clickMic(page: Page) {
  await toolbarButton(page, "Voice").click();
}

/** What the Voice button shows: its status dot is "enabled" while the microphone is on, "disabled" when muted */
export async function micButtonState(page: Page): Promise<"on" | "muted" | "unknown"> {
  return toolbarButton(page, "Voice").evaluate(button => {
    if (button.querySelector('[class*="status-enabled"]')) return "on";
    if (button.querySelector('[class*="status-disabled"]')) return "muted";
    return "unknown";
  });
}

/** Clicks the toolbar's Recording button to start recording the room's data channel messages */
export async function startRecording(page: Page) {
  await toolbarButton(page, "Recording").click();
}

/** Clicks the Recording button again: the client stops and downloads the recording as a file */
export async function stopRecording(page: Page, timeout = 15_000): Promise<Download> {
  const download = page.waitForEvent("download", { timeout });
  await toolbarButton(page, "Recording").click();
  return download;
}

/**
 * Clicks an item of an open toolbar popover (Place, Share, ...) with the mouse at the item's position.
 * The popover's content is mounted afresh on every render of the toolbar, which happens many times a
 * second in a room, so Playwright's locator.click() never sees a stable element; a real press and
 * release at the position works, as it does for a person.
 */
export async function clickPopoverItem(page: Page, label: string, timeout = 10_000) {
  // The toolbar button's tooltip, shown while the mouse rests on it, can cover part of the popover
  await page.mouse.move((page.viewportSize()?.width ?? 1280) / 2, 40);
  const deadline = Date.now() + timeout;
  let box: { x: number; y: number } | null = null;
  while (!box && Date.now() < deadline) {
    box = await page.evaluate(label => {
      const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === label);
      const r = button?.getBoundingClientRect();
      return r && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 3 } : null;
    }, label);
    if (!box) await page.waitForTimeout(100);
  }
  if (!box) throw new Error(`no "${label}" item in the open popover`);
  await page.mouse.click(box.x, box.y, { delay: 80 });
}

/**
 * Places an object from a URL as a person does: Place > Upload, the URL into "Object URL or File",
 * Create Object. The object appears in front of the camera.
 */
export async function placeFromUrl(page: Page, url: string) {
  await toolbarButton(page, "Place").click();
  await clickPopoverItem(page, "Upload");
  await page.getByLabel("Object URL or File").fill(url);
  await page.getByRole("button", { name: "Create Object" }).click();
}

type ScreenPoint = { x: number; y: number; onScreen: boolean };

/**
 * Where on the page an in-world object is drawn: `finder` is page code returning an A-Frame element
 * (or null); its object's world position is projected through the scene's camera.
 */
async function screenPointOf(page: Page, finder: string, arg?: unknown): Promise<ScreenPoint | null> {
  return page.evaluate(
    ({ finder, arg }) => {
      const el = new Function("arg", finder)(arg);
      if (!el?.object3D) return null;
      const scene = (window as any).AFRAME.scenes[0];
      const v = new (window as any).AFRAME.THREE.Vector3();
      el.object3D.updateMatrixWorld(true);
      v.setFromMatrixPosition(el.object3D.matrixWorld).project(scene.camera);
      const r = scene.canvas.getBoundingClientRect();
      return {
        x: r.left + ((v.x + 1) / 2) * r.width,
        y: r.top + ((1 - v.y) / 2) * r.height,
        onScreen: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1
      };
    },
    { finder, arg }
  );
}

/**
 * Page code (arg: { src }) finding the placed object with that URL; when several have it (each client
 * placed one), the nearest one in front of the camera
 */
const FIND_MEDIA = `
  const scene = AFRAME.scenes[0];
  const camera = new AFRAME.THREE.Vector3().setFromMatrixPosition(scene.camera.matrixWorld);
  const inFront = el => {
    const v = new AFRAME.THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld).project(scene.camera);
    return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1;
  };
  const distance = el => new AFRAME.THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld).distanceTo(camera);
  const all = [...document.querySelectorAll("[media-loader]")].filter(el => el.components["media-loader"]?.data?.src === arg.src);
  return all.filter(inFront).sort((a, b) => distance(a) - distance(b))[0] || all[0] || null;`;

/** Page code (arg: { src, label }) finding that object's hover menu button showing the label */
const FIND_MENU_BUTTON = `
  const media = (() => {${FIND_MEDIA}})();
  const shown = el => { for (let o = el.object3D; o; o = o.parent) if (!o.visible) return false; return true; };
  return [...(media ? media.querySelectorAll("[open-media-button]") : [])]
    .find(b => shown(b) && b.querySelector("[text]")?.getAttribute("text")?.value === arg.label) || null;`;

/**
 * Waits until a placed room link has loaded: the client gives it the room link hover menu once its
 * preview image has loaded and the URL is known to be a room
 */
export async function waitForRoomLink(page: Page, src: string, timeout = 60_000) {
  await page.waitForFunction(
    ({ finder, src }) => !!new Function("arg", finder)({ src })?.components["hover-menu__hubs-item"],
    { finder: FIND_MEDIA, src },
    { timeout }
  );
}

/**
 * Clicks a button of a placed object's hover menu, e.g. "visit room" on a room link: moves the mouse
 * onto the object so its hover menu shows, waits for the button with that label, and clicks it.
 */
export async function clickHoverMenuButton(page: Page, src: string, label: string, timeout = 20_000) {
  const media = await screenPointOf(page, FIND_MEDIA, { src });
  if (!media?.onScreen) throw new Error(`the object ${src} is not on screen`);
  await page.mouse.move(media.x, media.y, { steps: 5 });
  const deadline = Date.now() + timeout;
  let button: ScreenPoint | null = null;
  while (Date.now() < deadline) {
    button = await screenPointOf(page, FIND_MENU_BUTTON, { src, label });
    if (button?.onScreen) break;
    // Small moves keep the cursor's hover fresh
    await page.mouse.move(media.x + (Date.now() % 2 ? 1 : -1), media.y);
    await page.waitForTimeout(250);
  }
  if (!button?.onScreen) throw new Error(`no "${label}" button showed on the object ${src}`);
  await page.mouse.move(button.x, button.y, { steps: 5 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

// ---------- UI that remounts, clicked at its position (see clickPopoverItem) ----------

type Rect = { x: number; y: number };

/**
 * Presses and releases the mouse on the element `finder` (page code returning an element or null)
 * finds, at its centre. For UI that is mounted afresh many times a second, where locator.click() never
 * sees a stable element.
 */
export async function clickFound(page: Page, finder: string, arg?: unknown, what = "element", timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let box: Rect | null = null;
  while (!box && Date.now() < deadline) {
    box = await page.evaluate(
      ({ finder, arg }) => {
        const el = new Function("arg", finder)(arg) as Element | null;
        // An entry of a scrolled list (the microphone list) may lie below its visible part
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { finder, arg }
    );
    if (!box) await page.waitForTimeout(100);
  }
  if (!box) throw new Error(`no ${what} to click`);
  await page.mouse.click(box.x, box.y, { delay: 80 });
}

/** Opens a toolbar popover (Share, Place, More, Chutvrc, ...) unless it is open, and clicks one of its items */
export async function choosePopoverItem(page: Page, toolbarLabel: string, itemLabel: string) {
  // A popover may still be open from the last choice; its toolbar button would close it again
  const open = await page.evaluate(
    label => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === label && b.getBoundingClientRect().width > 0 && !b.closest("[class*=toolbar]")),
    itemLabel
  );
  if (!open) {
    await toolbarButton(page, toolbarLabel).click();
    await page.waitForTimeout(300);
  }
  await clickPopoverItem(page, itemLabel);
}

// ---------- Audio settings (the arrow next to Voice) ----------

/** The Audio Settings button: the arrow left of Voice, in the same container */
const AUDIO_SETTINGS_BUTTON = `
  const voice = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Voice");
  let box = voice?.parentElement;
  while (box && box.querySelectorAll("button").length < 2) box = box.parentElement;
  return box ? [...box.querySelectorAll("button")].find(b => b !== voice) : null;`;

const AUDIO_POPOVER = `return document.querySelector('[class*="audio-toolbar-popover"]');`;
const MIC_SELECT = `const p = document.querySelector('[class*="audio-toolbar-popover"]'); return p && (p.querySelector('[class*="dropdown-button"]') || p.querySelector('[aria-haspopup="listbox"]'));`;

async function audioPopoverOpen(page: Page): Promise<boolean> {
  return page.evaluate(f => !!new Function(f)(), AUDIO_POPOVER);
}

export async function openAudioSettings(page: Page) {
  if (!(await audioPopoverOpen(page))) await clickFound(page, AUDIO_SETTINGS_BUTTON, undefined, "Audio Settings button");
  await page.waitForFunction(f => !!new Function(f)(), AUDIO_POPOVER, { timeout: 10_000 });
}

export async function closeAudioSettings(page: Page) {
  if (await audioPopoverOpen(page)) await clickFound(page, AUDIO_SETTINGS_BUTTON, undefined, "Audio Settings button");
  await page.waitForTimeout(300);
}

/** The microphone shown as selected in Audio Settings, and every one it offers */
export async function microphoneChoices(page: Page): Promise<{ selected: string | null; options: string[] }> {
  await openAudioSettings(page);
  const selected = await page.evaluate(f => (new Function(f)() as HTMLElement | null)?.textContent?.trim() ?? null, MIC_SELECT);
  await clickFound(page, MIC_SELECT, undefined, "microphone selector");
  await page.waitForTimeout(400);
  const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map(o => o.textContent?.trim() ?? ""));
  // Close the list again without choosing
  await clickFound(page, MIC_SELECT, undefined, "microphone selector");
  await closeAudioSettings(page);
  return { selected, options };
}

/**
 * Chooses a microphone in Audio Settings, as a person does: open the popover, open the microphone list,
 * click the entry labelled `label` (or else the first containing it). Returns the label shown afterwards.
 */
export async function chooseMicrophone(page: Page, label: string): Promise<string | null> {
  await openAudioSettings(page);
  await clickFound(page, MIC_SELECT, undefined, "microphone selector");
  await clickFound(
    page,
    `const all = [...document.querySelectorAll('[role="option"]')]; return all.find(o => o.textContent.trim() === arg) || all.find(o => o.textContent.includes(arg)) || null;`,
    label,
    `microphone "${label}" in the list`
  );
  await page.waitForTimeout(1500);
  await openAudioSettings(page);
  const shown = await page.evaluate(f => (new Function(f)() as HTMLElement | null)?.textContent?.trim() ?? null, MIC_SELECT);
  await closeAudioSettings(page);
  return shown;
}

// ---------- Share, Place ----------

/** Share > Camera: starts sharing the camera */
export const toggleShareCamera = (page: Page) => choosePopoverItem(page, "Share", "Camera");
/** Share > Screen: starts sharing the screen */
export const toggleShareScreen = (page: Page) => choosePopoverItem(page, "Share", "Screen");
/**
 * While something is shared the toolbar's Share button has no popover: it stops the share (SharePopover.js
 * shows only the active item's button). Switching from the camera to the screen is this, then Share > Screen.
 */
export const stopSharing = (page: Page) => toolbarButton(page, "Share").click();
/** Place > Camera: the camera tool appears in front of the avatar (a second press removes it) */
export const toggleCameraTool = (page: Page) => choosePopoverItem(page, "Place", "Camera");

// ---------- More menu: preferences, room settings ----------

/** The check box of a preference row, found by the row's label */
const PREFERENCE_BOX = `
  const label = [...document.querySelectorAll('[class*="preference-label"]')].find(e => e.textContent.trim() === arg);
  return label ? label.parentElement.querySelector('input[type="checkbox"]') : null;`;

/**
 * More > Preferences, the category `tab` (its button is labelled "Select category <tab>"), and a check box
 * preference by its label; closes the screen again and returns the box's state.
 */
export async function setPreference(page: Page, tab: string, label: string, on: boolean): Promise<boolean> {
  await choosePopoverItem(page, "More", "Preferences");
  await clickFound(page, `return document.querySelector('button[aria-label="Select category ${tab}"]')`, undefined, `the ${tab} category`);
  await page.waitForTimeout(500);
  const checked = () => page.evaluate(({ f, label }) => (new Function("arg", f)(label) as HTMLInputElement | null)?.checked ?? null, { f: PREFERENCE_BOX, label });
  if ((await checked()) === null) throw new Error(`no preference "${label}" in ${tab}`);
  if ((await checked()) !== on) await clickFound(page, PREFERENCE_BOX, label, `the "${label}" box`);
  await page.waitForTimeout(300);
  const now = (await checked()) === true;
  await clickFound(page, `return document.querySelector('button[aria-label="Close Preferences Menu"]')`, undefined, "the preferences close button");
  await page.waitForTimeout(500);
  return now;
}

/**
 * More > Room Info and Settings > Edit, "WebRTC SFU" set to `server` ("Dialog", "LiveKit"), Apply.
 * Only an admin sees the WebRTC SFU field.
 */
export async function setRoomMediaServer(page: Page, server: "Dialog" | "LiveKit") {
  await choosePopoverItem(page, "More", "Room Info and Settings");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  // The radio's accessible name runs on into its description ("LiveKit LiveKit Cloud WebRTC SFU"), so it is found by its value
  await page.locator('input[type="radio"][name="sfu"][value="' + (server === "Dialog" ? 0 : 2) + '"]').check({ force: true });
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(500);
}

// ---------- People ----------

/** Opens People and the profile of the person shown as `displayName`; from another profile it goes Back first */
export async function openPerson(page: Page, displayName: string) {
  const back = page.getByRole("button", { name: "Back", exact: true });
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(300);
  }
  // In the sidebar: the same name can also be in a chat notification ("... entered the room")
  const list = page.locator('[class*="sidebar" i]').getByText(displayName, { exact: true }).first();
  if (!(await list.isVisible().catch(() => false))) await page.getByRole("button", { name: /^People/ }).click();
  await list.click();
}

/** A button of the open profile sidebar ("Hide", "Unhide", "Kick", "Mute") */
export async function clickProfileButton(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
}

/** Closes the People sidebar (from a profile: Back, then the People toggle) */
export async function closeSidebar(page: Page) {
  const back = page.getByRole("button", { name: "Back", exact: true });
  if (await back.isVisible().catch(() => false)) await back.click();
  await page.waitForTimeout(200);
  const people = page.getByRole("button", { name: /^People/ });
  const open = await page.evaluate(() => !!document.querySelector('[class*="sidebar"]'));
  if (open && (await people.isVisible().catch(() => false))) await people.click();
  await page.waitForTimeout(300);
}

// ---------- Leaving ----------

/** Leave, then confirm in the dialog (its confirmation is a link to the home page, so the page navigates away) */
export async function leaveRoom(page: Page) {
  await toolbarButton(page, "Leave").click();
  // The dialog re-renders while the room is busy, so its link is pressed at its position
  await clickFound(
    page,
    'const all = [...document.querySelectorAll("a, button")].filter(b => b.textContent?.trim() === "Leave Room"); return all[all.length - 1] || null;',
    undefined,
    "Leave Room button of the dialog"
  );
}

// ---------- In-world objects ----------

/** Clicks an in-world object found by page code (returning an A-Frame element or a three.js object) */
export async function clickInWorld(page: Page, finder: string, arg?: unknown, what = "object") {
  const point = await screenPointOf(page, finder, arg);
  if (!point?.onScreen) throw new Error(`${what} is not on screen`);
  await page.mouse.move(point.x, point.y, { steps: 5 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/**
 * Pages a placed PDF with its hover menu: moves the mouse onto it so the pager shows, then clicks the
 * next (or previous) button
 */
export async function pagePdf(page: Page, src: string, direction: "next" | "prev", timeout = 15_000) {
  const media = await screenPointOf(page, FIND_MEDIA, { src });
  if (!media?.onScreen) throw new Error(`the PDF ${src} is not on screen`);
  await page.mouse.move(media.x, media.y, { steps: 5 });
  const button = `
    const media = (() => {${FIND_MEDIA}})();
    const shown = el => { for (let o = el.object3D; o; o = o.parent) if (!o.visible) return false; return true; };
    const b = media && media.querySelector(".${direction}-button [text-button]");
    return b && shown(b) ? b : null;`;
  const deadline = Date.now() + timeout;
  let point: ScreenPoint | null = null;
  while (Date.now() < deadline) {
    point = await screenPointOf(page, button, { src });
    if (point?.onScreen) break;
    await page.mouse.move(media.x + (Date.now() % 2 ? 1 : -1), media.y);
    await page.waitForTimeout(250);
  }
  if (!point?.onScreen) throw new Error(`no ${direction} button showed on the PDF`);
  await page.mouse.move(point.x, point.y, { steps: 5 });
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
}

/** The page index a client shows for the placed PDF with this URL, or null */
export function pdfPageOf(page: Page, src: string): Promise<number | null> {
  return page.evaluate(
    ({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      const pager = el?.components?.["media-pager"];
      return pager ? pager.data.index : null;
    },
    { finder: FIND_MEDIA, src }
  );
}

/** Page code (arg: { src }) finding the placed object with that URL; for tests that read it */
export const FIND_MEDIA_CODE = FIND_MEDIA;

/**
 * An action of the Chutvrc popover: its menu ("Nimpro" or "Broadcast") shows the actions ("Init Nimpro",
 * "New Round", "Result", "Start Speaking", ...). The popover remembers the open menu, and clicking the
 * menu's button again closes it, so this opens only what is not open yet. With `done`, a click that had no
 * effect (the popover's buttons are mounted afresh while it opens) is repeated, up to three times.
 */
export async function chutvrcAction(page: Page, menu: "Nimpro" | "Broadcast", action: string, done?: () => Promise<boolean>) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await chutvrcClick(page, menu, action);
    if (!done) return;
    await page.waitForTimeout(1000);
    if (await done()) return;
  }
  throw new Error(`Chutvrc > ${menu} > ${action} had no effect after three clicks`);
}

async function chutvrcClick(page: Page, menu: "Nimpro" | "Broadcast", action: string) {
  const visible = (label: string) =>
    page.evaluate(label => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === label && b.getBoundingClientRect().width > 0), label);
  if (!(await visible(action)) && !(await visible(menu))) {
    await toolbarButton(page, "Chutvrc").click();
    await page.waitForTimeout(300);
  }
  if (!(await visible(action))) {
    await clickPopoverItem(page, menu);
    await page.waitForTimeout(300);
  }
  await clickPopoverItem(page, action);
}
