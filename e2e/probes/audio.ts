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

/**
 * A pilot watch: from start to stop, the page samples `senderId`'s pilot every 40 ms and notes when it
 * stood out, and it looks for the sender's audio track every 500 ms, so it follows the sender onto a new
 * track (a media server switch, a reconnect, a device change). Gaps in the detections show how long the
 * audio was gone. Several watches can run at once under different keys.
 */
export async function startPilotWatch(page: Page, key: string, senderId: string, pilotHz: number) {
  await page.evaluate(
    ({ key, senderId, pilotHz }) => {
      const w = window as any;
      w.__e2ePilotWatch ??= {};
      const state = { t0: performance.now(), detections: [] as number[], trackChanges: [] as { t: number; id: string | null }[], tracks: [] as string[], stop: false, done: null as Promise<void> | null };
      w.__e2ePilotWatch[key] = state;
      state.done = (async () => {
        const ctx = new AudioContext();
        await ctx.resume();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0;
        const bins = new Float32Array(analyser.frequencyBinCount);
        const k = Math.round(pilotHz / (ctx.sampleRate / analyser.fftSize));
        let current: MediaStreamTrack | null = null;
        let source: MediaStreamAudioSourceNode | null = null;
        let element: HTMLAudioElement | null = null;
        let lastLook = -Infinity;
        while (!state.stop) {
          const now = performance.now();
          if (now - lastLook > 500) {
            lastLook = now;
            const stream: MediaStream | null = await Promise.race([
              (window as any).APP.sfu.getMediaStream(senderId, "audio").catch(() => null),
              new Promise<null>(r => setTimeout(() => r(null), 300))
            ]);
            const track = stream?.getAudioTracks().find(t => t.readyState === "live") ?? null;
            if ((track?.id ?? null) !== (current?.id ?? null) && (track || current?.readyState === "ended")) {
              source?.disconnect();
              if (element) element.srcObject = null;
              current = track;
              source = null;
              if (track) {
                // Chromium only feeds a remote WebRTC track into Web Audio once a media element plays it
                element = new Audio();
                element.muted = true;
                element.srcObject = new MediaStream([track]);
                await element.play().catch(() => {});
                source = ctx.createMediaStreamSource(new MediaStream([track]));
                source.connect(analyser);
                state.tracks.push(track.id);
              }
              state.trackChanges.push({ t: Math.round(performance.now() - state.t0), id: track?.id ?? null });
            }
          }
          if (source) {
            analyser.getFloatFrequencyData(bins);
            const peak = Math.max(bins[k - 1], bins[k], bins[k + 1]);
            const around: number[] = [];
            for (let j = k - 30; j <= k + 30; j++) if (Math.abs(j - k) > 4 && j > 0 && j < bins.length) around.push(bins[j]);
            around.sort((a, b) => a - b);
            if (peak - around[around.length >> 1] > 20) state.detections.push(Math.round(performance.now() - state.t0));
          }
          await new Promise(r => setTimeout(r, 40));
        }
        source?.disconnect();
        if (element) element.srcObject = null;
        await ctx.close();
      })();
    },
    { key, senderId, pilotHz }
  );
}

export type PilotWatch = {
  /** Wall-clock time (Date.now()) the watch started, for lining it up with the test's own events */
  startedAt: number;
  durationMs: number;
  /** Milliseconds from the start at which the pilot stood out */
  detections: number[];
  /** When the sender's audio track changed (null: no live track) */
  trackChanges: { t: number; id: string | null }[];
  /** Distinct tracks the watch played */
  tracks: string[];
};

export async function stopPilotWatch(page: Page, key: string): Promise<PilotWatch> {
  return page.evaluate(async key => {
    const state = (window as any).__e2ePilotWatch?.[key];
    if (!state) return { startedAt: 0, durationMs: 0, detections: [], trackChanges: [], tracks: [] };
    state.stop = true;
    await state.done;
    delete (window as any).__e2ePilotWatch[key];
    const durationMs = Math.round(performance.now() - state.t0);
    return { startedAt: Math.round(performance.timeOrigin + state.t0), durationMs, detections: state.detections, trackChanges: state.trackChanges, tracks: state.tracks };
  }, key);
}

