// A room recording (the toolbar's Recording button downloads "chutvrc-recording-<room>-<time>", JSON) as a
// timeline for the emulated headset: its sent #avatar-pose entries (s: 1), or those received from one
// client. Each entry's head and hands are in the rig's space (positions in metres, rotations as YXZ Euler
// angles in radians); the rig's own movement since the first entry (walking, turning) is folded into the
// head and hands, so a walk becomes a walk inside the play area. A hand whose tracked bit is clear becomes a
// disconnected controller (a desktop recording has none). The poses become the devices' through
// clients/motion.ts deviceFromClient, so the client sends them again.
//   npx tsx motions/convert-room-recording.ts <recording.json> [out.json] [--from <client id>]
import fs from "node:fs";
import path from "node:path";
import { deviceFromClient, rotate, yawPitchRoll, type Keyframe, type Quat, type Timeline, type Vec3 } from "../clients/motion";
import type { Motion } from "./battery";

type Xyz = { x: number; y: number; z: number };
type PoseMessage = {
  c: string;
  t: number;
  tracked: number;
  isVR: boolean;
  rig: { p: Xyz; r: Xyz };
  head: { p: Xyz; r: Xyz };
  left: { p: Xyz; r: Xyz };
  right: { p: Xyz; r: Xyz };
};
type Entry = { l: string; m: PoseMessage; t: number; s?: number };

const DEG = 180 / Math.PI;
const vec = (p: Xyz): Vec3 => [p.x, p.y, p.z];
const quatOf = (r: Xyz): Quat => yawPitchRoll(r.y * DEG, r.x * DEG, r.z * DEG);
const mul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
];
const inverse = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const round = <T extends number[]>(v: T, d: number) => v.map(x => +x.toFixed(d)) as T;

/** The sent poses of the recording (or those received from `from`) as a timeline */
export function convertRoomRecording(file: string, from?: string): Motion {
  const entries: Entry[] = JSON.parse(fs.readFileSync(file, "utf8"));
  const poses = entries
    .filter(e => e.l === "#avatar-pose" && e.m && (from ? e.s === 0 && e.m.c === from : e.s === 1))
    .sort((a, b) => a.t - b.t);
  if (poses.length < 2) throw new Error(`${file}: fewer than two ${from ? `pose entries received from ${from}` : "sent pose entries"}`);
  // The first rig pose is the play area's origin; later rig moves carry the parts with them
  const rig0 = poses[0].m.rig;
  const rig0Inverse = inverse(yawPitchRoll(rig0.r.y * DEG));
  const toPlayArea = (rig: PoseMessage["rig"], part: { p: Xyz; r: Xyz }) => {
    const rigQuat = yawPitchRoll(rig.r.y * DEG);
    const world = rotate(rigQuat, vec(part.p)).map((v, i) => v + vec(rig.p)[i]) as Vec3;
    const local = rotate(rig0Inverse, world.map((v, i) => v - vec(rig0.p)[i]) as Vec3);
    return { pos: round(local, 4), quat: round(mul(rig0Inverse, mul(rigQuat, quatOf(part.r))), 5) };
  };
  const t0 = poses[0].t;
  const client: Keyframe[] = [];
  const device: Keyframe[] = [];
  let lastT = -1;
  for (const { m, t: at } of poses) {
    const t = Math.round(at - t0);
    if (t <= lastT) continue;
    lastT = t;
    const head = toPlayArea(m.rig, m.head);
    const left = { ...toPlayArea(m.rig, m.left), connected: !!(m.tracked & 2) };
    const right = { ...toPlayArea(m.rig, m.right), connected: !!(m.tracked & 4) };
    client.push({ t, head, left, right });
    device.push({ t, head: deviceFromClient("head", head), left: deviceFromClient("left", left), right: deviceFromClient("right", right) });
  }
  const name = path.basename(file).replace(/\.json$/, "");
  const vr = poses.filter(p => p.m.isVR).length;
  return {
    id: "h1",
    title: `room recording ${name}`,
    summary: `${client.length} sent poses over ${(lastT / 1000).toFixed(1)} s from ${name}${from ? ` (received from ${from})` : ""}; ${vr} of them in VR.`,
    timeline: { name: `room recording ${name}`, keyframes: device } as Timeline,
    client: { name: `room recording ${name} (client poses)`, keyframes: client } as Timeline,
    tellAtMs: Math.round(lastT / 2),
    tellWhat: "half way through"
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("motions/convert-room-recording.ts")) {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  const from = fromAt >= 0 ? args.splice(fromAt, 2)[1] : undefined;
  const [file, outArg] = args;
  if (!file) throw new Error("usage: npx tsx motions/convert-room-recording.ts <recording.json> [out.json] [--from <client id>]");
  const motion = convertRoomRecording(file, from);
  const out = outArg ?? path.join(import.meta.dirname, `${path.basename(file).replace(/\.json$/, "")}.timeline.json`);
  fs.writeFileSync(out, JSON.stringify({ id: motion.id, title: motion.title, summary: motion.summary, tellAtMs: motion.tellAtMs, tellWhat: motion.tellWhat, device: motion.timeline, client: motion.client }));
  console.log(`${out}: ${motion.summary}`);
}
