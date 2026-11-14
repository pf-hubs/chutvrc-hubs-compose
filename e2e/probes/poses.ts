// Pose probe (plan 3.2, the part T1 needs): an avatar's pose as one client holds it, from
// APP.avatarPoses (the own pose under the own client id, remote poses as received and interpolated).
import type { Page } from "@playwright/test";

export type PoseSample = {
  /** performance.now() on the reading page */
  t: number;
  rig: [number, number, number];
  /** The rig's turn about the vertical axis, radians */
  rigYaw: number;
  head: [number, number, number];
  /** The head's pitch and yaw in the rig's space, radians */
  headPitch: number;
  headYaw: number;
  seq: number;
  tracked: number;
  isVR: boolean;
};

/** `clientId`'s pose as `page` holds it; null when it has none */
export function readPose(page: Page, clientId: string): Promise<PoseSample | null> {
  return page.evaluate(clientId => {
    const pose = (window as any).APP?.avatarPoses?.get(clientId);
    if (!pose) return null;
    const v = (p: any): [number, number, number] => [p.x, p.y, p.z].map((n: number) => +n.toFixed(4)) as [number, number, number];
    return {
      t: performance.now(),
      rig: v(pose.rig.pos),
      rigYaw: +pose.rig.rot.y.toFixed(4),
      head: v(pose.head.pos),
      headPitch: +pose.head.rot.x.toFixed(4),
      headYaw: +pose.head.rot.y.toFixed(4),
      seq: pose.seq,
      tracked: pose.tracked,
      isVR: pose.isVR
    };
  }, clientId);
}

/** Samples `clientId`'s pose on `page` every `everyMs` while `during` runs; returns the trace */
export async function tracePose(page: Page, clientId: string, during: () => Promise<unknown>, everyMs = 100): Promise<PoseSample[]> {
  const trace: PoseSample[] = [];
  let running = true;
  const sampler = (async () => {
    while (running) {
      const sample = await readPose(page, clientId).catch(() => null);
      if (sample) trace.push(sample);
      await new Promise(r => setTimeout(r, everyMs));
    }
  })();
  try {
    await during();
  } finally {
    running = false;
    await sampler;
  }
  return trace;
}

/** How much a trace moved: horizontal distance travelled by the rig, its turn, the head's pitch range */
export function movement(trace: PoseSample[]) {
  if (trace.length < 2) return { samples: trace.length, travelled: 0, net: 0, turned: 0, pitchRange: 0, longestStillMs: 0, seqAdvanced: 0 };
  let travelled = 0;
  let turned = 0;
  let longestStillMs = 0;
  let stillSince = trace[0].t;
  for (let i = 1; i < trace.length; i++) {
    const [a, b] = [trace[i - 1], trace[i]];
    const step = Math.hypot(b.rig[0] - a.rig[0], b.rig[2] - a.rig[2]);
    travelled += step;
    let dYaw = b.rigYaw - a.rigYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    turned += Math.abs(dYaw);
    const changed = step > 1e-4 || Math.abs(dYaw) > 1e-4 || Math.abs(b.headPitch - a.headPitch) > 1e-4 || Math.abs(b.headYaw - a.headYaw) > 1e-4;
    if (changed) stillSince = b.t;
    else longestStillMs = Math.max(longestStillMs, b.t - stillSince);
  }
  const first = trace[0];
  const last = trace[trace.length - 1];
  const pitches = trace.map(s => s.headPitch);
  return {
    samples: trace.length,
    travelled: +travelled.toFixed(2),
    net: +Math.hypot(last.rig[0] - first.rig[0], last.rig[2] - first.rig[2]).toFixed(2),
    turned: +((turned * 180) / Math.PI).toFixed(1),
    pitchRange: +(((Math.max(...pitches) - Math.min(...pitches)) * 180) / Math.PI).toFixed(1),
    longestStillMs: Math.round(longestStillMs),
    seqAdvanced: last.seq - first.seq
  };
}
