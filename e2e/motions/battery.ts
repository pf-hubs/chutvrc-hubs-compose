// The headset motions of plan 2.4 (M1 to M10) for T5, and their desktop equivalents.
//
// Each motion is written as the pose the client should send, in the rig's space (metres, -z ahead): the
// head as the eyes of a person 1.73 m tall (eye height 1.62 m, turning about a neck pivot 10 cm below and
// 8 cm behind the eyes), the hands as the controllers held in the fist (shoulders at +-0.19 m, 1.43 m high,
// 0.63 m from the shoulder to the controller at full reach). Phases ease in and out; the timeline is sampled
// every few tens of milliseconds and turned into the emulated devices' poses (clients/motion.ts
// deviceFromClient), so the client sends the written pose. Angles are degrees: yaw (left positive), pitch
// (up positive), roll.
//
// `tellAtMs` is the moment the contact sheet shows: the pose that says most about the solvers in that motion.
//   npx tsx motions/battery.ts          writes every timeline as JSON next to this file (git ignores them)
import fs from "node:fs";
import path from "node:path";
import { deviceFromClient, rotate, yawPitchRoll, type Keyframe, type Quat, type Timeline, type Vec3 } from "../clients/motion";

type Part = { pos: Vec3; ypr: Vec3 };
type Hand = Part & { connected?: boolean; stick?: [number, number] };
export type Body = { head: Part; left: Hand; right: Hand };

export type MotionId = "m01" | "m02" | "m03" | "m04" | "m05" | "m06" | "m07" | "m08" | "m09" | "m10" | "h1";

export type Motion = {
  id: MotionId;
  title: string;
  /** What the motion does, in a sentence */
  summary: string;
  /** The emulated devices' timeline the player runs */
  timeline: Timeline;
  /** The same timeline as the poses the client should send (for the evidence) */
  client: Timeline;
  tellAtMs: number;
  tellWhat: string;
};

// ---------- A body ----------

const NECK_PIVOT: Vec3 = [0, 1.52, 0.08];
const EYES_FROM_PIVOT: Vec3 = [0, 0.1, -0.08];
const BODY_CENTRE: Vec3 = [0, 0, 0.05];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const smooth = (u: number) => u * u * (3 - 2 * u);

/** The eyes looking in a direction, turned about the neck pivot (which may itself be moved) */
export function look(yaw: number, pitch = 0, roll = 0, pivot: Vec3 = NECK_PIVOT): Part {
  return { pos: add(pivot, rotate(yawPitchRoll(yaw, pitch, roll), EYES_FROM_PIVOT)), ypr: [yaw, pitch, roll] };
}

/** Standing, looking ahead, controllers held in front at waist height, pointing ahead and a little down */
export const STAND: Body = {
  head: look(0),
  left: { pos: [-0.22, 1.08, -0.28], ypr: [-8, -20, 0], connected: true },
  right: { pos: [0.22, 1.08, -0.28], ypr: [8, -20, 0], connected: true }
};

/** The whole body turned about the vertical through its centre (a person turning on the spot) */
function turnBody(body: Body, degrees: number): Body {
  const q = yawPitchRoll(degrees);
  const turn = (p: Part): Part => ({ pos: add(BODY_CENTRE, rotate(q, sub(p.pos, BODY_CENTRE))), ypr: [p.ypr[0] + degrees, p.ypr[1], p.ypr[2]] });
  return { head: turn(body.head), left: { ...body.left, ...turn(body.left) }, right: { ...body.right, ...turn(body.right) } };
}

function lerpPart<P extends Part>(a: P, b: P, u: number): P {
  return { ...a, pos: lerp3(a.pos, b.pos, u), ypr: lerp3(a.ypr, b.ypr, u) };
}

// ---------- Phases ----------

/**
 * A phase lasts `ms`: it eases from the pose the previous phase ended in to `to` (parts not given hold), or
 * runs `along(u, from)` for u from 0 to 1. A hand's connected flag and thumbstick take the phase's value for
 * the whole phase.
 */
