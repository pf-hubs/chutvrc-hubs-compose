// Trial (d): switching the LiveKit server between the Cloud block and the local block (plan 1.4).
// The switching itself now lives in lib/livekit.ts, which the harness uses for MEDIA_BLOCK; this script
// keeps the trial's commands working and adds the trial rooms.
//   npx tsx trials/d-livekit.ts read | local | cloud | unset | show    # as npx tsx lib/livekit.ts ...
//   npx tsx trials/d-livekit.ts room <key> [sfu]                       # a trial room on a media server
import { request } from "@playwright/test";
import { BASE, readFixtures, sql, writeFixtures } from "./common";
import { setLiveKitBlock, activeLiveKitBlock } from "../lib/livekit";

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const command = process.argv[2] ?? "show";

if (command === "room") {
  // The trial room <key> (created if needed) on media server sfu (0 Dialog, 2 LiveKit), set in the
  // database as the room settings' "WebRTC SFU" would set it
  const key = process.argv[3] ?? "livekit";
  const sfu = Number(process.argv[4] ?? 2);
  const fixtures = readFixtures();
  fixtures.trials ??= {};
  if (!fixtures.trials[key]) {
    const api = await request.newContext({ ignoreHTTPSErrors: true });
    const res = await api.post(`${BASE}/api/v1/hubs`, { data: { hub: { name: `trial ${key}` } } });
    fixtures.trials[key] = (await res.json()).hub_id;
    writeFixtures(fixtures);
    await api.dispose();
  }
  const hubId = fixtures.trials[key];
  sql(`update ret0.hubs set sfu = ${sfu} where hub_sid = ${lit(hubId)}`);
  console.log(key, hubId, "sfu", sql(`select sfu from ret0.hubs where hub_sid = ${lit(hubId)}`));
} else if (command === "local" || command === "cloud" || command === "unset") {
  const { changed } = await setLiveKitBlock(command);
  console.log(changed ? "switched; reticulum restarted" : "already set", activeLiveKitBlock().block);
} else if (command === "read") {
  // Saving the Cloud values from the server settings: npx tsx lib/livekit.ts read
  await import("../lib/livekit");
  console.log("use: npx tsx lib/livekit.ts read");
} else {
  console.log(activeLiveKitBlock().block);
}
