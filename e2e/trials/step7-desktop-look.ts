// Step 7 trial: the DESK subject of T5. Does the O key switch the camera behind the avatar with ?thirdPerson,
// and does a mouse drag turn the head the client sends? Reads the camera system's mode, the pov node's
// turn and the own pose's head yaw before and after each step.
//   npx tsx trials/step7-desktop-look.ts [query=?thirdPerson]
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import * as input from "../clients/input";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";

const query = process.argv[2] ?? "?thirdPerson";
const OUT = path.join(EVIDENCE_DIR, "trials", "step7");
fs.mkdirSync(OUT, { recursive: true });
const out: any = { query, steps: [] };
const c = await launchClient({ profile: "DESK", identity: "t5-subject", slot: "a", name: "A-desk", position: [0, 0] });
const read = (label: string) =>
  c.page.evaluate(label => {
    const scene = (window as any).AFRAME.scenes[0];
    const cam = scene.systems["hubs-systems"].cameraSystem;
    const pov = (document.querySelector("#avatar-pov-node") as any).object3D;
    const rig = (document.querySelector("#avatar-rig") as any).object3D;
    const APP = (window as any).APP;
    const pose = APP.avatarPoses.get(APP.sfu.clientId);
    const deg = (r: number) => +((r * 180) / Math.PI).toFixed(1);
    return { label, mode: cam.mode, povYaw: deg(pov.rotation.y), povPitch: deg(pov.rotation.x), rigYaw: deg(rig.rotation.y), poseHeadYaw: pose ? deg(pose.head.rot.y) : null, poseHeadPitch: pose ? deg(pose.head.rot.x) : null, focus: document.activeElement?.tagName };
  }, label);
try {
  await enterRoom(c, room("dialog-main").hubId, { displayName: "A-desk", query });
  out.steps.push(await read("entered"));
  await input.holdKey(c.page, "o", 120);
  await c.page.waitForTimeout(500);
  out.steps.push(await read("after O"));
  await c.page.screenshot({ path: path.join(OUT, `desk-after-o${query ? "-third" : ""}.png`) });
  await input.look(c.page, -420, 0, 30);
  await c.page.waitForTimeout(500);
  out.steps.push(await read("after a drag of -420 px"));
  await input.look(c.page, 0, -200, 20);
  await c.page.waitForTimeout(500);
  out.steps.push(await read("after a drag of -200 px up"));
  await c.page.screenshot({ path: path.join(OUT, `desk-after-look${query ? "-third" : ""}.png`) });
  await input.snapTurn(c.page, "left", 1);
  out.steps.push(await read("after Q"));
} catch (e) {
  out.error = String((e as Error).stack ?? e);
} finally {
  fs.writeFileSync(path.join(OUT, `step7-desktop-look${query ? "-third" : ""}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  await c.close();
}