type Phase = { ms: number; to?: Partial<Body>; along?: (u: number, from: Body) => Body; ease?: "smooth" | "linear" };

const hold = (ms: number): Phase => ({ ms });
const go = (ms: number, to: Partial<Body>, ease: "smooth" | "linear" = "smooth"): Phase => ({ ms, to, ease });

function bodyAt(phases: Phase[], t: number): Body {
  let from = STAND;
  let start = 0;
  for (const phase of phases) {
    const end = start + phase.ms;
    const u = phase.ms > 0 ? Math.min(1, Math.max(0, (t - start) / phase.ms)) : 1;
    const target = endOf(phase, from);
    if (t < end) return phase.along ? phase.along(u, from) : blend(from, target, phase.ease === "linear" ? u : smooth(u), u > 0);
    from = target;
    start = end;
  }
  return from;
}

function endOf(phase: Phase, from: Body): Body {
  if (phase.along) return phase.along(1, from);
  const to = phase.to ?? {};
  return {
    head: to.head ?? from.head,
    left: { ...from.left, ...(to.left ?? {}), stick: to.left?.stick ?? [0, 0] },
    right: { ...from.right, ...(to.right ?? {}), stick: to.right?.stick ?? [0, 0] }
  };
}

function blend(from: Body, to: Body, u: number, started: boolean): Body {
  const hand = (a: Hand, b: Hand): Hand => ({
    ...lerpPart(a, b, u),
    connected: started ? b.connected : a.connected,
    stick: started ? b.stick : a.stick
  });
  return { head: lerpPart(from.head, to.head, u), left: hand(from.left, to.left), right: hand(from.right, to.right) };
}

const duration = (phases: Phase[]) => phases.reduce((a, p) => a + p.ms, 0);

/** Samples the phases into the client-side and the device timelines */
function build(id: MotionId, title: string, summary: string, phases: Phase[], tellAtMs: number, tellWhat: string, stepMs = 40): Motion {
  const total = duration(phases);
  const clientFrames: Keyframe[] = [];
  const deviceFrames: Keyframe[] = [];
  const times: number[] = [];
  for (let t = 0; t <= total + 1e-6; t += stepMs) times.push(Math.round(t));
  if (times[times.length - 1] !== total) times.push(total);
  // A hand's flag or stick changes exactly at a phase boundary, so the boundaries are sampled too
  let edge = 0;
  for (const p of phases) {
    edge += p.ms;
    if (!times.includes(edge)) times.push(edge);
  }
  times.sort((a, b) => a - b);
  for (const t of times) {
    const body = bodyAt(phases, t);
    const part = (p: Part) => ({ pos: p.pos.map(v => +v.toFixed(4)) as Vec3, quat: yawPitchRoll(...p.ypr).map(v => +v.toFixed(5)) as Quat });
    const hand = (h: Hand) => ({ ...part(h), connected: h.connected ?? true, stick: h.stick ?? [0, 0] });
    const client: Keyframe = { t, head: part(body.head), left: hand(body.left), right: hand(body.right) };
    clientFrames.push(client);
    deviceFrames.push({
      t,
      head: deviceFromClient("head", client.head!),
      left: deviceFromClient("left", client.left!),
      right: deviceFromClient("right", client.right!)
    });
  }
  return { id, title, summary, timeline: { name: `${id} ${title}`, keyframes: deviceFrames }, client: { name: `${id} ${title} (client poses)`, keyframes: clientFrames }, tellAtMs, tellWhat };
}

// ---------- M1 to M10 ----------

const LEAD = 1000;

function m01(): Motion {
  return build("m01", "stand still", "Standing still for 6 s with the controllers held in front at waist height; any change in the avatar is the solver's own.", [hold(6000)], 3000, "half way through");
}

