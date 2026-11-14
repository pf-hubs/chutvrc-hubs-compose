// Runs once after the tests: puts the server's LiveKit setting back to what the global setup found,
// when the run's media server block switched it (lib/livekit.ts). MEDIA_BLOCK_RESTORE=0 leaves it, so
// several runs in one block do not restart reticulum twice each.
import { activeLiveKitBlock, setLiveKitBlock, type LiveKitBlock } from "../lib/livekit";

export default async function globalTeardown() {
  const before = process.env.E2E_LIVEKIT_BEFORE as LiveKitBlock | undefined;
  if (!before || process.env.MEDIA_BLOCK_RESTORE === "0") return;
  if (activeLiveKitBlock().block === before) return;
  console.log(`putting the LiveKit server setting back to ${before} (restarts reticulum)`);
  await setLiveKitBlock(before);
}
