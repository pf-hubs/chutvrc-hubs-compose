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

export type FaceTarget = { clientId: string } | { mediaSrc: string };

/**
 * Turns the avatar with Q and E until a target is roughly ahead (within half a snap turn): another
 * client's avatar, where this client shows it, or a placed object. Returns the angle left, in degrees
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
