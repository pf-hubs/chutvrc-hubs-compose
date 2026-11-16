// The new solver on a screen device (fix F4, plan section 3: "T5, desktop; T7.2 phone; T7.3 iPhone"): with
// "Use the new avatar body solver (experimental)" on and no height saved, a phone, tablet or desktop client
// enters without the body calibration step, sends no eye height, and an observer with the new solver draws it
// with the screen solver at the model's own size. T7.2 and T7.3 run it when T7_NEW_SOLVER=1 (both the device
// and its observer then enter with the new solver on).
import type { Evidence } from "../report/evidence";
import type { Client } from "../clients/launch";
import type { EntryTimings } from "../clients/enter";
import { bodyState, ownView } from "../probes/calibration";

/** T7.2 and T7.3 with the new solver on for the device and the observer */
export const T7_NEW_SOLVER = process.env.T7_NEW_SOLVER === "1";
/** The preferences a client enters with for that run: the new solver on, no height saved */
export const SCREEN_NEW_SOLVER = { avatarIkV2: true, bodyHeightCm: 0 };

export async function screenSolverCheck(evidence: Evidence, observer: Client, device: Client, deviceId: string, entry: EntryTimings | undefined, covers = "checklist-3") {
  await evidence.check("New solver on a screen device: no calibration step, the screen solver, the model's own size, no eye height announced", covers, async () => {
    const own = await ownView(device.page);
    const seen = await bodyState(observer.page, deviceId);
    const ok =
      own.preferences.avatarIkV2 &&
      entry?.calibration === "none" &&
      entry?.calibrationShown === undefined &&
      own.announced === null &&
      own.rigScale === 1 &&
      seen.newSolver &&
      seen.eid !== null &&
      seen.solver === "screen" &&
      seen.announced === null &&
      seen.modelRatio === 1 &&
      seen.rootScale !== null &&
      Math.abs(seen.rootScale - 1) < 1e-4;
    return {
      ok,
      summary:
        `${device.name}: new solver ${own.preferences.avatarIkV2}, saved height ${own.preferences.bodyHeightCm}, entry calibration ${entry?.calibration ?? "?"} (form ${entry?.calibrationShown === undefined ? "not shown" : "shown"}), announces ${own.announced ?? "no eye height"}, rig scale ${own.rigScale}; ` +
        `${observer.name} (new solver ${seen.newSolver}): model ${seen.eid !== null ? "drawn" : "not drawn"}, ${seen.solver ?? "no new"} solver, ratio ${seen.modelRatio ?? "–"}, root scale ${seen.rootScale ?? "–"}, eye height held ${seen.announced ?? "none"}`,
      data: { own, seen, entry }
    };
  });
}
