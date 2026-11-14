// Audio-heard probe (plan 3.2): does this client hear a given sender's pilot beep?
// The remote stream comes from APP.sfu.getMediaStream(clientId, "audio") and goes into an analyser.
// Every 40 ms the probe asks whether the energy at the pilot frequency stands 20 dB above the spectrum
// around it. The pilot is on 250 ms of every second, so a sender that is heard scores about 0.25-0.3,
// and a muted or silent one 0; a control frequency nobody sends should stay at 0.
import type { Page } from "@playwright/test";

export type PilotResult = {
  /** Share of 40 ms samples in which the pilot stood out */
  ratio: number;
  /** The same for the control frequency */
  controlRatio: number;
  peakDb: number;
  /** readyState (and "muted") of the stream's audio tracks */
  tracks: string[];
  error?: string;
};

/**
 * A sender counts as heard at this ratio or more, and as silent at the silent ratio or less. Over the
 * first nine T1 runs on Dialog a pilot that arrived scored 0.13 to 0.33 (the receiving side's noise
 * suppression takes part of each beep) and a muted or missing one 0 to 0.01; the control frequency 0.
 */
export const PILOT_HEARD = 0.1;
export const PILOT_SILENT = 0.03;

export function heardPilot(page: Page, senderId: string, pilotHz: number, controlHz: number, ms = 5000): Promise<PilotResult> {
  return page.evaluate(
    async ({ senderId, pilotHz, controlHz, ms }) => {
      const APP = (window as any).APP;
      const stream: MediaStream | null = await Promise.race([
        APP.sfu.getMediaStream(senderId, "audio"),
        new Promise<null>(r => setTimeout(() => r(null), 10_000))
      ]);
      if (!stream) return { ratio: 0, controlRatio: 0, peakDb: -Infinity, tracks: [], error: "no audio stream within 10 s" };
      const tracks = stream.getAudioTracks().map(t => `${t.readyState}${t.muted ? " muted" : ""}`);
      // Chromium only feeds a remote WebRTC stream into Web Audio once a media element plays it
      const element = new Audio();
      element.srcObject = stream;
      element.muted = true;
      await element.play().catch(() => {});
      const ctx = new AudioContext();
      await ctx.resume();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
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
      let peakDb = -Infinity;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        await new Promise(r => setTimeout(r, 40));
        analyser.getFloatFrequencyData(bins);
        const s = standsOut(pilotHz);
        peakDb = Math.max(peakDb, s);
        if (s > 20) hit++;
        if (standsOut(controlHz) > 20) control++;
        n++;
      }
      source.disconnect();
      await ctx.close();
      element.srcObject = null;
      return { ratio: +(hit / n).toFixed(2), controlRatio: +(control / n).toFixed(2), peakDb: +peakDb.toFixed(1), tracks };
    },
    { senderId, pilotHz, controlHz, ms }
  );
}
