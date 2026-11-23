// The body solver on a screen device (fix F4, plan section 3: "T5, desktop; T7.2 phone; T7.3 iPhone"): with no
// height saved, a phone, tablet or desktop client enters without the body calibration step, sends no eye height,
// and an observer draws it with the screen solver at the model's own size. T7.2 and T7.3 run it.
import type { Evidence } from "../report/evidence";
import type { Client } from "../clients/launch";
import type { EntryTimings } from "../clients/enter";
import { bodyState, ownView } from "../probes/calibration";

/** The preferences T7.2 and T7.3 enter with: no height saved (a signed-in profile may keep one from a headset test) */
export const SCREEN_NO_HEIGHT = { bodyHeightCm: 0 };

export async function screenSolverCheck(evidence: Evidence, observer: Client, device: Client, deviceId: string, entry: EntryTimings | undefined, covers = "checklist-3") {
  await evidence.check("A screen device: no calibration step, the screen solver, the model's own size, no eye height announced", covers, async () => {
    const own = await ownView(device.page);
    const seen = await bodyState(observer.page, deviceId);
    const ok =
      entry?.calibration === "none" &&
      entry?.calibrationShown === undefined &&
      own.announced === null &&
      own.rigScale === 1 &&
      seen.eid !== null &&
      seen.solver === "screen" &&
      seen.announced === null &&
      seen.modelRatio === 1 &&
      seen.rootScale !== null &&
      Math.abs(seen.rootScale - 1) < 1e-4;
    return {
      ok,
      summary:
        `${device.name}: saved height ${own.preferences.bodyHeightCm}, entry calibration ${entry?.calibration ?? "?"} (form ${entry?.calibrationShown === undefined ? "not shown" : "shown"}), announces ${own.announced ?? "no eye height"}, rig scale ${own.rigScale}; ` +
        `${observer.name}: model ${seen.eid !== null ? "drawn" : "not drawn"}, ${seen.solver ?? "no"} solver, ratio ${seen.modelRatio ?? "–"}, root scale ${seen.rootScale ?? "–"}, eye height held ${seen.announced ?? "none"}`,
      data: { own, seen, entry }
    };
  });
}
