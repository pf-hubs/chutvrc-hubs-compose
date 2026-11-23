// Step 8 trial: the ANDROID and IOS profiles in a Dialog room with a DESK observer. Entry, what the phone
// shows (joysticks, toolbar), a joystick walk and turn seen by the observer, audio both ways, a rotation.
//   npx tsx trials/step8-devices.ts [android|ios|ipad|all] [room]
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";
import { room, type RoomName } from "../lib/fixtures";
import { launchClient, type Client, type ProfileId } from "../clients/launch";
import { ensureSignedIn } from "../clients/signin";
import { enterRoom } from "../clients/enter";
import * as touch from "../clients/touch";
import { readSession, measureFrameRate } from "../probes/session";
import { heardPilot } from "../probes/audio";
import { readPose, tracePose, movement } from "../probes/poses";
import { CONTROL_HZ } from "../assets/media";

const which = process.argv[2] ?? "android";
const roomName = (process.argv[3] ?? "dialog-main") as RoomName;
const out = path.join(EVIDENCE_DIR, "trials", "step8");
fs.mkdirSync(out, { recursive: true });
const hub = room(roomName);
const profiles: ProfileId[] = which === "all" ? ["ANDROID", "IOS"] : which === "ios" ? ["IOS"] : which === "ipad" ? ["IOS_IPAD"] : ["ANDROID"];
const result: Record<string, unknown> = { room: roomName, hubId: hub.hubId };

const desk = await launchClient({ profile: "DESK", identity: "member1", slot: "a", name: "A-desk", position: [0, 0] });
await ensureSignedIn(desk, "member1");
const devices: Client[] = [];
for (const [i, p] of profiles.entries()) {
  devices.push(await launchClient({ profile: p, identity: `${p.toLowerCase()}1`, slot: (["b", "c"] as const)[i], name: `${"BC"[i]}-${p.toLowerCase()}`, position: [1300, 0] }));
}
const shot = (c: Client, label: string) => c.page.screenshot({ path: path.join(out, `${c.name}-${label}.png`) }).catch(e => console.log(`shot ${label}: ${e}`));
try {
  const t0 = Date.now();
  const entries = await Promise.allSettled([enterRoom(desk, hub.hubId, { displayName: desk.name }), ...devices.map(d => enterRoom(d, hub.hubId, { displayName: d.name, timeout: 300_000 }))]);
  result.entry = entries.map(e => (e.status === "fulfilled" ? e.value : `failed: ${String(e.reason).split("\n")[0]}`));
  result.entryMs = Date.now() - t0;
  for (const d of devices) await shot(d, "entered");
  const deskId = (await readSession(desk.page)).clientId;
  for (const d of devices) {
    const r: Record<string, unknown> = {};
    result[d.name] = r;
    try {
      r.session = await readSession(d.page);
      r.isMobile = await d.page.evaluate(() => (window as any).AFRAME.utils.device.isMobile());
      r.fps = await measureFrameRate(d.page);
      r.joysticks = await touch.joysticks(d);
      r.orientation = await touch.orientationOf(d);
      r.buttons = await d.page.evaluate(() => [...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().width > 0).map(b => (b.getAttribute("aria-label") || b.textContent || "").trim()).filter(Boolean));
      const id = (r.session as any).clientId as string;
      r.deskHears = await heardPilot(desk.page, id, d.pilotHz, CONTROL_HZ, 4000);
      r.hearsDesk = await heardPilot(d.page, deskId, desk.pilotHz, CONTROL_HZ, 4000);
      r.pilotContext = await d.page.evaluate(() => (window as any).__e2ePilotContext?.() ?? "n/a");
      const before = await readPose(desk.page, id);
      const trace = await tracePose(desk.page, id, async () => {
        await touch.pushStick(d, "left", 0, -1, 1500);
        await d.page.waitForTimeout(300);
        await touch.pushStick(d, "right", 1, 0, 800);
        await d.page.waitForTimeout(500);
      });
      r.before = before;
      r.movedAsSeenByDesk = movement(trace);
      r.ownAfter = await readPose(d.page, id);
      await shot(d, "after-joysticks");
      r.rotated = await touch.rotate(d, "landscape");
      await shot(d, "landscape");
      r.joysticksLandscape = await touch.joysticks(d);
      r.back = await touch.rotate(d, "portrait");
    } catch (e) {
      r.error = String(e).split("\n")[0];
      await shot(d, "error");
    }
  }
  await shot(desk, "observer");
} catch (e) {
  result.error = String(e);
} finally {
  result.errors = Object.fromEntries([desk, ...devices].map(c => [c.name, c.log.filter(e => ["error", "pageerror"].includes(e.type)).slice(0, 15).map(e => e.text.slice(0, 200))]));
  fs.writeFileSync(path.join(out, `devices-${which}.json`), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1).slice(0, 6000));
  for (const c of [...devices, desk]) await c.close();
}