function m02(): Motion {
  return build(
    "m02",
    "look around",
    "Head turns 70° left and right, looks up 35° and down 40°, tilts 15°, turning about the neck; the hands stay.",
    [
      hold(LEAD),
      go(1600, { head: look(70) }),
      hold(900),
      go(2400, { head: look(-70) }),
      hold(700),
      go(1200, { head: look(0) }),
      go(1000, { head: look(0, 35) }),
      hold(400),
      go(1400, { head: look(0, -40) }),
      hold(400),
      go(1000, { head: look(0, -5, 15) }),
      hold(400),
      go(1000, { head: look(0) }),
      hold(LEAD)
    ],
    LEAD + 1600 + 600,
    "looking 70° to the left"
  );
}

function m03(): Motion {
  const deep: Partial<Body> = {
    head: look(0, -10, 0, [0, 0.9, -0.02]),
    left: { pos: [-0.25, 0.72, -0.42], ypr: [-8, -25, 0], connected: true },
    right: { pos: [0.25, 0.72, -0.42], ypr: [8, -25, 0], connected: true }
  };
  const half: Partial<Body> = {
    head: look(0, -5, 0, [0, 1.2, 0.02]),
    left: { pos: [-0.24, 0.9, -0.36], ypr: [-8, -22, 0], connected: true },
    right: { pos: [0.24, 0.9, -0.36], ypr: [8, -22, 0], connected: true }
  };
  return build(
    "m03",
    "crouch",
    "Crouches until the eyes are 1.0 m high, holds, stands, then a half crouch (eyes at 1.3 m); the hands come down and forward.",
    [hold(LEAD), go(1500, deep), hold(2000), go(1500, STAND), hold(500), go(1000, half), hold(1000), go(1000, STAND), hold(LEAD)],
    LEAD + 1500 + 1000,
    "the deepest crouch (eyes 1.0 m high)"
  );
}

function m04(): Motion {
  const forward: Partial<Body> = {
    head: { pos: [0, 1.38, -0.42], ypr: [0, -35, 0] },
    left: { pos: [-0.22, 1.0, -0.62], ypr: [-6, -30, 0], connected: true },
    right: { pos: [0.22, 1.0, -0.62], ypr: [6, -30, 0], connected: true }
  };
  const side: Partial<Body> = {
    head: { pos: [0.28, 1.55, 0.0], ypr: [0, 0, -18] },
    left: { pos: [-0.05, 1.15, -0.26], ypr: [-8, -20, -15], connected: true },
    right: { pos: [0.42, 0.95, -0.14], ypr: [8, -20, -15], connected: true }
  };
  const back: Partial<Body> = { head: { pos: [0, 1.6, 0.15], ypr: [0, 15, 0] } };
  return build(
    "m04",
    "lean forward",
    "Bends forward at the hips (eyes 0.42 m forward and 0.24 m lower, looking down 35°), then leans to the right and back.",
    [hold(LEAD), go(1500, forward), hold(1500), go(1500, STAND), go(1200, side), hold(1000), go(1200, STAND), go(1000, back), hold(600), go(1000, STAND), hold(LEAD)],
    LEAD + 1500 + 750,
    "the full forward lean"
  );
}

function m05(): Motion {
  const forward: Partial<Body> = {
    left: { pos: [-0.2, 1.4, -0.62], ypr: [0, 0, 0], connected: true },
    right: { pos: [0.2, 1.4, -0.62], ypr: [0, 0, 0], connected: true }
  };
  const up: Partial<Body> = {
    head: look(0, 25),
    left: { pos: [-0.24, 2.02, -0.12], ypr: [0, 80, 0], connected: true },
    right: { pos: [0.24, 2.02, -0.12], ypr: [0, 80, 0], connected: true }
  };
  const behind: Partial<Body> = {
    head: look(-25),
    left: { pos: [0.12, 1.3, -0.45], ypr: [-40, 0, 0], connected: true },
    right: { pos: [0.34, 1.12, 0.3], ypr: [-150, -35, 0], connected: true }
  };
  const over: Partial<Body> = {
    head: look(0, -5, 0, [0, 1.5, -0.02]),
    left: { pos: [-0.2, 1.38, -0.8], ypr: [0, 0, 0], connected: true },
    right: { pos: [0.2, 1.38, -0.8], ypr: [0, 0, 0], connected: true }
  };
  return build(
    "m05",
    "reach forward, up and behind",
    "Both hands reach forward to full length, then straight up overhead, then the right hand behind the back while the left reaches across; last a reach 0.17 m beyond the arms' length.",
    [hold(LEAD), go(1000, forward), hold(1000), go(1200, up), hold(1000), go(1300, behind), hold(1200), go(1100, STAND), go(1000, over), hold(1000), go(1000, STAND), hold(LEAD)],
    LEAD + 1000 + 1000 + 1200 + 500,
    "both hands straight up overhead"
  );
}

