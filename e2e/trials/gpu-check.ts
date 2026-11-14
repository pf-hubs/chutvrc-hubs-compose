// Trial helper: which GPU each launch mode gets, and the bare requestAnimationFrame rate, on a blank page.
//   npx tsx trials/gpu-check.ts
import { firstPage, launchClient, save } from "./common";

const modes: Array<[string, Parameters<typeof launchClient>[1]]> = [
  ["edge headed", { channel: "msedge" }],
  ["edge headless", { channel: "msedge", headless: true }],
  ["edge headless + gpu flags", { channel: "msedge", headless: true, extraArgs: ["--enable-gpu", "--use-angle=d3d11", "--ignore-gpu-blocklist"] }],
  ["chromium headed", { channel: "chromium" }],
  ["chromium headless", { channel: "chromium", headless: true }]
];
const out: any[] = [];
for (const [name, opts] of modes) {
  const context = await launchClient("desk6", { ...opts, profile: "trial-gpu-check" });
  const page = await firstPage(context);
  await page.goto("about:blank");
  const info = await page.evaluate(async () => {
    const gl = document.createElement("canvas").getContext("webgl");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "no webgl";
    const fps = await new Promise<number>(resolve => {
      let n = 0;
      const t0 = performance.now();
      const tick = (t: number) => (++n, t - t0 < 2000 ? requestAnimationFrame(tick) : resolve(+((n * 1000) / (t - t0)).toFixed(1)));
      requestAnimationFrame(tick);
    });
    return { renderer, fps, ua: navigator.userAgent.replace(/.*(Edg\/[\d.]+|Chrome\/[\d.]+).*/, "$1") };
  });
  out.push({ name, version: context.browser()?.version() ?? null, ...info });
  console.log(name, JSON.stringify(info));
  await context.close();
}
save("gpu-check.json", out);
