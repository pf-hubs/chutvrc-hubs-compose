// Throwaway check for the fix of the bot path: one DESK observer and two bots in the Dialog room; whether each
// bot's pose advances and moves on the observer, and whether the observer loaded a model for it
import fs from "node:fs";
import { launchClients } from "../clients/launch";
import { launchBot, waitBotEntered } from "../clients/bot";
import { enterRoom } from "../clients/enter";
import { readPose } from "../probes/poses";
import { readPeers, readSession } from "../probes/session";
import { room } from "../lib/fixtures";

(async () => {
  const hub = room("dialog-main");
  const out: any = { hub: hub.hubId, at: new Date().toISOString() };
  const [a] = await launchClients([{ profile: "DESK", identity: "trialobs", slot: "a", name: "A-observer" }]);
  const bots: Awaited<ReturnType<typeof launchBot>>[] = [];
  try {
    await enterRoom(a, hub.hubId, { displayName: "A-observer" });
    bots.push(await launchBot({ hubId: hub.hubId, slot: "e" }), await launchBot({ hubId: hub.hubId, slot: "f" }));
    await Promise.all(bots.map(b => waitBotEntered(b, 240_000)));
    const ids = await Promise.all(bots.map(async b => (await readSession(b.page)).clientId));
    await a.page.waitForTimeout(8000);
    const first = await Promise.all(ids.map(id => readPose(a.page, id)));
    await a.page.waitForTimeout(20_000);
    const last = await Promise.all(ids.map(id => readPose(a.page, id)));
    const peers = await readPeers(a.page);
    out.bots = ids.map((id, i) => {
      const p0: any = first[i], p1: any = last[i];
      const d = p0 && p1 ? Math.hypot(p1.rig[0] - p0.rig[0], p1.rig[2] - p0.rig[2]) : null;
      const yaw = p0 && p1 ? Math.abs((p1.rigYaw ?? 0) - (p0.rigYaw ?? 0)) : null;
      const head = p0 && p1 ? Math.hypot(...[0, 1, 2].map(k => (p1.head?.[k] ?? 0) - (p0.head?.[k] ?? 0))) : null;
      return { name: bots[i].name, id, model: peers.models.includes(id), seqFrom: p0?.seq ?? null, seqTo: p1?.seq ?? null, rigMovedM: d, yawChange: yaw, headMovedM: head, headPitch: [p0?.headPitch, p1?.headPitch], p0, p1 };
    });
    out.botErrors = bots.map(b => ({ name: b.name, enabled: b.log.filter(e => /reading 'enabled'/.test(e.text)).length, invalidState: b.log.filter(e => /InvalidStateError/.test(e.text)).length, minutes: null }));
    await a.page.screenshot({ path: process.argv[2] + "/A-observer.png" });
  } catch (e) {
    out.error = String(e);
  } finally {
    fs.writeFileSync(process.argv[2] + "/bot-motion.json", JSON.stringify(out, null, 2));
    for (const c of [...bots, a]) await c.close().catch(() => {});
  }
  console.log(JSON.stringify({ error: out.error, bots: out.bots?.map((b: any) => ({ ...b, p0: undefined, p1: undefined })), botErrors: out.botErrors }, null, 1));
  process.exit(0);
})();
