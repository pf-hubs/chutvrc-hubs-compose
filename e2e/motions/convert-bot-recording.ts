// H1 (plan 2.4): recorded human motion, converted from the bot's recording in the hubs repository
// (services/hubs/scripts/bot/bot-recording.json: 1,934 timestamped poses of the camera and both
// controllers, about 22 s, recorded in a headset). Each pose is the A-Frame position and rotation (degrees,
// YXZ) of the camera and controller entities in the rig's space, which is what the client sends; they become
// the emulated devices' poses through clients/motion.ts deviceFromClient, so the client sends the
// recorded pose again. The recording's button events are not replayed.
//   npx tsx motions/convert-bot-recording.ts [recording.json] [out.json]   (default: the hubs file, motions/h1.json)
import fs from "node:fs";
import path from "node:path";
import { REPOS } from "../lib/env";
import { deviceFromClient, yawPitchRoll, type Keyframe, type Quat, type Timeline, type Vec3 } from "../clients/motion";
import type { Motion } from "./battery";

export const BOT_RECORDING = path.join(REPOS.hubs, "scripts", "bot", "bot-recording.json");

type RecordedPose = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; timestamp: number };
type BotRecording = Record<"camera" | "left" | "right", { poses: RecordedPose[] }>;

const part = (p: RecordedPose) => ({
  pos: [p.position.x, p.position.y, p.position.z].map(v => +v.toFixed(4)) as Vec3,
  quat: yawPitchRoll(p.rotation.y, p.rotation.x, p.rotation.z).map(v => +v.toFixed(5)) as Quat
});

/** The recording as a timeline: `t` from the first camera pose; the parts are matched by index (they share time stamps) */
export function convertBotRecording(file = BOT_RECORDING): Motion {
  const recording: BotRecording = JSON.parse(fs.readFileSync(file, "utf8"));
  const camera = recording.camera.poses;
  const n = Math.min(camera.length, recording.left.poses.length, recording.right.poses.length);
  const t0 = camera[0].timestamp;
  const client: Keyframe[] = [];
  const device: Keyframe[] = [];
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const t = Math.round(camera[i].timestamp - t0);
    // A few poses share a time stamp; the player needs increasing times
    if (t <= lastT) continue;
    lastT = t;
    const head = part(camera[i]);
    const left = { ...part(recording.left.poses[i]), connected: true };
    const right = { ...part(recording.right.poses[i]), connected: true };
    client.push({ t, head, left, right });
    device.push({ t, head: deviceFromClient("head", head), left: deviceFromClient("left", left), right: deviceFromClient("right", right) });
  }
  // The telling moment: where a hand is farthest from the head (the most stretched arm of the recording)
  let tellAtMs = 0;
  let farthest = 0;
  for (const k of client) {
    for (const side of ["left", "right"] as const) {
      const d = Math.hypot(...k[side]!.pos.map((v, j) => v - k.head!.pos[j]));
      if (d > farthest) {
        farthest = d;
        tellAtMs = k.t;
      }
    }
  }
  const seconds = (client[client.length - 1].t / 1000).toFixed(1);
  return {
    id: "h1",
    title: "recorded human motion",
    summary: `The bot's headset recording (${client.length} poses of head and both hands over ${seconds} s), replayed as the client recorded it.`,
    timeline: { name: "h1 recorded human motion", keyframes: device } as Timeline,
    client: { name: "h1 recorded human motion (client poses)", keyframes: client } as Timeline,
    tellAtMs,
    tellWhat: `a hand farthest from the head (${(farthest * 100).toFixed(0)} cm)`
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("motions/convert-bot-recording.ts")) {
  const motion = convertBotRecording(process.argv[2] ?? BOT_RECORDING);
  const out = process.argv[3] ?? path.join(import.meta.dirname, "h1.json");
  fs.writeFileSync(out, JSON.stringify({ id: motion.id, title: motion.title, summary: motion.summary, tellAtMs: motion.tellAtMs, tellWhat: motion.tellWhat, device: motion.timeline, client: motion.client }));
  console.log(`${out}: ${motion.timeline.keyframes.length} keyframes; ${motion.summary} Telling moment at ${motion.tellAtMs} ms: ${motion.tellWhat}`);
}
