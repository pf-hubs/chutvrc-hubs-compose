// What each simulated client sends (plan 2.5): its microphone plays a speech-like clip with a pilot
// beep at its own frequency, and its camera shows a flat colour with its letter. assets/generate.ts
// makes the files from this table; clients/launch.ts points the fake devices at them.
import path from "node:path";
import { CLIPS_DIR } from "../lib/env";

export type MediaSlot = { pilotHz: number; colour: string };

/** One slot per client of a test (A, B, C, ...), not per account: two clients never share a pilot */
export const MEDIA_SLOTS = {
  a: { pilotHz: 700, colour: "red" },
  b: { pilotHz: 1100, colour: "green" },
  c: { pilotHz: 1500, colour: "blue" },
  d: { pilotHz: 1900, colour: "orange" },
  e: { pilotHz: 2300, colour: "purple" },
  f: { pilotHz: 2700, colour: "teal" },
  g: { pilotHz: 900, colour: "navy" },
  h: { pilotHz: 1300, colour: "maroon" },
  i: { pilotHz: 1700, colour: "olive" }
} satisfies Record<string, MediaSlot>;

export type SlotName = keyof typeof MEDIA_SLOTS;

/** A frequency no clip carries: the audio probe's control */
export const CONTROL_HZ = 3100;

export const PILOT = {
  /** Each beep lasts this long, once a second */
  beepMs: 250,
  clipSeconds: 10
};

export const clipPath = (slot: SlotName, kind: "wav" | "y4m") => path.join(CLIPS_DIR, `${slot}.${kind}`);
