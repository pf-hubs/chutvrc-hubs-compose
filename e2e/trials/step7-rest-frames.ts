// Step 7 trial: why the new solver's height scale differs between loads of one model. After each load the
// observer's solver state is read (APP.world.eid2Ik -> ikState.frames, the rest frames readRestFrames took,
// and rig.eyeOffsetFromHead), with the chain from the root to the head: each object's name, whether the rig
// names it, its rest pose as recorded at load and its transform now.
//   npx tsx trials/step7-rest-frames.ts [avatar=rpm] [rounds=4]
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";
import { avatarUrl, type AvatarName } from "../assets/avatars";

const avatar = (process.argv[2] ?? "rpm") as AvatarName;
const rounds = Number(process.argv[3] ?? 4);
const OUT = path.join(EVIDENCE_DIR, "trials", "step7");
fs.mkdirSync(OUT, { recursive: true });
const out: any = { avatar, rounds: [] };
const hub = room("dialog-main").hubId;
const q = await launchClient({ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest", position: [0, 0] });
const o = await launchClient({ profile: "DESK", identity: "t5-new", slot: "c", name: "C-new", position: [640, 0] });
try {
  await Promise.all([enterRoom(q, hub, { displayName: "A-quest" }), enterRoom(o, hub, { displayName: "C-new" })]);
  await o.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: true } }));
  const idq = await q.page.evaluate(() => (window as any).__e2eApi.clientId());
  for (let i = 0; i < rounds; i++) {
    // Alternate with another model so every round loads the avatar afresh
    await q.page.evaluate(url => (window as any).APP.store.update({ profile: { avatarId: url } }), avatarUrl(i % 2 ? "vrm1" : avatar));
    for (let k = 0; k < 3; k++) {
      await q.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
      await q.page.waitForTimeout(2000);
    }
    const read = await o.page.evaluate(id => {
      const APP = (window as any).APP;
      const eid = APP.sfu.avatarSync.models.avatarEidByClientId.get(id);
      const ik = eid !== undefined ? APP.world.eid2Ik.get(eid) : null;
      if (!ik) return { noModel: true };
      const rig = ik.rig;
      const v = (p: any) => (p ? [p.x, p.y, p.z].map((n: number) => +n.toFixed(4)) : null);
      const names = new Map();
      for (const [n, b] of Object.entries(rig.bones)) if (b) names.set(b, n);
      const chain: any[] = [];
      for (let o: any = rig.bones.head; o; o = o.parent) {
        chain.unshift({ object: o.name, named: names.get(o) ?? null, restPos: names.get(o) && rig.rest[names.get(o)] ? v(rig.rest[names.get(o)].position) : null, pos: v(o.position), quat: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w].map((n: number) => +n.toFixed(4)), scale: v(o.scale) });
        if (o === rig.bones.root) break;
      }
      const frames = ik.ikState?.frames;
      return {
        avatarId: APP.sfu.avatarSync.models.avatarIdOf(id),
        source: rig.source,
        heightScale: ik.ikState?.calibration?.heightScale ?? null,
        headY: APP.avatarPoses.get(id)?.head.pos.y,
        eyeOffsetFromHead: v(rig.eyeOffsetFromHead),
        restFrames: frames ? Object.fromEntries(["root", "hips", "spine", "chest", "neck", "head", "leftEye", "leftFoot"].map(n => [n, frames[n] ? v(frames[n].position) : null])) : null,
        chain
      };
    }, idq);
    out.rounds.push({ round: i, ...read });
    console.log(JSON.stringify({ round: i, avatarId: read.avatarId, heightScale: read.heightScale, headY: read.headY, head: read.restFrames?.head, hips: read.restFrames?.hips, eye: read.eyeOffsetFromHead }));
  }
} catch (e) {
  out.error = String((e as Error).stack ?? e);
} finally {
  fs.writeFileSync(path.join(OUT, `step7-rest-frames-${avatar}.json`), JSON.stringify(out, null, 1));
  await q.close();
  await o.close();
}