function m06(): Motion {
  const chest: Partial<Body> = {
    head: look(0, -15),
    left: { pos: [-0.07, 1.3, -0.13], ypr: [-70, 10, 0], connected: true },
    right: { pos: [0.07, 1.3, -0.13], ypr: [70, 10, 0], connected: true }
  };
  const crossed: Partial<Body> = {
    head: look(0, -15),
    left: { pos: [0.11, 1.27, -0.15], ypr: [-75, 0, 0], connected: true },
    right: { pos: [-0.11, 1.32, -0.12], ypr: [75, 0, 0], connected: true }
  };
  const together: Partial<Body> = {
    head: look(0, -10),
    left: { pos: [-0.025, 1.24, -0.24], ypr: [-80, 50, 0], connected: true },
    right: { pos: [0.025, 1.24, -0.24], ypr: [80, 50, 0], connected: true }
  };
  return build(
    "m06",
    "hands near the chest",
    "Both hands come to the chest, then the arms cross (each hand at the other shoulder's side), then the hands meet in front of the chest.",
    [hold(LEAD), go(1200, chest), hold(1200), go(1000, crossed), hold(1500), go(1000, together), hold(1200), go(1200, STAND), hold(LEAD)],
    LEAD + 1200 + 1200 + 1000 + 750,
    "arms crossed"
  );
}

function m07(): Motion {
  const snap = (x: number): Phase[] => [{ ms: 180, to: { right: { ...STAND.right, stick: [x, 0] } } }, hold(1200)];
  return build(
    "m07",
    "snap turn",
    "Two snap turns to the left and two to the right with the right thumbstick, then a physical turn of 100° on the spot and back.",
    [
      hold(LEAD),
      ...snap(-1),
      ...snap(-1),
      ...snap(1),
      ...snap(1),
      { ms: 1500, along: (u, from) => turnBody(from, 100 * smooth(u)) },
      hold(1000),
      { ms: 1500, along: (u, from) => turnBody(STAND, 100 * (1 - smooth(u))) },
      hold(LEAD)
    ],
    LEAD + 4 * 1380 + 1500 + 500,
    "turned 100° on the spot"
  );
}

function m08(): Motion {
  const stick = (x: number, y: number, ms: number): Phase[] => [{ ms, to: { left: { ...STAND.left, stick: [x, y] } } }, hold(900)];
  return build(
    "m08",
    "walk with the thumbstick",
    "Walks forward, right, back and left with the left thumbstick at 30%, 0.45 s each, pausing in between.",
    [hold(LEAD), ...stick(0, -0.3, 450), ...stick(0.3, 0, 450), ...stick(0, 0.3, 450), ...stick(-0.3, 0, 450), hold(LEAD)],
    LEAD + 300,
    "walking forward"
  );
}

