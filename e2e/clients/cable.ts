// The virtual audio cable (plan 1.1, 2.5): a player feeds a clip into the cable's playback side
// ("CABLE Input (VB-Audio Virtual Cable)"), so a client that takes the cable's recording side
// ("CABLE Output (VB-Audio Virtual Cable)") as its microphone sends that clip, through Windows' own
// audio stack instead of Chromium's fake device. The player is a small Edge window out of view that plays
// the clip through an AudioContext whose sinkId is the cable (headless Edge plays to no device, and its
// media element refuses the clip). Before a test uses it, the player listens on the cable's microphone
// side itself and reports whether the clip's pilot comes out (the self-test).
// Device labels are localized on this PC ("既定 - ..." for the default entry); the cable's own names are not.
import fs from "node:fs";
import { chromium, type Browser, type Page } from "@playwright/test";
import { ASSETS_URL } from "../lib/env";
import { MEDIA_SLOTS, CONTROL_HZ, clipPath, type SlotName } from "../assets/media";

export const CABLE_PLAYBACK = "CABLE Input (VB-Audio Virtual Cable)";
export const CABLE_MICROPHONE = "CABLE Output (VB-Audio Virtual Cable)";

export type CablePlayer = {
  slot: SlotName;
  pilotHz: number;
  /** Whether a page recording from the cable's microphone side detected the clip's pilot */
  selfTest: { heard: boolean; ratio: number; controlRatio: number; error?: string };
  outputLabel: string | null;
  stop(): Promise<void>;
};

/** Starts playing `slot`'s clip into the cable, in a loop, and checks that it comes out of the cable's microphone side */
export async function startCablePlayer(slot: SlotName): Promise<CablePlayer> {
  const browser: Browser = await chromium.launch({
    channel: "msedge",
    // Headless Edge plays to no device; a small window out of view does
    headless: false,
    args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--window-position=-3000,0", "--window-size=300,200"]
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ["microphone"] });
  // tsx wraps named functions in __name(...), which page.evaluate carries into the page
  await context.addInitScript({ content: "globalThis.__name = globalThis.__name || (f => f);" });
  const page: Page = await context.newPage();
  // A secure origin, so getUserMedia and setSinkId are available
  await page.goto(`${ASSETS_URL}/clips/`, { waitUntil: "domcontentloaded" }).catch(() => {});
  const pilotHz = MEDIA_SLOTS[slot].pilotHz;
  const result = await page.evaluate(
    async ({ src, playback, microphone, pilotHz, controlHz }) => {
      // Device labels need a granted microphone
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach(t => t.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const real = (d: MediaDeviceInfo) => d.deviceId !== "default" && d.deviceId !== "communications";
      const output = devices.find(d => d.kind === "audiooutput" && real(d) && d.label === playback);
      const input = devices.find(d => d.kind === "audioinput" && real(d) && d.label === microphone);
      if (!output || !input) return { outputLabel: output?.label ?? null, error: `cable not found (output ${!!output}, input ${!!input})`, ratio: 0, controlRatio: 0 };
      // Played through Web Audio on a context whose output is the cable (the clip is handed over as data)
      const bytes = Uint8Array.from(atob(src), c => c.charCodeAt(0));
      const player = new AudioContext({ sinkId: output.deviceId } as any);
      const buffer = await player.decodeAudioData(bytes.buffer);
      const node = player.createBufferSource();
      node.buffer = buffer;
      node.loop = true;
      node.connect(player.destination);
      node.start();
      await player.resume();
      (window as any).__cablePlayer = player;
      // Listen on the cable's other side, without the browser's voice processing
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: input.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const bins = new Float32Array(analyser.frequencyBinCount);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const standsOut = (hz: number) => {
        const k = Math.round(hz / binHz);
        const peak = Math.max(bins[k - 1], bins[k], bins[k + 1]);
        const around: number[] = [];
        for (let j = k - 30; j <= k + 30; j++) if (Math.abs(j - k) > 4 && j > 0 && j < bins.length) around.push(bins[j]);
        around.sort((a, b) => a - b);
        return peak - around[around.length >> 1];
      };
      let n = 0;
      let hit = 0;
      let control = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await new Promise(r => setTimeout(r, 40));
        analyser.getFloatFrequencyData(bins);
        if (standsOut(pilotHz) > 20) hit++;
        if (standsOut(controlHz) > 20) control++;
        n++;
      }
      stream.getTracks().forEach(t => t.stop());
      await ctx.close();
      return { outputLabel: output.label, ratio: +(hit / n).toFixed(2), controlRatio: +(control / n).toFixed(2) };
    },
    { src: fs.readFileSync(clipPath(slot, "wav")).toString("base64"), playback: CABLE_PLAYBACK, microphone: CABLE_MICROPHONE, pilotHz, controlHz: CONTROL_HZ }
  );
  const heard = !result.error && result.ratio >= 0.1 && result.controlRatio <= 0.03;
  return {
    slot,
    pilotHz,
    selfTest: { heard, ratio: result.ratio, controlRatio: result.controlRatio, error: result.error },
    outputLabel: result.outputLabel,
    async stop() {
      await page.evaluate(() => (window as any).__cablePlayer?.close()).catch(() => {});
      await browser.close().catch(() => {});
    }
  };
}
