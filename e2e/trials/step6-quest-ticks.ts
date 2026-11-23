// Step 6 trial: where the QUEST client's two scene ticks per frame come from, and whether the frame loop
// survives leaving VR (scene.exitVR(), as the client's own UI does, or the session ending from the
// headset's side, as the Quest's system button does).
//   npx tsx trials/step6-quest-ticks.ts [exitVR|sessionEnd]
import fs from "node:fs";
import path from "node:path";
import { launchClient } from "../clients/launch";
import { enterRoom } from "../clients/enter";
import { room } from "../lib/fixtures";
import { EVIDENCE_DIR } from "../lib/env";

const how = process.argv[2] ?? "exitVR";
const out: any = { how };
const q = await launchClient({ profile: "QUEST", identity: "quest1", slot: "a", name: "A-quest", position: [0, 0] });
try {
  await enterRoom(q, room("dialog-main").hubId, { displayName: "A-quest" });
  await q.page.waitForTimeout(3000);
  out.stacks = await q.page.evaluate(async () => {
    const APP = (window as any).APP;
    const source = APP.sfu.avatarSync.localPoseSource;
    const renderer = (window as any).AFRAME.scenes[0].renderer;
    const stacks: any[] = [];
    const sample = source.sample.bind(source);
    source.sample = (now: number) => {
      if (stacks.length < 6) stacks.push({ now, xr: !!renderer.xr.getFrame?.(), stack: new Error().stack!.split("\n").slice(2, 14).map(s => s.trim()) });
      sample(now);
    };
    await new Promise(r => setTimeout(r, 200));
    source.sample = sample;
    return stacks;
  });
  const frames = () => q.page.evaluate(() => (window as any).AFRAME.scenes[0].renderer.info.render.frame);
  const f0 = await frames();
  await q.page.waitForTimeout(1000);
  out.framesPerSecondInVr = (await frames()) - f0;
  out.presentingBefore = await q.page.evaluate(() => (window as any).AFRAME.scenes[0].renderer.xr.isPresenting);
  if (how === "exitVR") await q.page.evaluate(() => (window as any).AFRAME.scenes[0].exitVR());
  else await q.page.evaluate(() => (window as any).xrDevice.activeSession?.end());
  await q.page.waitForTimeout(2000);
  out.after = await q.page.evaluate(() => {
    const scene = (window as any).AFRAME.scenes[0];
    return { presenting: scene.renderer.xr.isPresenting, vrMode: scene.is("vr-mode"), rafPatched: !String(window.requestAnimationFrame).includes("native code") };
  });
  const f1 = await frames();
  await q.page.waitForTimeout(1000);
  out.framesPerSecondAfterExit = (await frames()) - f1;
  await q.page.screenshot({ path: path.join(EVIDENCE_DIR, "trials", `step6-quest-${how}.png`) });
  out.debugLines = q.log.filter(e => /PDF:|enter-vr|exit-vr|session/i.test(e.text)).map(e => `${e.t} ${e.type} ${e.text.slice(0, 160)}`);
  const exitAt = q.log.find(e => /removing window.requestAnimationFrame/.test(e.text))?.t ?? 0;
  out.errorsAfterExit = q.log.filter(e => e.t >= exitAt - 50 && (e.type === "error" || e.type === "pageerror" || e.type === "warning")).slice(0, 12).map(e => `${e.t} ${e.type} ${e.text.slice(0, 400)}`);
} catch (e) {
  out.error = String(e);
} finally {
  fs.mkdirSync(path.join(EVIDENCE_DIR, "trials"), { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "trials", `step6-quest-${how}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  await q.close();
}
