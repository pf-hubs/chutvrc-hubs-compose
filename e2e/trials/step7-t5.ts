// Step 7 trial: what T5 needs from the emulated headset and the observers.
// - the offsets between IWER's device poses and what the client sends (head, controllers);
// - the thumbsticks (walk, snap turn) under IWER;
// - placing the subject and two observers, the light's direction, the observers' framing;
// - a CDP screencast on each observer next to Playwright's own video: frame rate and time stamps.
//   npx tsx trials/step7-t5.ts
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";
import { avatarUrl } from "../assets/avatars";
import { measureFrameRate } from "../probes/session";

const OUT = path.join(EVIDENCE_DIR, "trials", "step7");
fs.mkdirSync(OUT, { recursive: true });
const out: any = {};
const hub = room("dialog-main").hubId;
const q = await launchClient({ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest", position: [0, 0] });
const o1 = await launchClient({ profile: "DESK", identity: "obs-old", slot: "b", name: "B-old", position: [640, 0] });
const o2 = await launchClient({ profile: "DESK", identity: "obs-new", slot: "c", name: "C-new", position: [640, 360] });
const all = [q, o1, o2];
try {
  await Promise.all([
    enterRoom(q, hub, { displayName: "A-quest", avatarUrl: avatarUrl("rpm") }),
    enterRoom(o1, hub, { displayName: "B-old" }),
    enterRoom(o2, hub, { displayName: "C-new" })
  ]);
  const idq = await q.page.evaluate(() => (window as any).__e2eApi.clientId());
  out.idq = idq;
  for (const c of all) await c.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
  for (const o of [o1, o2])
    await o.page.waitForFunction(id => (window as any).APP.sfu.avatarSync.models.avatarEidByClientId.has(id), idq, { timeout: 30_000 }).catch(() => {});
  out.observersHaveModel = await Promise.all([o1, o2].map(o => o.page.evaluate(id => (window as any).APP.sfu.avatarSync.models.avatarEidByClientId.has(id), idq)));

  // The light
  out.light = await q.page.evaluate(() => {
    const T = (window as any).AFRAME.THREE;
    const found: any[] = [];
    (window as any).AFRAME.scenes[0].object3D.traverse((o: any) => {
      if (o.isDirectionalLight) {
        const a = new T.Vector3().setFromMatrixPosition(o.matrixWorld);
        const b = new T.Vector3().setFromMatrixPosition(o.target.matrixWorld);
        const d = b.sub(a).normalize();
        found.push({ name: o.name, dir: [d.x, d.y, d.z].map(v => +v.toFixed(3)), intensity: o.intensity });
      }
      if (o.isHemisphereLight || o.isAmbientLight) found.push({ name: o.name, type: o.type, intensity: o.intensity });
    });
    return found;
  });

  // Offsets: the headset and the controllers set to known poses, what the client's objects show
  out.offsets = await q.page.evaluate(async () => {
    const dev = (window as any).xrDevice;
    const T = (window as any).AFRAME.THREE;
    const results: any[] = [];
    const q = new T.Quaternion().setFromEuler(new T.Euler(0.3, 0.8, 0.2, "YXZ"));
    for (const [pos, quat] of [
      [[0, 1.6, 0], [0, 0, 0, 1]],
      [[0.1, 1.4, -0.2], [q.x, q.y, q.z, q.w]]
    ] as const) {
      dev.position.set(...pos);
      dev.quaternion.set(...quat);
      for (const side of ["left", "right"]) {
        dev.controllers[side].position.set(side === "left" ? -0.3 : 0.3, 1.1, -0.4);
        dev.controllers[side].quaternion.set(...quat);
      }
      await new Promise(r => setTimeout(r, 300));
      const read = (sel: string) => {
        const o = (document.querySelector(sel) as any).object3D;
        return { pos: [o.position.x, o.position.y, o.position.z].map((v: number) => +v.toFixed(4)), quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map((v: number) => +v.toFixed(4)) };
      };
      const local = (obj: any, devPos: number[], devQuat: number[]) => {
        const qi = new T.Quaternion(...devQuat).invert();
        const d = new T.Vector3(...obj.pos).sub(new T.Vector3(...devPos)).applyQuaternion(qi);
        const dq = qi.clone().multiply(new T.Quaternion(...obj.quat));
        return { offsetInDeviceFrame: [d.x, d.y, d.z].map(v => +v.toFixed(4)), turnDeg: +((2 * Math.acos(Math.min(1, Math.abs(dq.w))) * 180) / Math.PI).toFixed(2) };
      };
      const head = read("#avatar-pov-node");
      const left = read("#player-left-controller");
      const right = read("#player-right-controller");
      results.push({
        set: { pos, quat },
        head: { ...head, ...local(head, pos as any, quat as any) },
        left: { ...left, ...local(left, [-0.3, 1.1, -0.4], quat as any) },
        right: { ...right, ...local(right, [0.3, 1.1, -0.4], quat as any) }
      });
    }
    dev.position.set(0, 1.6, 0);
    dev.quaternion.set(0, 0, 0, 1);
    return results;
  });

  // Thumbsticks: left stick forward for 1 s, then right stick to the side for 0.3 s
  const rigNow = () => q.page.evaluate(() => {
    const o = (document.querySelector("#avatar-rig") as any).object3D;
    return { pos: [o.position.x, o.position.y, o.position.z].map((v: number) => +v.toFixed(3)), yawDeg: +((o.rotation.y * 180) / Math.PI).toFixed(1) };
  });
  out.stick = { before: await rigNow() };
  await q.page.evaluate(() => (window as any).xrDevice.controllers.left.updateAxes("thumbstick", 0, -1));
  await q.page.waitForTimeout(1000);
  await q.page.evaluate(() => (window as any).xrDevice.controllers.left.updateAxes("thumbstick", 0, 0));
  out.stick.afterLeftForward = await rigNow();
  await q.page.evaluate(() => (window as any).xrDevice.controllers.right.updateAxes("thumbstick", -1, 0));
  await q.page.waitForTimeout(300);
  await q.page.evaluate(() => (window as any).xrDevice.controllers.right.updateAxes("thumbstick", 0, 0));
  await q.page.waitForTimeout(500);
  out.stick.afterRightLeft = await rigNow();
  out.animStates = await o1.page.evaluate(id => (window as any).APP.avatarPoses.get(id)?.animState, idq);

  // Place the subject at the centre facing -z and the observers in front of it
  await q.page.evaluate(() => {
    const o = (document.querySelector("#avatar-rig") as any).object3D;
    o.position.set(0, o.position.y, 0);
    o.rotation.set(0, 0, 0);
    o.matrixNeedsUpdate = true;
  });
  const place = (page: any, x: number, z: number, yaw: number, pitch: number) =>
    page.evaluate(({ x, z, yaw, pitch }: any) => {
      const rig = (document.querySelector("#avatar-rig") as any).object3D;
      rig.position.set(x, rig.position.y, z);
      rig.rotation.set(0, yaw, 0);
      rig.matrixNeedsUpdate = true;
      const pov = (document.querySelector("#avatar-pov-node") as any).object3D;
      pov.rotation.set(pitch, 0, 0);
      pov.matrixNeedsUpdate = true;
    }, { x, z, yaw, pitch });
  // In front of the subject (-z), 35 degrees to its right, 2.3 m away, looking at it
  const d = 2.3;
  const az = (-35 * Math.PI) / 180;
  const ox = -d * Math.sin(-az);
  const oz = -d * Math.cos(az);
  const yaw = Math.atan2(-(0 - ox), -(0 - oz));
  const pitch = -Math.atan((1.6 - 0.95) / d);
  out.observerPlace = { ox, oz, yawDeg: (yaw * 180) / Math.PI, pitchDeg: (pitch * 180) / Math.PI };
  for (const o of [o1, o2]) await place(o.page, ox, oz, yaw, pitch);
  await o2.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: true } }));
  await o1.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: false } }));
  // Hide the other observer's model and the own one on each observer (they stand at the same spot)
  const ids = await Promise.all(all.map(c => c.page.evaluate(() => (window as any).__e2eApi.clientId())));
  for (const o of [o1, o2])
    out[`hidden-${o.name}`] = await o.page.evaluate(({ keep }) => {
      const APP = (window as any).APP;
      const hidden: string[] = [];
      for (const [id, eid] of APP.sfu.avatarSync.models.avatarEidByClientId) {
        if (id === keep) continue;
        const model = APP.world.eid2obj.get(eid);
        if (model) {
          model.scale.setScalar(1e-4);
          model.matrixNeedsUpdate = true;
          model.updateMatrix?.();
          hidden.push(id);
        }
      }
      return hidden;
    }, { keep: idq });
  await q.page.waitForTimeout(1500);
  out.fps = { q: await measureFrameRate(q.page), o1: await measureFrameRate(o1.page), o2: await measureFrameRate(o2.page) };

  // Screencast on both observers while the headset raises both hands
  const casts = await Promise.all(
    [o1, o2].map(async o => {
      const cdp = await o.context.newCDPSession(o.page);
      const frames: { ts: number; bytes: number; data?: string }[] = [];
      cdp.on("Page.screencastFrame", async (f: any) => {
        frames.push({ ts: f.metadata.timestamp, bytes: f.data.length, data: frames.length % 20 === 0 ? f.data : undefined });
        await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 1280, maxHeight: 720, everyNthFrame: 1 });
      return { o, cdp, frames };
    })
  );
  const t0 = Date.now();
  await q.page.evaluate(async () => {
    const dev = (window as any).xrDevice;
    const start = performance.now();
    await new Promise<void>(resolve => {
      const step = () => {
        const s = (performance.now() - start) / 1000;
        const f = Math.min(1, s / 2);
        dev.controllers.left.position.set(-0.3, 1.1 + 0.9 * f, -0.4 + 0.2 * f);
        dev.controllers.right.position.set(0.3, 1.1 + 0.4 * f, -0.4 - 0.25 * f);
        if (s < 4) (window as any).__e2eNativeRaf(step);
        else resolve();
      };
      (window as any).__e2eNativeRaf(step);
    });
  });
  const seconds = (Date.now() - t0) / 1000;
  out.fpsDuringCast = { o1: await measureFrameRate(o1.page), o2: await measureFrameRate(o2.page), q: await measureFrameRate(q.page) };
  for (const c of casts) {
    await c.cdp.send("Page.stopScreencast").catch(() => {});
    const ts = c.frames.map(f => f.ts);
    out[`cast-${c.o.name}`] = { frames: c.frames.length, perSecond: +(c.frames.length / seconds).toFixed(1), first: ts[0], last: ts[ts.length - 1], meanBytes: Math.round(c.frames.reduce((a, f) => a + f.bytes, 0) / c.frames.length) };
    c.frames.filter(f => f.data).slice(0, 4).forEach((f, i) => fs.writeFileSync(path.join(OUT, `cast-${c.o.name}-${i}.jpg`), Buffer.from(f.data!, "base64")));
  }
  out.pcNowVsCastTs = { pcMs: Date.now(), lastCast: casts[0].frames.at(-1)?.ts };
  for (const c of all) await c.page.screenshot({ path: path.join(OUT, `shot-${c.name}.png`) });
  out.poseAtObserver = await o1.page.evaluate(id => {
    const p = (window as any).APP.avatarPoses.get(id);
    return p && { isVR: p.isVR, tracked: p.tracked, head: p.head.pos, left: p.leftHand.pos, right: p.rightHand.pos, rig: p.rig.pos };
  }, idq);
} catch (e) {
  out.error = String((e as Error).stack ?? e);
} finally {
  fs.writeFileSync(path.join(OUT, "step7-t5.json"), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  for (const c of all) await c.close();
}
