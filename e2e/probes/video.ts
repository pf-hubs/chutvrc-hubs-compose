// Video-seen probe (plan 3.2): a client's video stream for another client (or its own published track),
// drawn to a canvas: does it have a live track, do frames arrive, and what is its mean colour. The
// camera clips are a flat colour per slot (assets/media.ts) with a white label in the middle, so the
// mean colour tells whose picture it is; a shared screen is compared with the sender's own track.
import type { Page } from "@playwright/test";
import { MEDIA_SLOTS, type SlotName } from "../assets/media";

export type Rgb = [number, number, number];

export type VideoSeen = {
  hasTrack: boolean;
  /** readyState (and "muted") of the stream's video tracks */
  tracks: string[];
  width: number;
  height: number;
  /** Frames the element presented while the probe watched */
  framesAdvanced: number;
  mean: Rgb | null;
  error?: string;
};

/**
 * What `page` shows of `clientId`'s video: the stream from APP.sfu.getMediaStream(clientId, "video")
 * (the own published track when clientId is the page's own), played muted in a hidden element and
 * drawn to a 64 x 36 canvas after `watchMs`.
 */
export function seenVideo(page: Page, clientId: string, waitMs = 8000, watchMs = 1500): Promise<VideoSeen> {
  return page.evaluate(
    async ({ clientId, waitMs, watchMs }) => {
      const APP = (window as any).APP;
      const empty = { hasTrack: false, tracks: [] as string[], width: 0, height: 0, framesAdvanced: 0, mean: null };
      const stream: MediaStream | null = await Promise.race([
        APP.sfu.getMediaStream(clientId, "video").catch(() => null),
        new Promise<null>(r => setTimeout(() => r(null), waitMs))
      ]);
      const live = stream?.getVideoTracks().filter(t => t.readyState === "live") ?? [];
      if (!stream || !live.length) {
        return { ...empty, tracks: stream?.getVideoTracks().map(t => t.readyState) ?? [], error: stream ? "no live video track" : `no video stream within ${waitMs} ms` };
      }
      const tracks = stream.getVideoTracks().map(t => `${t.readyState}${t.muted ? " muted" : ""}`);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = new MediaStream(live);
      await video.play().catch(() => {});
      const t0 = performance.now();
      while (!video.videoWidth && performance.now() - t0 < waitMs) await new Promise(r => setTimeout(r, 100));
      const frames = () => (video as any).getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      const f0 = frames();
      await new Promise(r => setTimeout(r, watchMs));
      const framesAdvanced = frames() - f0;
      let mean: [number, number, number] | null = null;
      if (video.videoWidth) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 36;
        const g = canvas.getContext("2d", { willReadFrequently: true })!;
        g.drawImage(video, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let r = 0;
        let gg = 0;
        let b = 0;
        for (let i = 0; i < d.length; i += 4) {
          r += d[i];
          gg += d[i + 1];
          b += d[i + 2];
        }
        const n = d.length / 4;
        mean = [Math.round(r / n), Math.round(gg / n), Math.round(b / n)];
      }
      const result = { hasTrack: true, tracks, width: video.videoWidth, height: video.videoHeight, framesAdvanced, mean };
      video.pause();
      video.srcObject = null;
      return result;
    },
    { clientId, waitMs, watchMs }
  );
}

/** The colours ffmpeg uses for the slot clips' names */
const NAMED: Record<string, Rgb> = {
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  orange: [255, 165, 0],
  purple: [128, 0, 128],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  maroon: [128, 0, 0],
  olive: [128, 128, 0]
};

export const slotColour = (slot: SlotName): Rgb => NAMED[MEDIA_SLOTS[slot].colour];

export const colourDistance = (a: Rgb, b: Rgb) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));

/**
 * A received picture matches a reference (the sender's own track, or its slot colour) when its mean
 * colour lies within this distance. The label in the middle of a clip pulls the mean towards white by
 * about 30; video coding moves it by a few units.
 */
export const VIDEO_MATCH = 60;

/** Whether `seen` shows a moving picture whose colour is within VIDEO_MATCH of `reference` */
export function matches(seen: VideoSeen, reference: Rgb | null): boolean {
  return !!(seen.hasTrack && seen.mean && reference && seen.framesAdvanced > 0 && colourDistance(seen.mean, reference) <= VIDEO_MATCH);
}

export const describeVideo = (v: VideoSeen) =>
  v.hasTrack ? `${v.width}x${v.height}, ${v.framesAdvanced} new frames, mean rgb(${v.mean?.join(", ") ?? "-"})` : `no video (${v.error ?? v.tracks.join(", ")})`;
