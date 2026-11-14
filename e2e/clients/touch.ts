// Touch input for the ANDROID and IOS profiles (plan 2.4): taps on the toolbar and menus, drags on the two
// on-screen joysticks, a two-finger pinch, and turning the phone (an orientation change by swapping the
// viewport).
//
// On Chromium (ANDROID) touches go through the DevTools protocol (Input.dispatchTouchEvent), which the
// browser turns into touch and pointer events as a touchscreen does. WebKit (IOS) has no DevTools
// protocol here: taps use Playwright's touchscreen, and drags are dispatched in the page as pointer and
// touch events at the same points (the joystick library, nipplejs, listens to pointer events).
//
// The joysticks: the client adds them on a phone (virtual-gamepad-controls.js, nipplejs in "static" mode,
// one zone at the lower left for moving and one at the lower right for looking). A drag from a stick's
// centre in a direction moves (left) or turns and pitches (right) while held.
import type { CDPSession, Locator } from "@playwright/test";
import { isWebKitClient, type Client } from "./launch";

const sessions = new WeakMap<Client, Promise<CDPSession>>();

function cdp(client: Client): Promise<CDPSession> {
  let s = sessions.get(client);
  if (!s) {
    s = client.context.newCDPSession(client.page);
    sessions.set(client, s);
  }
  return s;
}

type Point = { x: number; y: number };
const touchPoint = (p: Point, id: number) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });

/** Dispatches touches in the page (WebKit): pointer events, and touch events where the page has them */
const PAGE_TOUCH = `
  const [type, points] = arg;
  const pointerType = { start: "pointerdown", move: "pointermove", end: "pointerup" }[type];
  const touchType = { start: "touchstart", move: "touchmove", end: "touchend" }[type];
  for (const p of points) {
    const target = window.__e2eTouchTargets?.[p.id] || document.elementFromPoint(p.x, p.y) || document.body;
    if (type === "start") (window.__e2eTouchTargets ??= {})[p.id] = target;
    const init = { bubbles: true, cancelable: true, composed: true, clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y, pointerId: 100 + p.id, pointerType: "touch", isPrimary: p.id === 1, buttons: type === "end" ? 0 : 1, button: 0, pressure: type === "end" ? 0 : 0.5 };
    target.dispatchEvent(new PointerEvent(pointerType, init));
    if (typeof Touch === "function" && typeof TouchEvent === "function") {
      try {
        const touch = new Touch({ identifier: p.id, target, clientX: p.x, clientY: p.y, pageX: p.x + scrollX, pageY: p.y + scrollY, radiusX: 4, radiusY: 4, force: 1 });
        const list = type === "end" ? [] : [touch];
        target.dispatchEvent(new TouchEvent(touchType, { bubbles: true, cancelable: true, composed: true, touches: list, targetTouches: list, changedTouches: [touch] }));
      } catch (e) {}
    }
    if (type === "end") delete window.__e2eTouchTargets[p.id];
  }`;

async function dispatch(client: Client, type: "start" | "move" | "end", points: (Point & { id: number })[]) {
  if (isWebKitClient(client)) {
    await client.page.evaluate(({ code, arg }) => new Function("arg", code)(arg), { code: PAGE_TOUCH, arg: [type, points] as const });
    return;
  }
  const session = await cdp(client);
  const cdpType = type === "start" ? "touchStart" : type === "move" ? "touchMove" : "touchEnd";
  await session.send("Input.dispatchTouchEvent", { type: cdpType, touchPoints: type === "end" ? [] : points.map(p => touchPoint(p, p.id)) });
}

/** A tap at a point of the page */
export async function tapAt(client: Client, x: number, y: number) {
  if (isWebKitClient(client)) return client.page.touchscreen.tap(x, y);
  await dispatch(client, "start", [{ x, y, id: 1 }]);
  await client.page.waitForTimeout(60);
  await dispatch(client, "end", [{ x, y, id: 1 }]);
}

/** A tap on an element (its centre); Playwright's own tap, which goes through the touchscreen on both engines */
export async function tap(locator: Locator) {
  await locator.tap();
}

/**
 * Taps the element `finder` (page code returning an element or null) finds, at its centre, for UI that is
 * mounted afresh many times a second (toolbar popovers), where locator.tap() never sees a stable element
 */
