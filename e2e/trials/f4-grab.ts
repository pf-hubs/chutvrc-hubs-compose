// Throwaway look at "Fit me to the avatar" under the emulated headset: walking for 3 s with the thumbstick
// at both fits, whether an object put where the scaled controller reaches can be grabbed with the grip, and
// whether Preferences can be opened on the page while it presents.
import fs from "node:fs";
import path from "node:path";
import { launchClients } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import * as input from "../clients/input";
import { playTimeline, REST, type Timeline, type Keyframe } from "../clients/motion";
import { placeRig } from "../clients/stage";
import { avatarUrl } from "../assets/avatars";
import { MODEL_URL } from "../assets/generate";
import { readSession } from "../probes/session";
import { ownView } from "../probes/calibration";
import { room } from "../lib/fixtures";
import { ensureSignedIn } from "../clients/signin";

const out: any = { at: new Date().toISOString() };
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const hold = (parts: Partial<Keyframe>, ms: number): Timeline => ({ name: "hold", keyframes: [{ ...REST, ...parts, t: 0 }, { ...REST, ...parts, t: ms }] });
const at = (p: [number, number, number]) => ({ ...REST.right, pos: p });

(async () => {
  const hub = room("dialog-main");
  const [q, o] = await launchClients([
    { profile: "QUEST", identity: "quest-admin", slot: "a", name: "A-quest" },
    { profile: "DESK", identity: "admin", slot: "c", name: "C-new" }
  ]);
  const rigPos = () => q.page.evaluate(() => { const r = (document.querySelector("#avatar-rig") as any).object3D; return [r.position.x, r.position.z]; });
  try {
    await ensureSignedIn(o, "admin");
    await ensureSignedIn(q, "admin");
    await enterRoom(o, hub.hubId, { displayName: "C-new", preferences: { avatarIkV2: true } });
    await enterRoom(q, hub.hubId, {
      displayName: "A-quest",
      avatarUrl: avatarUrl("vrm0"),
      preferences: { avatarIkV2: true },
      calibration: { via: "seed", heightCm: 173, posture: "standing", fit: "playerToAvatar" },
      beforeEnter: page => playTimeline(page, hold({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] } }, 200))
    });
    await playTimeline(q.page, hold({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] } }, 2000));
    out.own = await ownView(q.page);
    console.log(JSON.stringify(out.own));
    // Walk 3 s at each fit
    out.walk = {};
    for (const fit of [] as string[]) {
      await q.page.evaluate(f => (window as any).APP.store.update({ preferences: { bodyFit: f } }), fit);
      await playTimeline(q.page, hold({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] } }, 1500));
      await placeRig(q.page, 0, 0, 0);
      await q.page.waitForTimeout(300);
      const a = await rigPos();
      const scale = (await ownView(q.page)).rigScale;
      await playTimeline(q.page, { name: "walk", keyframes: [{ ...REST, left: { ...REST.left, stick: [0, -1] }, t: 0 }, { ...REST, left: { ...REST.left, stick: [0, -1] }, t: 3000 }, { ...REST, t: 3001 }] });
      await q.page.waitForTimeout(800);
      const b = await rigPos();
      out.walk[fit + "-" + Object.keys(out.walk).length] = { scale, metres: Math.hypot(b[0] - a[0], b[1] - a[1]) };
      console.log(fit, scale, Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    await placeRig(q.page, 0, 0, 0);
    // Place the duck from the observer, then move it to where the subject's right controller reaches
    await placeRig(o.page, 0, 2.5, 180);
    await input.placeFromUrl(o.page, MODEL_URL);
    await o.page.waitForTimeout(6000);
    const reach: [number, number, number] = [0.19, 1.35, -0.6];
    await playTimeline(q.page, hold({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: at(reach) }, 1000));
    const ctrl = await q.page.evaluate(() => {
      const T = (window as any).AFRAME.THREE;
      const o3 = (document.querySelector("#player-right-controller") as any).object3D;
      const w = new T.Vector3();
      o3.getWorldPosition(w);
      return [w.x, w.y, w.z];
    });
    out.controllerWorld = ctrl;
    const FIND = input.FIND_MEDIA_CODE;
    out.moved = await o.page.evaluate(({ finder, src, p }) => {
      const el = new Function("arg", finder)({ src });
      if (!el) return "no object";
      el.object3D.position.set(p[0], p[1], p[2]);
      el.object3D.matrixNeedsUpdate = true;
      return "moved";
    }, { finder: FIND, src: MODEL_URL, p: ctrl });
    await q.page.waitForTimeout(2000);
    const objOn = (page: typeof q.page) => page.evaluate(({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      if (!el) return null;
      const T = (window as any).AFRAME.THREE;
      const w = new T.Vector3();
      el.object3D.updateMatrixWorld(true);
      w.setFromMatrixPosition(el.object3D.matrixWorld);
      return [w.x, w.y, w.z].map(v => +v.toFixed(3));
    }, { finder: FIND, src: MODEL_URL });
    out.objBefore = { subject: await objOn(q.page), observer: await objOn(o.page) };
    out.debug = await q.page.evaluate(({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      const scene = (window as any).AFRAME.scenes[0];
      const ps = scene.systems["hubs-systems"].physicsSystem;
      const hand = document.getElementById("player-right-controller") as any;
      const T = (window as any).AFRAME.THREE;
      const hw = new T.Vector3(); hand.object3D.getWorldPosition(hw);
      const hs = new T.Vector3(); hand.object3D.getWorldScale(hs);
      const ow = new T.Vector3(); el.object3D.getWorldPosition(ow);
      const box = new T.Box3().setFromObject(el.object3D);
      const bh = hand.components["body-helper"];
      return {
        handWorld: [hw.x, hw.y, hw.z], handScale: hs.y, objWorld: [ow.x, ow.y, ow.z],
        objBox: [box.min.toArray(), box.max.toArray()],
        handBody: bh ? { uuid: bh.uuid, data: bh.data && { type: bh.data.type } } : null,
        collisions: bh && bh.uuid !== undefined ? (ps.getCollisions(bh.uuid) || []).length : null,
        objComponents: Object.keys(el.components),
        interaction: (() => { const s = scene.systems.interaction.state; return { hand: !!s.rightHand.held, hovered: !!s.rightHand.hovered, remoteHovered: !!s.rightRemote.hovered }; })()
      };
    }, { finder: FIND, src: MODEL_URL });
    console.log(JSON.stringify(out.debug));
    await q.page.screenshot({ path: path.join(dir, "reach.png") });
    // Grip and lift 30 cm
    await playTimeline(q.page, { name: "grab", keyframes: [
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 1 } }, t: 0 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 1 } }, t: 500 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at([reach[0], reach[1] + 0.3, reach[2]]), buttons: { squeeze: 1 } }, t: 1500 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at([reach[0], reach[1] + 0.3, reach[2]]), buttons: { squeeze: 1 } }, t: 2000 }
    ] });
    await playTimeline(q.page, { name: "squeeze", keyframes: [
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 0 } }, t: 0 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 0 } }, t: 300 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 1 } }, t: 400 },
      { ...REST, head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at(reach), buttons: { squeeze: 1 } }, t: 1200 }
    ] });
    out.gamepad = await q.page.evaluate(() => {
      const xr = (window as any).AFRAME.scenes[0].renderer.xr;
      const session = xr.getSession();
      const srcs = [...session.inputSources].map((s: any) => ({ hand: s.handedness, profiles: s.profiles, buttons: s.gamepad ? [...s.gamepad.buttons].map((b: any) => [b.value, b.pressed]) : null }));
      const ui = (window as any).AFRAME.scenes[0].systems.userinput;
      const s = (window as any).AFRAME.scenes[0].systems.interaction.state;
      return { srcs, devices: String(ui.activeDevices && (ui.activeDevices.size ?? ui.activeDevices.length)), held: !!s.rightHand.held, hovered: !!s.rightHand.hovered };
    });
    console.log("GAMEPAD", JSON.stringify(out.gamepad));
    out.held = await q.page.evaluate(() => { const s = (window as any).AFRAME.scenes[0].systems.interaction.state; return { hand: !!s.rightHand.held, remote: !!s.rightRemote.held, hovered: !!s.rightHand.hovered }; });
    await playTimeline(q.page, hold({ head: { pos: [0, 1.62, 0], quat: [0, 0, 0, 1] }, right: { ...at([reach[0], reach[1] + 0.3, reach[2]]), buttons: { squeeze: 0 } } }, 500));
    await q.page.waitForTimeout(1500);
    out.objAfter = { subject: await objOn(q.page), observer: await objOn(o.page) };
    // Preferences while presenting
    out.prefs = await input.choosePopoverItem(q.page, "More", "Preferences").then(() => "opened").catch(e => String(e).slice(0, 200));
    await q.page.screenshot({ path: path.join(dir, "prefs-in-vr.png") });
  } catch (e) {
    out.error = String((e as Error).stack ?? e);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    fs.writeFileSync(path.join(dir, "f4-grab.json"), JSON.stringify(out, null, 2));
    for (const c of [q, o]) await c.close().catch(() => {});
  }
  process.exit(0);
})();
