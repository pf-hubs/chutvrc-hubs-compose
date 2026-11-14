// In-page measurements used by the trials; the harness probes (probes/) will grow out of these.
import type { Page } from "@playwright/test";

export type Session = { sfuId: number | null; isConnected: boolean; clientId: string; mic: string | null; micEnabled: boolean | null };

export function session(page: Page): Promise<Session> {
  return page.evaluate(() => {
    const sfu = (window as any).APP?.sfu;
    return {
      sfuId: sfu?.sfuId ?? null,
      isConnected: !!sfu?.isConnected,
      clientId: sfu?.clientId ?? "",
      mic: sfu?.getLocalMicTrack?.()?.readyState ?? null,
      micEnabled: sfu?.isMicEnabled ?? null
    };
  });
}

/**
 * Listens to a remote client's audio through APP.sfu.getMediaStream and reports, over `ms`, how often
 * the energy at `pilotHz` stands out of the spectrum around it (the pilot beeps 250 ms each second,
 * so about 0.25 when it arrives), and the same for a control frequency nobody sends.
 */
export function pilot(page: Page, remoteId: string, pilotHz: number, controlHz: number, ms = 4000) {
  return page.evaluate(
    async ({ remoteId, pilotHz, controlHz, ms }) => {
      const APP = (window as any).APP;
      const stream: MediaStream | null = await Promise.race([
        APP.sfu.getMediaStream(remoteId, "audio"),
        new Promise<null>(r => setTimeout(() => r(null), 10000))
      ]);
      if (!stream) return { error: "no stream within 10 s" };
      const tracks = stream.getAudioTracks().map(t => `${t.readyState}${t.muted ? " muted" : ""}`);
      // Chromium only feeds a remote WebRTC stream into Web Audio once a media element plays it
      const el = new Audio();
      el.srcObject = stream;
      el.muted = true;
      await el.play().catch(() => {});
      const ctx = new AudioContext();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser();
      an.fftSize = 4096;
      an.smoothingTimeConstant = 0;
      src.connect(an);
      const bins = new Float32Array(an.frequencyBinCount);
      const binHz = ctx.sampleRate / an.fftSize;
      const score = (hz: number) => {
        const k = Math.round(hz / binHz);
        const v = Math.max(bins[k - 1], bins[k], bins[k + 1]);
        const around: number[] = [];
        for (let j = k - 30; j <= k + 30; j++) if (Math.abs(j - k) > 4 && j > 0 && j < bins.length) around.push(bins[j]);
        around.sort((a, b) => a - b);
        return v - around[around.length >> 1];
      };
      let n = 0,
        hit = 0,
        ctl = 0,
        peak = -Infinity,
        level = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        await new Promise(r => setTimeout(r, 40));
        an.getFloatFrequencyData(bins);
        const s = score(pilotHz);
        peak = Math.max(peak, s);
        if (s > 20) hit++;
        if (score(controlHz) > 20) ctl++;
        let sum = 0;
        for (const b of bins) sum += Math.pow(10, b / 10);
        level = Math.max(level, 10 * Math.log10(sum + 1e-12));
        n++;
      }
      src.disconnect();
      await ctx.close();
      el.srcObject = null;
      return { tracks, pilotRatio: +(hit / n).toFixed(2), controlRatio: +(ctl / n).toFixed(2), peakDb: +peak.toFixed(1), maxLevelDb: +level.toFixed(1) };
    },
    { remoteId, pilotHz, controlHz, ms }
  );
}

/** A remote client's pose as this page holds it */
export function remotePose(page: Page, clientId: string) {
  return page.evaluate(clientId => {
    const pose = (window as any).APP?.avatarPoses?.get(clientId);
    if (!pose) return null;
    const r = (v: any) => [v.x, v.y, v.z].map((n: number) => +n.toFixed(3));
    return { rig: r(pose.rig.pos), head: r(pose.head.pos), left: r(pose.leftHand.pos), right: r(pose.rightHand.pos), isVR: pose.isVR, tracked: pose.tracked, seq: pose.seq };
  }, clientId);
}

/** Records the data channel messages for `ms` and counts them per label and direction */
export function recordPackets(page: Page, ms = 3000) {
  return page.evaluate(async ms => {
    const bus = (window as any).APP.sfu.bus;
    bus.takeRecording();
    bus.startRecording();
    await new Promise(r => setTimeout(r, ms));
    bus.stopRecording();
    const entries: any[] = bus.takeRecording();
    const counts: Record<string, number> = {};
    for (const e of entries) {
      const key = `${e.l} ${e.s === 1 ? "sent" : e.s === 0 ? "received" : `s=${e.s}`}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return { total: entries.length, counts, sample: entries.filter(e => e.l === "#avatar-pose").slice(0, 2).map(e => ({ ...e, m: JSON.stringify(e.m).slice(0, 300) })) };
  }, ms);
}

/** Holds a key for `ms` on the page (desktop movement) */
export async function holdKey(page: Page, key: string, ms: number) {
  await page.mouse.click(640, 360);
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
