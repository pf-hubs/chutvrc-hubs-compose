// Step 7 trial: the headset's pose as an observer holds it while the headset enters VR, and the height
// scale the observer's new solver takes from it. The observer (new solver on) is in the room first and logs
// every frame from the moment the subject's pose appears; the subject (QUEST) then enters.
// The observer's data channel bus records the pose packets it receives, so what the headset sent can be told
// from what the observer's interpolation made of it.
//   npx tsx trials/step7-vr-entry.ts [rounds=3]
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";
import { avatarUrl } from "../assets/avatars";

const rounds = Number(process.argv[2] ?? 3);
const OUT = path.join(EVIDENCE_DIR, "trials", "step7");
fs.mkdirSync(OUT, { recursive: true });
const out: any = { rounds: [] };
const hub = room("dialog-main").hubId;
const o = await launchClient({ profile: "DESK", identity: "t5-new", slot: "c", name: "C-new", position: [640, 0] });
try {
  await enterRoom(o, hub, { displayName: "C-new" });
  await o.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: true } }));
  for (let round = 0; round < rounds; round++) {
    const q = await launchClient({ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest", position: [0, 0] });
    try {
    await o.page.evaluate(() => {
      const w = window as any;
      const own = w.APP.sfu.clientId;
      w.__entryLog = [];
      w.__entryRun = true;
      const raf = w.requestAnimationFrame.bind(w);
      w.__entryErrors = [];
      const frame = () => {
        if (!w.__entryRun) return;
        try { step(); } catch (e) { if (w.__entryErrors.length < 3) w.__entryErrors.push(String(e)); }
        raf(frame);
      };
      const step = () => {
        const APP = w.APP;
        for (const id of APP.avatarPoses.poses.keys()) {
          if (id === own) continue;
          const pose = APP.avatarPoses.get(id);
          const eid = APP.sfu.avatarSync.models.avatarEidByClientId.get(id);
          const ik = eid !== undefined ? APP.world.eid2Ik.get(eid) : undefined;
          w.__entryLog.push({ t: Math.round(performance.now()), id: id.slice(0, 8), headY: +pose.head.pos.y.toFixed(4), headZ: +pose.head.pos.z.toFixed(4), isVR: pose.isVR, seq: pose.seq, model: eid !== undefined, scale: ik?.ikState?.calibration?.heightScale ?? null });
        }
      };
      raf(frame);
    });
    // The observer's data channel bus records what it receives: the packets as the headset sent them
    await o.page.evaluate(() => {
      const bus = (window as any).APP.sfu.bus;
      bus.takeRecording();
      bus.startRecording();
    });
    await enterRoom(q, hub, { displayName: "A-quest", avatarUrl: avatarUrl("rpm") });
    await q.page.waitForTimeout(6000);
    const log: any[] = await o.page.evaluate(() => {
      const w = window as any;
      w.__entryRun = false;
      return w.__entryLog.concat(w.__entryErrors.map((e: string) => ({ error: e })));
    });
    const qid = (await q.page.evaluate(() => (window as any).__e2eApi.clientId())).slice(0, 8);
    const mine = log.filter(r => r.id === qid);
    const fullId = await q.page.evaluate(() => (window as any).__e2eApi.clientId());
    const packets: any[] = await o.page.evaluate(id => {
      const bus = (window as any).APP.sfu.bus;
      bus.stopRecording();
      return bus
        .takeRecording()
        .filter((e: any) => e.l === "#avatar-pose" && e.s === 0 && e.m?.c === id)
        .slice(0, 40)
        .map((e: any) => ({ t: e.t, seq: e.m.seq, vr: e.m.isVR, headY: +e.m.head.p.y.toFixed(4), headZ: +e.m.head.p.z.toFixed(4), tracked: e.m.tracked }));
    }, fullId);
    console.log(JSON.stringify({ firstPackets: packets.map(p => `${p.seq}:${p.headY}${p.vr ? "vr" : ""}`).join(" ") }));
    console.log(JSON.stringify({ logged: log.length, ids: [...new Set(log.map(r => r.id))], qid, errors: log.filter(r => r.error).map(r => r.error) }));
    const vrAt = mine.findIndex(r => r.isVR);
    const scaleAt = mine.findIndex(r => r.scale !== null);
    // Distinct head heights in order, with how long each lasted
    const runs: { headY: number; isVR: boolean; frames: number; model: boolean }[] = [];
    for (const r of mine) {
      const last = runs[runs.length - 1];
      if (last && last.headY === r.headY && last.isVR === r.isVR && last.model === r.model) last.frames++;
      else runs.push({ headY: r.headY, isVR: r.isVR, frames: 1, model: r.model });
    }
    const result = { round, frames: mine.length, firstVrFrame: vrAt, firstScaleFrame: scaleAt, scale: scaleAt >= 0 ? mine[scaleAt].scale : null, headAtScale: scaleAt >= 0 ? mine[scaleAt].headY : null, headRuns: runs.slice(0, 60) };
    out.rounds.push(result);
    console.log(JSON.stringify({ round, frames: mine.length, firstVrFrame: vrAt, firstScaleFrame: scaleAt, scale: result.scale, headAtScale: result.headAtScale, runs: runs.slice(0, 25).map(r => `${r.headY}${r.isVR ? "vr" : ""}${r.model ? "m" : ""}x${r.frames}`).join(" ") }));
    } finally {
      await q.close();
    }
    await o.page.waitForTimeout(3000);
  }
} catch (e) {
  out.error = String((e as Error).stack ?? e);
  console.log(out.error);
} finally {
  fs.writeFileSync(path.join(OUT, "step7-vr-entry.json"), JSON.stringify(out, null, 1));
  await o.close();
}