/** The beeps come once a second, so detections normally follow each other within this */
const BEEP_PERIOD_MS = 1000;

/**
 * The longest stretch without the pilot within [fromMs, toMs] of a watch (from the start when not given),
 * minus the normal pause between beeps: about 0 while the audio runs, the outage otherwise. The edges of
 * the window count as detections only when the pilot was heard before them.
 */
export function audioGap(watch: PilotWatch, fromMs = 0, toMs = watch.durationMs): { gapMs: number; heardAfterMs: number | null; detections: number } {
  const inside = watch.detections.filter(t => t >= fromMs && t <= toMs);
  const points = [fromMs, ...inside, toMs];
  let longest = 0;
  for (let i = 1; i < points.length; i++) longest = Math.max(longest, points[i] - points[i - 1]);
  return {
    gapMs: Math.max(0, longest - BEEP_PERIOD_MS),
    heardAfterMs: inside.length ? inside[0] - fromMs : null,
    detections: inside.length
  };
}

export type InboundAudio = {
  /** The sender's audio track ids this page holds, and the RTP receivers found for them */
  tracks: string[];
  receivers: number;
  /** Packets that arrived while the probe watched */
  packets: number;
  /** Mean level of what arrived over the window, in dBFS (from totalAudioEnergy and totalSamplesDuration); null without samples */
  meanDbfs: number | null;
  error?: string;
};

/**
 * Audio from a sender as the receiving browser's WebRTC statistics show it: the inbound RTP of the
 * sender's track(s), packets and level over `ms`. For receivers whose Web Audio cannot read a remote WebRTC
 * track (Linux WebKit, the IOS profile: the analyser stays silent), this is how "hears" is measured there:
 * the audio arrives and has a level, not the pilot frequency itself.
 */
export function inboundAudio(page: Page, senderId: string, ms = 3000): Promise<InboundAudio> {
  return page.evaluate(
    async ({ senderId, ms }) => {
      const APP = (window as any).APP;
      const stream: MediaStream | null = await Promise.race([
        APP.sfu.getMediaStream(senderId, "audio").catch(() => null),
        new Promise<null>(r => setTimeout(() => r(null), 10_000))
      ]);
      const tracks = stream?.getAudioTracks().map(t => t.id) ?? [];
      if (!tracks.length) return { tracks, receivers: 0, packets: 0, meanDbfs: null, error: "no audio track for the sender" };
      const pcs: RTCPeerConnection[] = ((window as any).__e2eConnections ?? []).map((e: any) => e.pc).filter((pc: RTCPeerConnection) => pc.connectionState !== "closed");
      const read = async () => {
        let packets = 0;
        let energy = 0;
        let duration = 0;
        let receivers = 0;
        for (const pc of pcs) {
          (await pc.getStats()).forEach((s: any) => {
            if (s.type !== "inbound-rtp" || s.kind !== "audio" || !tracks.includes(s.trackIdentifier)) return;
            receivers++;
            packets += s.packetsReceived ?? 0;
            energy += s.totalAudioEnergy ?? 0;
            duration += s.totalSamplesDuration ?? 0;
          });
        }
        return { packets, energy, duration, receivers };
      };
      const a = await read();
      await new Promise(r => setTimeout(r, ms));
      const b = await read();
      const seconds = b.duration - a.duration;
      const meanDbfs = seconds > 0 ? 10 * Math.log10(Math.max(1e-12, (b.energy - a.energy) / seconds)) : null;
      return { tracks, receivers: b.receivers, packets: b.packets - a.packets, meanDbfs: meanDbfs === null ? null : +meanDbfs.toFixed(1) };
    },
    { senderId, ms }
  );
}

/** Arriving audio counts as heard at this mean level or more (silence and comfort noise sit far below; the clips arrive at about -50 dBFS) */
export const INBOUND_HEARD_DBFS = -70;
