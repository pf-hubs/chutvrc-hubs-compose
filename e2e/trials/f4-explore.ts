// Throwaway look at the body calibration under the emulated headset: a QUEST client with the new solver
// fills the calibration form, one DESK observer with the new solver; what the capture took, what is
// announced, the observer's ratio and root scale, the own camera's height; then sitting with the headset
// at 1.15 m (does IWER honour the offset reference space?) and "Fit me to the avatar".
import fs from "node:fs";
import path from "node:path";
import { launchClients } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { playTimeline, REST, type Timeline } from "../clients/motion";
import { avatarUrl } from "../assets/avatars";
import { readSession } from "../probes/session";
import { room } from "../lib/fixtures";

const out: any = { at: new Date().toISOString() };
const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });

const shifted = (dy: number) => ({
  head: { ...REST.head, pos: [REST.head.pos[0], REST.head.pos[1] + dy, REST.head.pos[2]] as [number, number, number] },
  left: { ...REST.left, pos: [REST.left.pos[0], REST.left.pos[1] + dy, REST.left.pos[2]] as [number, number, number] },
  right: { ...REST.right, pos: [REST.right.pos[0], REST.right.pos[1] + dy, REST.right.pos[2]] as [number, number, number] }
});
const holdAt = (dy: number, ms: number): Timeline => ({ name: "hold", keyframes: [{ ...shifted(dy), t: 0 }, { ...shifted(dy), t: ms }] });

(async () => {
  const hub = room("dialog-main");
  const [q, o] = await launchClients([
    { profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest" },
    { profile: "DESK", identity: "t5-new", slot: "c", name: "C-new" }
  ]);
  const state = async (label: string) => {
    const qid = (await readSession(q.page)).clientId;
    const s = {
      label,
      own: await q.page.evaluate(() => {
        const APP = (window as any).APP;
        const T = (window as any).AFRAME.THREE;
        const rig = (document.querySelector("#avatar-rig") as any).object3D;
        const pov = (document.querySelector("#avatar-pov-node") as any).object3D;
        const cam = (window as any).AFRAME.scenes[0].camera;
        const w = new T.Vector3();
        pov.getWorldPosition(w);
        const cw = new T.Vector3();
        cam.getWorldPosition(cw);
        const pose = APP.avatarPoses.get(APP.sfu.clientId);
        const xr = (window as any).AFRAME.scenes[0].renderer.xr;
        const ui = (window as any).AFRAME.scenes[0].systems.userinput;
        return {
          rigY: rig.position.y,
          rigScale: rig.scale.y,
          povWorldY: w.y,
          camWorldY: cw.y,
          sentHeadY: pose?.head.pos.y,
          sentRightY: pose?.rightHand.pos.y,
          announced: APP.avatarPoses.announcedEyeHeightOf(APP.sfu.clientId),
          device: (window as any).xrDevice.position.y,
          prefs: (({ avatarIkV2, bodyHeightCm, bodyPosture, bodyFit }) => ({ avatarIkV2, bodyHeightCm, bodyPosture, bodyFit }))(APP.store.state.preferences),
          refSpaceSameAsUi: xr.getReferenceSpace() === ui.xrReferenceSpace,
          refSpaceCtor: xr.getReferenceSpace()?.constructor?.name
        };
      }),
      observer: await o.page.evaluate(id => {
        const APP = (window as any).APP;
        const eid = APP.sfu.avatarSync.models.avatarEidByClientId.get(id);
        const ik = eid === undefined ? null : APP.world.eid2Ik.get(eid);
        return {
          eid,
          announced: APP.avatarPoses.announcedEyeHeightOf(id),
          modelRatio: ik?.ikState?.modelRatio,
          solver: ik?.ikState?.solver,
          rootScale: ik?.rig?.bones?.root?.scale?.y,
          modelEye: ik?.modelEyeHeight?.(),
          headY: APP.avatarPoses.get(id)?.head.pos.y
        };
      }, qid),
      logs: q.log.filter(e => /Body calibration/.test(e.text)).map(e => e.text.slice(0, 300))
    };
    console.log(JSON.stringify(s));
    (out.states ??= []).push(s);
    return s;
  };
  try {
    await enterRoom(o, hub.hubId, { displayName: "C-new", preferences: { avatarIkV2: true } });
    const t = await enterRoom(q, hub.hubId, {
      displayName: "A-quest",
      avatarUrl: avatarUrl("rpm"),
      preferences: { avatarIkV2: true, bodyHeightCm: 0 },
      calibration: { via: "form", heightCm: 173, posture: "standing", fit: "avatarToPlayer" }
    });
    out.entry = t;
    await q.page.screenshot({ path: path.join(dir, "quest-just-entered.png") });
    await q.page.waitForTimeout(2500);
    await q.page.screenshot({ path: path.join(dir, "quest-after-capture.png") });
    await state("standing, avatarToPlayer");
    await o.page.waitForTimeout(4000);
    await state("standing, avatarToPlayer, later");
    // Sitting: headset at 1.15 m
    await playTimeline(q.page, holdAt(1.15 - 1.6, 300));
    await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyPosture: "sitting" } }));
    await playTimeline(q.page, holdAt(1.15 - 1.6, 3000));
    await state("sitting, avatarToPlayer, headset 1.15");
    await q.page.screenshot({ path: path.join(dir, "quest-sitting.png") });
    await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyFit: "playerToAvatar" } }));
    await playTimeline(q.page, holdAt(1.15 - 1.6, 2000));
    await state("sitting, playerToAvatar, headset 1.15");
    await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyPosture: "standing" } }));
    await playTimeline(q.page, holdAt(0, 3000));
    await state("standing, playerToAvatar");
    await q.page.evaluate(() => (window as any).APP.store.update({ preferences: { bodyFit: "avatarToPlayer" } }));
    await playTimeline(q.page, holdAt(0, 1500));
    await state("standing, avatarToPlayer again");
  } catch (e) {
    out.error = String((e as Error).stack ?? e);
    console.log(out.error);
  } finally {
    out.questLog = q.log.filter(e => /calibration|error/i.test(e.text)).map(e => `${e.type} ${e.text.slice(0, 300)}`).slice(0, 80);
    fs.writeFileSync(path.join(dir, "f4-explore.json"), JSON.stringify(out, null, 2));
    for (const c of [q, o]) await c.close().catch(() => {});
  }
  process.exit(0);
})();