export async function tapFound(client: Client, finder: string, arg?: unknown, what = "element", timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let box: Point | null = null;
  while (!box && Date.now() < deadline) {
    box = await client.page.evaluate(
      ({ finder, arg }) => {
        const el = new Function("arg", finder)(arg) as Element | null;
        el?.scrollIntoView({ block: "nearest" });
        const r = el?.getBoundingClientRect();
        return r && r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { finder, arg }
    );
    if (!box) await client.page.waitForTimeout(100);
  }
  if (!box) throw new Error(`no ${what} to tap`);
  await tapAt(client, box.x, box.y);
}

/** Taps a button by its visible text (the first one shown); for popover items */
export const tapButtonText = (client: Client, label: string, timeout?: number) =>
  tapFound(client, `return [...document.querySelectorAll("button, a, [role=button]")].find(b => b.textContent?.trim() === arg && b.getBoundingClientRect().width > 0) || null;`, label, `"${label}"`, timeout);

/** One finger along a path: down at the first point, through the others, held at the last for `holdMs`, up */
export async function touchDrag(client: Client, path: Point[], holdMs = 0, stepMs = 16) {
  await dispatch(client, "start", [{ ...path[0], id: 1 }]);
  for (const p of path.slice(1)) {
    await client.page.waitForTimeout(stepMs);
    await dispatch(client, "move", [{ ...p, id: 1 }]);
  }
  // A held stick keeps reporting its position; a few moves on the spot keep the drag alive on every engine
  const last = path[path.length - 1];
  const until = Date.now() + holdMs;
  while (Date.now() < until) {
    await client.page.waitForTimeout(Math.min(100, until - Date.now()));
    await dispatch(client, "move", [{ x: last.x + (Date.now() % 2 ? 0.5 : -0.5), y: last.y, id: 1 }]);
  }
  await dispatch(client, "end", [{ ...last, id: 1 }]);
}

export type Stick = "left" | "right";

/** Where the client draws its joysticks: the centre and radius of each stick's base, or null when it has none */
export function joysticks(client: Client): Promise<Partial<Record<Stick, { x: number; y: number; r: number }>> | null> {
  return client.page.evaluate(() => {
    const backs = [...document.querySelectorAll(".nipple .back")]
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0)
      .map(r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2, r: r.width / 2 }))
      .sort((a, b) => a.x - b.x);
    if (!backs.length) return null;
    // One stick: it is the one on its side of the window
    if (backs.length === 1) return backs[0].x < innerWidth / 2 ? { left: backs[0] } : { right: backs[0] };
    return { left: backs[0], right: backs[backs.length - 1] };
  });
}

/**
 * Holds a joystick pushed in a direction for `ms`: (dx, dy) in stick radii, x to the right, y down (the
 * left stick pushed up walks forward; the right stick pushed sideways turns). Returns the stick it used.
 */
export async function pushStick(client: Client, stick: Stick, dx: number, dy: number, ms: number) {
  const sticks = await joysticks(client);
  const s = sticks?.[stick];
  if (!s) throw new Error(`${client.name} shows no ${stick} joystick`);
  const steps = 6;
  const path: Point[] = [{ x: s.x, y: s.y }];
  for (let i = 1; i <= steps; i++) path.push({ x: s.x + (dx * s.r * i) / steps, y: s.y + (dy * s.r * i) / steps });
  await touchDrag(client, path, ms);
  return s;
}

/**
 * Two fingers moving apart (spread > 1) or together around a point: the pinch gesture. Chromium only (the
 * page events on WebKit would carry only one touch per event here).
 */
export async function pinch(client: Client, centre: Point, fromDistance: number, toDistance: number, steps = 12) {
  if (isWebKitClient(client)) throw new Error("pinch is dispatched through the DevTools protocol, which the WebKit client has not");
  const at = (d: number) => [
    { x: centre.x - d / 2, y: centre.y, id: 1 },
    { x: centre.x + d / 2, y: centre.y, id: 2 }
  ];
  const session = await cdp(client);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(fromDistance).map(p => touchPoint(p, p.id)) });
  for (let i = 1; i <= steps; i++) {
    await client.page.waitForTimeout(16);
    const d = fromDistance + ((toDistance - fromDistance) * i) / steps;
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(d).map(p => touchPoint(p, p.id)) });
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export type Orientation = "portrait" | "landscape";

/**
 * Turns the device: the viewport's width and height swapped (Playwright sets the emulated screen orientation
 * with it on a mobile context). Returns what the page reports afterwards.
 */
export async function rotate(client: Client, to: Orientation) {
  const size = client.page.viewportSize();
  if (!size) throw new Error(`${client.name} has no fixed viewport`);
  const portrait = size.height >= size.width;
  if ((to === "portrait") !== portrait) await client.page.setViewportSize({ width: size.height, height: size.width });
  await client.page.waitForTimeout(1500);
  return orientationOf(client);
}

export function orientationOf(client: Client) {
  return client.page.evaluate(() => {
    const canvas = (window as any).AFRAME?.scenes?.[0]?.canvas as HTMLCanvasElement | undefined;
    return {
      inner: [innerWidth, innerHeight],
      screenOrientation: screen.orientation?.type ?? null,
      matchesLandscape: matchMedia("(orientation: landscape)").matches,
      canvasCss: canvas ? [canvas.clientWidth, canvas.clientHeight] : null,
      canvasPixels: canvas ? [canvas.width, canvas.height] : null
    };
  });
}
