import { launchClients } from "../clients/launch";
const t0 = Date.now();
const cs = await launchClients([
  { profile: "DESK", identity: "admin", slot: "a" },
  { profile: "DESK", identity: "member1", slot: "b" },
  { profile: "QUEST", identity: "quest1", slot: "d" },
  { profile: "QUEST", identity: "quest2", slot: "e" }
]);
console.log("launched 4 in", Date.now() - t0, "ms");
for (const c of cs) await c.close();