function m09(): Motion {
  const raised: Partial<Body> = { left: { pos: [-0.3, 1.55, -0.35], ypr: [-10, 30, 0], connected: true } };
  const wave = (u: number, from: Body): Body => ({
    ...from,
    left: { ...from.left, connected: false },
    right: { ...from.right, pos: [STAND.right.pos[0] + 0.2 * Math.sin(2 * Math.PI * 1 * u * 3), STAND.right.pos[1] + 0.15, STAND.right.pos[2]] }
  });
  return build(
    "m09",
    "one controller loses and regains tracking",
    "The left controller is raised, then loses tracking for 3 s while the right hand waves; it comes back at waist height, so the hand has to jump there.",
    [
      hold(LEAD),
      go(1000, raised),
      hold(700),
      { ms: 3000, along: wave },
      { ms: 0, to: { left: { ...STAND.left, connected: true } } },
      hold(1500),
      hold(LEAD)
    ],
    LEAD + 1000 + 700 + 1500,
    "the left controller untracked (last seen raised)",
    20
  );
}

function m10(): Motion {
  const swing = (u: number): Body => {
    const s = 3 * u;
    const phase = 2 * Math.PI * 2.5 * s;
    return {
      head: look(0, -10),
      left: { pos: [-0.22, 1.12 + 0.18 * Math.sin(phase), -0.3 - 0.1 * Math.cos(phase)], ypr: [-8, -10 + 45 * Math.sin(phase), 0], connected: true },
      right: { pos: [0.22, 1.12 - 0.18 * Math.sin(phase), -0.3 + 0.1 * Math.cos(phase)], ypr: [8, -10 - 45 * Math.sin(phase), 0], connected: true }
    };
  };
  const guard: Partial<Body> = {
    head: look(0),
    left: { pos: [-0.18, 1.35, -0.16], ypr: [0, 20, 0], connected: true },
    right: { pos: [0.18, 1.35, -0.16], ypr: [0, 20, 0], connected: true }
  };
  const punch = (side: "left" | "right"): Phase[] => {
    const x = side === "left" ? -0.12 : 0.12;
    return [
      { ms: 120, to: { [side]: { pos: [x, 1.42, -0.64], ypr: [0, 0, 0], connected: true } } as Partial<Body>, ease: "linear" },
      { ms: 200, to: { [side]: guard[side] } as Partial<Body> },
      hold(180)
    ];
  };
  return build(
    "m10",
    "fast hand swings",
    "The forearms swing up and down at 2.5 Hz for 3 s (hands up to 3 m/s), then six alternating punches, each reaching full length in 120 ms.",
    [
      hold(LEAD),
      go(300, swing(0)),
      { ms: 3000, along: u => swing(u) },
      go(400, guard),
      ...punch("right"),
      ...punch("left"),
      ...punch("right"),
      ...punch("left"),
      ...punch("right"),
      ...punch("left"),
      go(600, STAND),
      hold(LEAD)
    ],
    LEAD + 300 + 3000 + 400 + 2 * 500 + 120,
    "the right fist at the end of a punch",
    20
  );
}

export const VR_MOTIONS: (() => Motion)[] = [m01, m02, m03, m04, m05, m06, m07, m08, m09, m10];

export function vrMotion(id: MotionId): Motion {
  const make = VR_MOTIONS.find(m => m().id === id);
  if (!make) throw new Error(`no headset motion ${id}`);
  return make();
}

// ---------- Desktop ----------

/**
 * The desktop equivalents a DESK subject can do: stand still, look around with the mouse, snap turns with
 * Q and E plus a turn by mouse, walk with W A S D. The rest need a headset and are not run on desktop.
 */
export type DesktopStep =
  | { kind: "wait"; ms: number }
  | { kind: "look"; dx: number; dy: number; ms: number }
  | { kind: "key"; key: string; ms: number }
  | { kind: "mark" };

export type DesktopMotion = { id: MotionId; title: string; summary: string; steps: DesktopStep[]; tellWhat: string };

/**
 * Pixels of a left-button drag per degree of the first-person view's turn, measured on this client
 * (TRIALS.md, step 7: 420 px to the left turned it 118°, 200 px up 61.5°)
 */
export const DRAG_PER_DEGREE = { yaw: 420 / 118, pitch: 200 / 61.5 };

