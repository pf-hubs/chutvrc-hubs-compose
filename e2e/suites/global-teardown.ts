// Runs once after the tests, also after a failed run or a failed global setup: puts the Features menu's admin
// settings back exactly as they were (lib/stack.ts), and the server's LiveKit setting back to what the global
// setup found, when the run's media server block switched it (lib/livekit.ts). MEDIA_BLOCK_RESTORE=0 leaves the
// LiveKit setting, so several runs in one block do not restart reticulum twice each.
import { restoreFeaturesAfterRun } from "../lib/stack";
import { activeLiveKitBlock, setLiveKitBlock, type LiveKitBlock } from "../lib/livekit";

async function restoreLiveKit() {
  const before = process.env.E2E_LIVEKIT_BEFORE as LiveKitBlock | undefined;
  if (!before || process.env.MEDIA_BLOCK_RESTORE === "0") return;
  if (activeLiveKitBlock().block === before) return;
  console.log(`putting the LiveKit server setting back to ${before} (restarts reticulum)`);
  await setLiveKitBlock(before);
}

export default async function globalTeardown() {
  try {
    if (restoreFeaturesAfterRun()) console.log("Features settings put back as they were before the run");
  } finally {
    await restoreLiveKit();
  }
}
