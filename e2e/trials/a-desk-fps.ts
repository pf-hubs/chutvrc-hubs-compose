// Trial (a): DESK frame rate. N visible Edge windows (own profile, own fake media each) enter one
// room through the real UI; then all measure requestAnimationFrame and renderer frames together.
//   npx tsx trials/a-desk-fps.ts 1 2 4 6            # visible windows, one run per count
//   npx tsx trials/a-desk-fps.ts --mode=headless 2  # Playwright headless (new headless in Edge)
//   npx tsx trials/a-desk-fps.ts --mode=headless-gpu 2
// Results: evidence/trials/a-desk-fps-<mode>.json and a screenshot per run.
import path from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import {
  EVIDENCE,
  collectErrors,
  enterRoom,
  firstPage,
  launchClient,
  measureFps,
  save,
  sleep,
  trialRoom,
  webglRenderer
} from "./common";

const argv = process.argv.slice(2);
const mode = (argv.find(a => a.startsWith("--mode="))?.slice(7) ?? "headed") as "headed" | "headless" | "headless-gpu";
const channel = (argv.find(a => a.startsWith("--channel="))?.slice(10) ?? "msedge") as "msedge" | "chromium";
const counts = argv.filter(a => !a.startsWith("--")).map(Number);
if (!counts.length) counts.push(1, 2, 4, 6);

// Visible windows are tiled over the 1920 x 1080 screen; they overlap from the fourth on
const positions: Array<[number, number]> = [
  [0, 0],
  [640, 0],
  [0, 360],
  [640, 360],
  [320, 180],
  [960, 180]
];

function launchOptions(i: number) {
  if (mode === "headed") return { channel, position: positions[i % positions.length] };
  if (mode === "headless") return { channel, headless: true };
  return { channel, headless: true, extraArgs: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] };
}

const results: any[] = [];
for (const count of counts) {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const errors: string[][] = [];
  const run: any = { count, mode, channel, clients: [] };
  try {
    for (let i = 0; i < count; i++) {
      const context = await launchClient(`desk${i + 1}`, launchOptions(i));
      contexts.push(context);
      const page = await firstPage(context);
      pages.push(page);
      errors.push(collectErrors(page));
    }
    const hubId = await trialRoom(pages[0], "fps");
    run.hubId = hubId;
    const t0 = Date.now();
    const timings = await Promise.all(pages.map((page, i) => enterRoom(page, hubId, { displayName: `desk${i + 1}` })));
    run.allEnteredMs = Date.now() - t0;
    await sleep(5000);
    const fps = await Promise.all(pages.map(page => measureFps(page, 3000)));
    const fps2 = await Promise.all(pages.map(page => measureFps(page, 3000)));
    for (let i = 0; i < count; i++) {
      run.clients.push({
        client: `desk${i + 1}`,
        gpu: await webglRenderer(pages[i]),
        timings: timings[i],
        fps: fps[i],
        fpsAgain: fps2[i],
        others: await pages[i].evaluate(() => (window as any).NAF?.connection?.adapter?.occupants ? Object.keys((window as any).NAF.connection.adapter.occupants).length : (window as any).APP?.sfu ? "n/a" : null),
        sfu: await pages[i].evaluate(() => ({ sfuId: (window as any).APP?.sfu?.sfuId, isConnected: (window as any).APP?.sfu?.isConnected })),
        errors: errors[i].slice(0, 20)
      });
    }
    await pages[0].screenshot({ path: path.join(EVIDENCE, `a-desk-fps-${mode}-${count}.png`) });
  } catch (e) {
    run.error = String(e);
    await pages[0]?.screenshot({ path: path.join(EVIDENCE, `a-desk-fps-${mode}-${count}-error.png`) }).catch(() => {});
  } finally {
    await Promise.all(contexts.map(c => c.close().catch(() => {})));
  }
  console.log(JSON.stringify(run, null, 1));
  results.push(run);
  await sleep(3000);
}
save(`a-desk-fps-${mode}-${channel}.json`, results);