export const DESKTOP_MOTIONS: DesktopMotion[] = [
  { id: "m01", title: "stand still", summary: "No input for 6 s.", steps: [{ kind: "wait", ms: 3000 }, { kind: "mark" }, { kind: "wait", ms: 3000 }], tellWhat: "half way through" },
  {
    id: "m02",
    title: "look around",
    summary: "Mouse drags: 70° to the left and to the right, back, 35° up and 40° down, back to the middle.",
    steps: [
      { kind: "wait", ms: LEAD },
      { kind: "look", dx: -DRAG_PER_DEGREE.yaw * 70, dy: 0, ms: 900 },
      { kind: "mark" },
      { kind: "wait", ms: 700 },
      { kind: "look", dx: DRAG_PER_DEGREE.yaw * 140, dy: 0, ms: 1500 },
      { kind: "wait", ms: 500 },
      { kind: "look", dx: -DRAG_PER_DEGREE.yaw * 70, dy: 0, ms: 900 },
      { kind: "look", dx: 0, dy: -DRAG_PER_DEGREE.pitch * 35, ms: 700 },
      { kind: "wait", ms: 400 },
      { kind: "look", dx: 0, dy: DRAG_PER_DEGREE.pitch * 75, ms: 1000 },
      { kind: "wait", ms: 400 },
      { kind: "look", dx: 0, dy: -DRAG_PER_DEGREE.pitch * 40, ms: 600 },
      { kind: "wait", ms: LEAD }
    ],
    tellWhat: "looking to the left"
  },
  {
    id: "m07",
    title: "snap turn",
    summary: "Q twice and E twice (snap turns), then the view turned 100° to the left by a mouse drag and back.",
    steps: [
      { kind: "wait", ms: LEAD },
      { kind: "key", key: "q", ms: 120 },
      { kind: "wait", ms: 1200 },
      { kind: "key", key: "q", ms: 120 },
      { kind: "wait", ms: 1200 },
      { kind: "key", key: "e", ms: 120 },
      { kind: "wait", ms: 1200 },
      { kind: "key", key: "e", ms: 120 },
      { kind: "wait", ms: 1200 },
      { kind: "look", dx: -DRAG_PER_DEGREE.yaw * 100, dy: 0, ms: 1200 },
      { kind: "mark" },
      { kind: "wait", ms: 1000 },
      { kind: "look", dx: DRAG_PER_DEGREE.yaw * 100, dy: 0, ms: 1200 },
      { kind: "wait", ms: LEAD }
    ],
    tellWhat: "view turned to the left by the mouse"
  },
  {
    id: "m08",
    title: "walk",
    summary: "W, D, S and A held for 0.3 s each, pausing in between.",
    steps: [
      { kind: "wait", ms: LEAD },
      { kind: "key", key: "w", ms: 150 },
      { kind: "mark" },
      { kind: "key", key: "w", ms: 150 },
      { kind: "wait", ms: 900 },
      { kind: "key", key: "d", ms: 300 },
      { kind: "wait", ms: 900 },
      { kind: "key", key: "s", ms: 300 },
      { kind: "wait", ms: 900 },
      { kind: "key", key: "a", ms: 300 },
      { kind: "wait", ms: LEAD }
    ],
    tellWhat: "walking forward"
  }
];

if (process.argv[1]?.replace(/\\/g, "/").endsWith("motions/battery.ts")) {
  for (const make of VR_MOTIONS) {
    const m = make();
    const file = path.join(import.meta.dirname, `${m.id}-${m.title.replace(/[^a-z0-9]+/gi, "-")}.json`);
    fs.writeFileSync(file, JSON.stringify({ id: m.id, title: m.title, summary: m.summary, tellAtMs: m.tellAtMs, tellWhat: m.tellWhat, device: m.timeline, client: m.client }));
    console.log(`${file}: ${m.timeline.keyframes.length} keyframes, ${(m.timeline.keyframes.at(-1)!.t / 1000).toFixed(1)} s`);
  }
}
