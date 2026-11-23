// Which tests run in this run's media server block (plan 1.4, lib/livekit.ts). A test is written for a
// media server, "dialog" or "livekit"; LiveKit tests run in whichever LiveKit block is active
// (MEDIA_BLOCK=livekit-local or livekit-cloud) and carry the block in their id, Dialog tests run in the
// Dialog block (MEDIA_BLOCK=dialog, the default).
import { test } from "./harness";
import { mediaBlock } from "../lib/livekit";
import type { MediaServer } from "../lib/fixtures";

export const BLOCK = mediaBlock();
export const ON_LIVEKIT = BLOCK !== "dialog";

/** The id part of a test on a media server in this block: dialog, livekit-local, livekit-cloud (livekit when not active) */
export function blockId(server: MediaServer): string {
  return server === "dialog" ? "dialog" : ON_LIVEKIT ? BLOCK : "livekit";
}

/** The title part: "Dialog", "LiveKit, local server", "LiveKit Cloud" */
export function blockTitle(server: MediaServer): string {
  if (server === "dialog") return "Dialog";
  return BLOCK === "livekit-local" ? "LiveKit, local server" : BLOCK === "livekit-cloud" ? "LiveKit Cloud" : "LiveKit";
}

/** Skips the test unless the run's block is for `server`; call first inside the test */
export function runsOn(server: MediaServer) {
  if (server === "dialog") test.skip(ON_LIVEKIT, `runs in the Dialog block (MEDIA_BLOCK=dialog); this run is ${BLOCK}`);
  else test.skip(!ON_LIVEKIT, "runs in a LiveKit block (MEDIA_BLOCK=livekit-local or livekit-cloud); this run is dialog");
}
