// Pose probe (plan 3.2): an avatar's pose as one client holds it, from APP.avatarPoses (the own pose under
// the own client id, remote poses as received and interpolated), or on the adapter build from the last
// received #avatar-RIG, #avatar-HEAD, #avatar-LEFT and #avatar-RIGHT transforms (probes/compat.ts).
//
// Two ways to read it: readPose/tracePose poll from the test (T1), and the frame recorder below samples in
// the page on every animation frame, on the sender (its own rig objects) and on the receivers (their copy),
// stamped with the PC's clock so traces of different pages line up. The analysis functions estimate the lag
// between a sender's path and a receiver's copy, the position error after aligning by it, freezes, and
// jerk.
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
  /**
   * The sender's sequence number; on the adapter build, which has none, the number of pose packets this
   * page was seen to receive (each arrives as a new transform object), so it still advances while poses arrive
   */
  seq: number;
  /** Tracked parts (bits); null on the adapter build */
  tracked: number | null;
  isVR: boolean | null;
  animState: number | null;
  /** "pose store" (APP.avatarPoses) or "per-part transforms" (the adapter build) */
  source: string;
};

/** `clientId`'s pose as `page` holds it; null when it has none */
export function readPose(page: Page, clientId: string): Promise<PoseSample | null> {
  return page.evaluate(clientId => {
    const pose = (window as any).__e2eApi?.pose(clientId);
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
      isVR: pose.isVR,
      animState: pose.animState,
      source: pose.source
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

// ---------- Frame recorder ----------

/**
 * One animation frame of one avatar on one page. `t` is the PC's clock in milliseconds
 * (performance.timeOrigin + performance.now(), sub-millisecond), the same on every page of this PC.
 */
export type FrameSample = {
  t: number;
  rig: [number, number, number];
  yaw: number;
  /** The head in the rig's space, and its pitch, yaw and roll (radians, YXZ) */
  head: [number, number, number];
  pitch: number;
  headYaw: number;
  roll: number;
  /** The hands in the rig's space */
  left: [number, number, number];
  right: [number, number, number];
  /** Sender's sequence number (remote), or null for the own objects */
  seq: number | null;
  tracked: number | null;
  isVR: boolean | null;
};

/** The own avatar on the page that renders it: its rig objects as the scene has them, on every build */
export const SELF = "self";

/**
 * Page code: window.__e2ePoseRec, a recorder that samples avatars once per animation frame. The own avatar
 * ("self") is read from the rig, pov node and controller objects; another client's from the capability
 * layer (its pose as this page holds it). Started and stopped by key, so several can run at once.
 */
const RECORDER = `(() => {
  if (window.__e2ePoseRec) return;
  const runs = new Map();
  const r4 = v => Math.round(v * 1e5) / 1e5;
  const v3 = p => [r4(p.x), r4(p.y), r4(p.z)];
  const sample = id => {
    const api = window.__e2eApi;
    const t = performance.timeOrigin + performance.now();
    if (id === "self") {
      const own = api.ownObjects();
      if (!own || !own.head) return null;
      const APP = window.APP;
      const pose = APP && APP.avatarPoses && APP.sfu ? APP.avatarPoses.get(api.clientId()) : null;
      return {
        t, rig: v3(own.rig.pos), yaw: r4(own.rig.rot.y), head: v3(own.head.pos), pitch: r4(own.head.rot.x), headYaw: r4(own.head.rot.y), roll: r4(own.head.rot.z),
        left: own.left ? v3(own.left.pos) : [0, 0, 0], right: own.right ? v3(own.right.pos) : [0, 0, 0],
        seq: null,
        tracked: pose ? pose.tracked : (own.left && own.right ? 1 | (own.left.visible ? 2 : 0) | (own.right.visible ? 4 : 0) : null),
        isVR: pose ? pose.isVR : null
      };
    }
    const p = api.pose(id);
    if (!p) return null;
    return {
      t, rig: v3(p.rig.pos), yaw: r4(p.rig.rot.y), head: v3(p.head.pos), pitch: r4(p.head.rot.x), headYaw: r4(p.head.rot.y), roll: r4(p.head.rot.z),
      left: v3(p.left.pos), right: v3(p.right.pos), seq: p.seq, tracked: p.tracked, isVR: p.isVR
    };
  };
  window.__e2ePoseRec = {
    start(key, ids) {
      const run = { ids, traces: Object.fromEntries(ids.map(id => [id, []])), running: true, frames: 0 };
      runs.set(key, run);
      // The page's own frame function: on a headset in VR that is the XR session's (the PDF fix replaces it)
      const raf = window.requestAnimationFrame.bind(window);
      const frame = () => {
        if (!run.running) return;
        run.frames++;
        for (const id of ids) {
          try {
            const s = sample(id);
            if (s) run.traces[id].push(s);
          } catch (e) {}
        }
        raf(frame);
      };
      raf(frame);
    },
    stop(key) {
      const run = runs.get(key);
      if (!run) return null;
      run.running = false;
      runs.delete(key);
      return run.traces;
    }
  };
})();`;

/** Starts sampling `ids` (client ids, or SELF) on every animation frame of `page` */
export async function startFrameRecorder(page: Page, key: string, ids: string[]) {
  await page.evaluate(code => new Function(code)(), RECORDER);
  await page.evaluate(({ key, ids }) => (window as any).__e2ePoseRec.start(key, ids), { key, ids });
}

/** Stops the recorder and returns a trace per id */
export async function stopFrameRecorder(page: Page, key: string): Promise<Record<string, FrameSample[]>> {
  return (await page.evaluate(key => (window as any).__e2ePoseRec?.stop(key) ?? null, key)) ?? {};
}

/** Records `ids` on each page while `during` runs; returns the traces as recorders[i] -> id -> trace */
export async function recordFrames(
  recorders: { page: Page; ids: string[] }[],
  during: () => Promise<unknown>
): Promise<Record<string, FrameSample[]>[]> {
  const key = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await Promise.all(recorders.map(r => startFrameRecorder(r.page, key, r.ids)));
  try {
    await during();
  } catch (e) {
    await Promise.all(recorders.map(r => stopFrameRecorder(r.page, key).catch(() => ({}))));
    throw e;
  }
  return Promise.all(recorders.map(r => stopFrameRecorder(r.page, key)));
}

// ---------- Analysis ----------

export type Channel = (s: FrameSample) => number[];
/** The rig's position */
export const RIG: Channel = s => s.rig;
/** The head's position in the scene: the rig plus the head turned by the rig's yaw */
export const HEAD_WORLD: Channel = s => {
  const c = Math.cos(s.yaw);
  const sn = Math.sin(s.yaw);
  return [s.rig[0] + c * s.head[0] + sn * s.head[2], s.rig[1] + s.head[1], s.rig[2] - sn * s.head[0] + c * s.head[2]];
};
export const RIGHT_HAND: Channel = s => s.right;
export const LEFT_HAND: Channel = s => s.left;
/** The head's turn: yaw and pitch (radians); unwrapped by the callers that difference it */
export const HEAD_ANGLES: Channel = s => [s.headYaw, s.pitch];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** A channel's value at time t, blended between the samples around it; null outside the trace */
export function valueAt(trace: FrameSample[], t: number, channel: Channel): number[] | null {
  if (!trace.length || t < trace[0].t || t > trace[trace.length - 1].t) return null;
  let lo = 0;
  let hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = channel(trace[lo]);
  const b = channel(trace[hi]);
  const span = trace[hi].t - trace[lo].t;
  const f = span > 0 ? (t - trace[lo].t) / span : 0;
  return a.map((v, i) => v + (b[i] - v) * f);
}

const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));
const quantile = (values: number[], q: number) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const round = (v: number, digits = 4) => (Number.isFinite(v) ? +v.toFixed(digits) : v);

export type Alignment = {
  /** How far the receiver's copy runs behind the sender's path, in milliseconds */
  lagMs: number;
  /** Distance between the copy and the path shifted by the lag, in metres */
  rms: number;
  p95: number;
  max: number;
  samples: number;
  /** How far the sender moved over the compared window (metres), so an error can be read against it */
  senderTravel: number;
};

/**
 * The lag that brings the receiver's copy closest to the sender's path (searched from 0 to `maxLagMs`), and
 * the error that remains. Only receiver frames whose shifted time falls inside the sender's trace count;
 * `fromT`/`toT` limit the compared window (PC clock).
 */
export function align(
  sender: FrameSample[],
  receiver: FrameSample[],
  channel: Channel = RIG,
  opts: { maxLagMs?: number; stepMs?: number; fromT?: number; toT?: number } = {}
): Alignment | null {
  const { maxLagMs = 1000, stepMs = 2 } = opts;
  const frames = receiver.filter(s => (opts.fromT === undefined || s.t >= opts.fromT) && (opts.toT === undefined || s.t <= opts.toT));
  if (frames.length < 10 || sender.length < 10) return null;
  const errorsAt = (lag: number) => {
    const errors: number[] = [];
    for (const s of frames) {
      const truth = valueAt(sender, s.t - lag, channel);
      if (truth) errors.push(distance(channel(s), truth));
    }
    return errors;
  };
  const rmsOf = (e: number[]) => Math.sqrt(e.reduce((a, v) => a + v * v, 0) / e.length);
  let best = { lag: 0, rms: Infinity };
  for (let lag = 0; lag <= maxLagMs; lag += stepMs) {
    const e = errorsAt(lag);
    if (e.length < frames.length * 0.5) continue;
    const r = rmsOf(e);
    if (r < best.rms) best = { lag, rms: r };
  }
  if (!Number.isFinite(best.rms)) return null;
  const errors = errorsAt(best.lag);
  const window = sender.filter(s => s.t >= frames[0].t - best.lag && s.t <= frames[frames.length - 1].t - best.lag);
  let travel = 0;
  for (let i = 1; i < window.length; i++) travel += distance(channel(window[i]), channel(window[i - 1]));
  return {
    lagMs: best.lag,
    rms: round(best.rms),
    p95: round(quantile(errors, 0.95)),
    max: round(Math.max(...errors)),
    samples: errors.length,
    senderTravel: round(travel, 3)
  };
}

export type Freeze = { fromT: number; ms: number; senderMoved: number };

/**
 * Stretches where the receiver's copy did not change at all from one frame to the next for longer than
 * `minMs` while the sender (shifted by `lagMs`) moved more than `minMove` (metres on the channel, or radians
 * for HEAD_ANGLES): the copy froze. Returns every such stretch and the longest.
 */
export function freezes(
  sender: FrameSample[],
  receiver: FrameSample[],
  lagMs: number,
  opts: { minMs?: number; minMove?: number; channels?: Channel[] } = {}
): { longestMs: number; stretches: Freeze[]; longestStillMs: number } {
  const { minMs = 300, minMove = 0.01, channels = [RIG, HEAD_ANGLES] } = opts;
  const same = (a: FrameSample, b: FrameSample) => channels.every(ch => distance(ch(a), ch(b)) < 1e-6);
  const stretches: Freeze[] = [];
  let longestStillMs = 0;
  let start = 0;
  const close = (end: number) => {
    const ms = receiver[end].t - receiver[start].t;
    longestStillMs = Math.max(longestStillMs, ms);
    if (ms <= minMs) return;
    const a = receiver[start].t - lagMs;
    const b = receiver[end].t - lagMs;
    let moved = 0;
    for (const ch of channels) {
      const va = valueAt(sender, a, ch);
      const vb = valueAt(sender, b, ch);
      if (va && vb) moved = Math.max(moved, distance(va, vb));
    }
    if (moved > minMove) stretches.push({ fromT: receiver[start].t, ms: Math.round(ms), senderMoved: round(moved, 3) });
  };
  for (let i = 1; i < receiver.length; i++) {
    if (!same(receiver[i], receiver[i - 1])) {
      close(i - 1);
      start = i;
    }
  }
  if (receiver.length > 1) close(receiver.length - 1);
  return { longestMs: Math.max(0, ...stretches.map(s => s.ms)), stretches, longestStillMs: Math.round(longestStillMs) };
}

/**
 * How smooth a trace is: per-frame steps of the channel, and jerk (the third derivative over the frame
 * times, m/s^3 on a position channel). Frames with the same time stamp are skipped.
 */
export function smoothness(trace: FrameSample[], channel: Channel = RIG) {
  const frames = trace.filter((s, i) => i === 0 || s.t - trace[i - 1].t > 1);
  const steps: number[] = [];
  const jerks: number[] = [];
  const p = frames.map(channel);
  for (let i = 1; i < frames.length; i++) steps.push(distance(p[i], p[i - 1]));
  for (let i = 3; i < frames.length; i++) {
    const dt = (frames[i].t - frames[i - 3].t) / 3000;
    if (dt <= 0) continue;
    // Third finite difference over equally weighted frames
    const j = p[i].map((v, k) => (v - 3 * p[i - 1][k] + 3 * p[i - 2][k] - p[i - 3][k]) / dt ** 3);
    jerks.push(Math.hypot(...j));
  }
  const rms = (v: number[]) => Math.sqrt(v.reduce((a, x) => a + x * x, 0) / Math.max(1, v.length));
  return {
    frames: frames.length,
    stepP99: round(quantile(steps, 0.99), 5),
    stepMax: round(Math.max(0, ...steps), 5),
    jerkRms: round(rms(jerks), 1),
    jerkP99: round(quantile(jerks, 0.99), 1)
  };
}

/** The total change of a channel over a trace, and the longest stretch in which it did not change */
export function changeOver(trace: FrameSample[], channel: Channel) {
  let longestStillMs = 0;
  let stillSince = trace[0]?.t ?? 0;
  for (let i = 1; i < trace.length; i++) {
    if (distance(channel(trace[i]), channel(trace[i - 1])) > 1e-6) stillSince = trace[i].t;
    else longestStillMs = Math.max(longestStillMs, trace[i].t - stillSince);
  }
  const first = trace[0] ? channel(trace[0]) : [];
  const last = trace.length ? channel(trace[trace.length - 1]) : [];
  return { frames: trace.length, net: trace.length ? round(distance(first, last), 4) : 0, longestStillMs: Math.round(longestStillMs) };
}

/** Unwrapped yaw change of the head between two samples, degrees */
export const headTurnDegrees = (a: FrameSample, b: FrameSample) => round((wrap(b.headYaw - a.headYaw) * 180) / Math.PI, 2);

/** A trace cut down for the evidence: every `every`-th frame */
export const thin = (trace: FrameSample[], every = 3) => trace.filter((_, i) => i % every === 0);

/** CSV of traces for the evidence: one row per frame and avatar */
export function tracesCsv(traces: Record<string, FrameSample[]>): string {
  const rows = ["series,t,rig_x,rig_y,rig_z,yaw,head_x,head_y,head_z,pitch,head_yaw,roll,left_x,left_y,left_z,right_x,right_y,right_z,seq,tracked,is_vr"];
  for (const [name, trace] of Object.entries(traces)) {
    for (const s of trace) {
      rows.push([name, s.t.toFixed(2), ...s.rig, s.yaw, ...s.head, s.pitch, s.headYaw, s.roll, ...s.left, ...s.right, s.seq ?? "", s.tracked ?? "", s.isVR ?? ""].join(","));
    }
  }
  return rows.join("\n") + "\n";
}
