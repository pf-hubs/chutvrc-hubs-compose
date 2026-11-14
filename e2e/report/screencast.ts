// Time-stamped frames of a client's page (T5): the DevTools screencast, which hands over each frame the
// compositor produced with the time it was produced on the PC's clock. Two observers' frames can then be
// matched by time, so a side-by-side video shows the same moment on both, which Playwright's own video
// (no time stamps, half size) cannot do. The frames are written to disk as they come.
import fs from "node:fs";
import path from "node:path";
import type { CDPSession } from "@playwright/test";
import type { Client } from "../clients/launch";

/** One frame: the PC's clock in milliseconds and the JPEG file */
export type CastFrame = { t: number; file: string };

export class Screencast {
  private frames: CastFrame[] = [];
  private writes: Promise<void>[] = [];
  private stopped = false;

  private constructor(
    private readonly cdp: CDPSession,
    readonly dir: string
  ) {}

  /** Starts sending the page's frames to `dir` (JPEG, full window size) */
  static async start(client: Client, dir: string, quality = 80): Promise<Screencast> {
    fs.mkdirSync(dir, { recursive: true });
    const cdp = await client.context.newCDPSession(client.page);
    const cast = new Screencast(cdp, dir);
    let n = 0;
    cdp.on("Page.screencastFrame", (frame: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const t = frame.metadata.timestamp ? frame.metadata.timestamp * 1000 : Date.now();
      const file = path.join(dir, `${String(++n).padStart(5, "0")}.jpg`);
      if (!cast.stopped) {
        cast.frames.push({ t, file });
        cast.writes.push(fs.promises.writeFile(file, Buffer.from(frame.data, "base64")));
      }
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
    });
    const viewport = client.page.viewportSize() ?? { width: 1280, height: 720 };
    await cdp.send("Page.startScreencast", { format: "jpeg", quality, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });
    return cast;
  }

  /** Stops the screencast and returns the frames, once they are on disk */
  async stop(): Promise<CastFrame[]> {
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    this.stopped = true;
    await Promise.all(this.writes);
    await this.cdp.detach().catch(() => {});
    return this.frames.sort((a, b) => a.t - b.t);
  }
}

/** The frame shown at time t: the last one produced at or before t (the first one before the first) */
export function frameAt(frames: CastFrame[], t: number): CastFrame | null {
  if (!frames.length) return null;
  let lo = 0;
  let hi = frames.length - 1;
  if (t < frames[0].t) return frames[0];
  while (hi > lo) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return frames[lo];
}

/** Frames per second over a list */
export function castRate(frames: CastFrame[]): number {
  if (frames.length < 2) return 0;
  return +((frames.length - 1) / ((frames[frames.length - 1].t - frames[0].t) / 1000)).toFixed(1);
}
