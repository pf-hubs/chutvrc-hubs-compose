// Step 7 trial: which headset height the new body solver calibrates a remote avatar with. An observer with the
// new solver on logs, every frame, the subject's pose as it holds it (head height, isVR, sequence) and the
// height scale of the avatar's solver (APP.world.eid2Ik -> ikState.calibration) from before the model is
// loaded; the subject (QUEST, standing still) then changes avatar a few times, each change a new solver.
//   npx tsx trials/step7-calibration.ts
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";
import { avatarUrl } from "../assets/avatars";

const OUT = path.join(EVIDENCE_DIR, "trials", "step7");
fs.mkdirSync(OUT, { recursive: true });
const out: any = { rounds: [] };
const hub = room("dialog-main").hubId;
const q = await launchClient({ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest", position: [0, 0] });
const o = await launchClient({ profile: "DESK", identity: "t5-new", slot: "c", name: "C-new", position: [640, 0] });
try {
  await Promise.all([enterRoom(q, hub, { displayName: "A-quest", avatarUrl: avatarUrl("rpm") }), enterRoom(o, hub, { displayName: "C-new" })]);
  await o.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: true } }));
  const idq = await q.page.evaluate(() => (window as any).__e2eApi.clientId());
  // The log: one row per frame while the subject's solver has no height scale yet, then a few more
  await o.page.evaluate(id => {
    const w = window as any;
    w.__calLog = [];
    let after = 0;
    const raf = w.requestAnimationFrame.bind(w);
    const frame = () => {
      const APP = w.APP;
      const pose = APP.avatarPoses?.get(id);
      const eid = APP.sfu?.avatarSync?.models?.avatarEidByClientId?.get(id);
      const ik = eid !== undefined ? APP.world.eid2Ik.get(eid) : undefined;
      const scale = ik?.ikState?.calibration?.heightScale ?? null;
      const row = { t: performance.now(), eid: eid ?? null, headY: pose ? +pose.head.pos.y.toFixed(4) : null, isVR: pose?.isVR ?? null, seq: pose?.seq ?? null, scale, hasState: !!ik?.ikState };
      const last = w.__calLog[w.__calLog.length - 1];
      if (scale === null || !last || last.scale === null || last.eid !== row.eid) after = 0;
      if (after < 5) w.__calLog.push(row);
      if (scale !== null) after++;
      raf(frame);
    };
    raf(frame);
  }, idq);
  for (const [i, avatar] of (["rpm", "vrm1", "rpm", "vrm0", "rpm"] as const).entries()) {
    if (i > 0) await q.page.evaluate(url => (window as any).APP.store.update({ profile: { avatarId: url } }), avatarUrl(avatar));
    for (let k = 0; k < 4; k++) {
      await q.page.evaluate(() => (window as any).__e2eApi.announceAvatar());
      await q.page.waitForTimeout(2000);
    }
    const log: any[] = await o.page.evaluate(() => (window as any).__calLog.splice(0));
    const firstSet = log.findIndex(r => r.scale !== null);
    out.rounds.push({
      avatar,
      frames: log.length,
      firstSet: firstSet >= 0 ? log.slice(Math.max(0, firstSet - 6), firstSet + 3) : null,
      scale: firstSet >= 0 ? log[firstSet].scale : null,
      headYRange: [Math.min(...log.filter(r => r.headY !== null).map(r => r.headY)), Math.max(...log.filter(r => r.headY !== null).map(r => r.headY))]
    });
    console.log(JSON.stringify(out.rounds.at(-1)));
  }
} catch (e) {
  out.error = String((e as Error).stack ?? e);
} finally {
  fs.writeFileSync(path.join(OUT, "step7-calibration.json"), JSON.stringify(out, null, 1));
  await q.close();
  await o.close();
}
