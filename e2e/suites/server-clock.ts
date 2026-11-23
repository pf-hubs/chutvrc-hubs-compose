// Keeps reticulum's clock close to this PC's during a long run (lib/stack.ts serverClockLag, README "Where the
// local stack differs"). The global setup checks it once, at the start of a run; a full run of every suite
// takes hours, and the long-running server's clock falls behind by about 3 s a minute on this PC, so the
// 5-minute permission token would look expired before the run ends and nobody could enter a room. Before a
// test the clock is measured again when CHECK_EVERY_MS have passed since the last measurement (kept in a
// file of the run folder, which outlives the worker process), and reticulum is restarted when it is behind
// by more than MAX_LAG_SECONDS. A long test (the soak, the mixed room) asks for a fresh measurement with a
// lower limit before it starts.
import fs from "node:fs";
import path from "node:path";
import { readFixtures } from "../lib/fixtures";
import { restartReticulum, serverClockLag } from "../lib/stack";
import { runDir } from "../report/evidence";

const CHECK_EVERY_MS = 10 * 60_000;
const MAX_LAG_SECONDS = 45;

type ClockState = { checkedAt: number; lag: number };

const stateFile = () => path.join(runDir(), ".server-clock.json");

function readState(): ClockState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Measures reticulum's clock when it is due (or when `force` is set) and restarts reticulum when it is
 * behind by more than `maxLagSeconds`. Returns a line for the test's notes when it measured, null when
 * it did not; never throws (a failed measurement is reported in the line).
 */
export async function guardServerClock(opts: { force?: boolean; maxLagSeconds?: number } = {}): Promise<string | null> {
  const maxLag = opts.maxLagSeconds ?? MAX_LAG_SECONDS;
  const state = readState();
  if (!opts.force && state && Date.now() - state.checkedAt < CHECK_EVERY_MS) return null;
  try {
    const hubId = readFixtures().rooms["dialog-main"].hubId;
    let lag = await serverClockLag(hubId);
    let line = `reticulum's clock ${lag} s behind this PC before the test`;
    if (lag > maxLag) {
      await restartReticulum();
      lag = await serverClockLag(hubId);
      line += `: over ${maxLag} s, reticulum restarted, now ${lag} s`;
    }
    fs.writeFileSync(stateFile(), JSON.stringify({ checkedAt: Date.now(), lag } satisfies ClockState));
    return line;
  } catch (e) {
    return `reticulum's clock could not be measured before the test: ${(e as Error).message.split("\n")[0]}`;
  }
}
