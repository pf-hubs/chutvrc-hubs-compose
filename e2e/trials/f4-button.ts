// Throwaway look at the in-VR "Capture height again" button under the emulated headset: when it shows,
// where it is against "invite", its label and colour, and how the right controller's ray has to point to
// hover it.
import fs from "node:fs";
import path from "node:path";
import { launchClients } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { playTimeline, REST, yawPitchRoll, type Keyframe, type Timeline } from "../clients/motion";
import { room } from "../lib/fixtures";

const out: any = { at: new Date().toISOString() };
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });
const hold = (parts: Partial<Keyframe>, ms: number): Timeline => ({ name: "hold", keyframes: [{ ...REST, ...parts, t: 0 }, { ...REST, ...parts, t: ms }] });

(async () => {
  const [q] = await launchClients([{ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest" }]);
  const button = () =>
    q.page.evaluate(() => {
      const T = (window as any).AFRAME.THREE;
      const el = document.querySelector("[body-capture-button]") as any;
      const inv = document.querySelector(".invite-btn") as any;
      const w = (o: any) => { const v = new T.Vector3(); o.updateMatrixWorld(true); o.getWorldPosition(v); return [v.x, v.y, v.z].map((n: number) => +n.toFixed(3)); };
      const panel = el.components["body-capture-button"].panel;
      const hud = document.querySelector("[in-world-hud]") as any;
      let shown = true;
      for (let o = el.object3D; o; o = o.parent) if (!o.visible) shown = false;
      const chain = [];
      for (let o = el.object3D; o; o = o.parent) chain.push(`${(o.el && (o.el.id || o.el.className || Object.keys(o.el.components || {}).slice(0, 3).join("+"))) || o.type}:${o.visible ? 1 : 0}`);
      const cam = (window as any).AFRAME.scenes[0].camera;
      return { visible: el.object3D.visible, shown, chain: chain.join(" < "), text: panel.text, background: panel.background, pos: w(el.object3D), invite: w(inv.object3D), hudVisible: hud.object3D.visible, camPitch: +(((document.querySelector("#viewing-camera") as any)?.object3D.rotation.x ?? 0) * 57.3).toFixed(1) };
    });
  try {
    await q.page.goto(q.roomUrl(room("dialog-main").hubId), { waitUntil: "domcontentloaded", timeout: 120_000 });
    await q.page.waitForFunction(() => !!(window as any).APP?.store, undefined, { timeout: 120_000 });
    await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { locale: "en" } }));
    await enterRoom(q, room("dialog-main").hubId, {
      displayName: "A-quest",
      preferences: { avatarIkV2: true, locale: "en" },
      calibration: { via: "seed", heightCm: 173, posture: "standing", fit: "avatarToPlayer" },
      beforeEnter: page => playTimeline(page, hold({}, 200))
    });
    const samples = [];
    for (let i = 0; i < 25; i++) { samples.push({ t: i * 100, ...(await button()) }); await q.page.waitForTimeout(100); }
    out.afterEntry = samples.map(s => `${s.t}:${s.visible ? "V" : "-"}`).join(" ");
    out.after = await button();
    // Look up 35°
    for (const pitch of [35, -30]) {
      await playTimeline(q.page, hold({ head: { pos: [0, 1.6, 0], quat: yawPitchRoll(0, pitch) } }, 1500));
      out["look" + pitch] = await button();
      await q.page.screenshot({ path: path.join(dir, `button-pitch${pitch}.png`) });
    }
    // Aim: try a grid of right-controller orientations from where it is, looking up
    await playTimeline(q.page, hold({ head: { pos: [0, 1.6, 0], quat: yawPitchRoll(0, 35) } }, 800));
    const ctrl = await q.page.evaluate(() => { const T = (window as any).AFRAME.THREE; const v = new T.Vector3(); (document.querySelector("#player-right-controller") as any).object3D.getWorldPosition(v); return [v.x, v.y, v.z]; });
    const b = (await button()).pos;
    const d = [b[0] - ctrl[0], b[1] - ctrl[1], b[2] - ctrl[2]];
    const yaw0 = (Math.atan2(-d[0], -d[2]) * 180) / Math.PI, pitch0 = (Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180) / Math.PI;
    out.aim0 = { ctrl, b, yaw0, pitch0 };
    const found = [];
    for (const dp of [0, -5, 5, -10, 10, -15, 15, -20]) for (const dyaw of [0, -4, 4]) {
      await playTimeline(q.page, hold({ head: { pos: [0, 1.6, 0], quat: yawPitchRoll(0, 35) }, right: { ...REST.right, quat: yawPitchRoll(yaw0 + dyaw, pitch0 + dp) } }, 250));
      const s = await button();
      const hovered = await q.page.evaluate(() => { const el = document.querySelector("[body-capture-button]") as any; return el.components["body-capture-button"].panel.background; });
      if (/255, 52, 116/.test(hovered)) found.push({ dp, dyaw });
      if (found.length) break;
    }
    out.found = found;
    await q.page.screenshot({ path: path.join(dir, "button-hover.png") });
  } catch (e) {
    out.error = String((e as Error).stack ?? e);
  } finally {
    console.log(JSON.stringify(out, null, 1));
    await q.close().catch(() => {});
  }
  process.exit(0);
})();
