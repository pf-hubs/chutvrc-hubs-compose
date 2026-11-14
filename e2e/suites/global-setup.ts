// Runs once before the tests: stops when the stack cannot give valid results, then records run.json.
import fs from "node:fs";
import { request } from "@playwright/test";
import { BASE_URL, FIXTURES_FILE } from "../lib/env";
import { lanAddressProblem, restartReticulum, serverClockLag } from "../lib/stack";
import { readFixtures } from "../lib/fixtures";
import { clipPath, MEDIA_SLOTS, type SlotName } from "../assets/media";
import { runDir, writeRunInfo } from "../report/evidence";

const MAX_CLOCK_LAG_SECONDS = 60;

export default async function globalSetup() {
  // Plan 1.2: Dialog and the local LiveKit server announce this address; a stale one breaks media
  const lan = lanAddressProblem();
  if (lan) throw new Error(`${lan}. Fix .env in the compose root and recreate dialog (and livekit) before running tests.`);

  const api = await request.newContext({ ignoreHTTPSErrors: true });
  const meta = await api.get(`${BASE_URL}/api/v1/meta`).catch(e => e as Error);
  await api.dispose();
  if (meta instanceof Error || !meta.ok()) {
    throw new Error(`reticulum does not answer at ${BASE_URL} (${meta instanceof Error ? meta.message : meta.status()}): start the stack first`);
  }
  if (!fs.existsSync(FIXTURES_FILE)) throw new Error("e2e/fixtures.json is missing: run npx tsx setup/create-fixtures.ts");
  for (const slot of Object.keys(MEDIA_SLOTS) as SlotName[]) {
    if (!fs.existsSync(clipPath(slot, "wav"))) throw new Error("the clips are missing: run npx tsx assets/generate.ts");
  }

  // Reticulum's clock drifts behind on this PC (lib/stack.ts serverClockLag); past 300 s nobody can enter
  const probeRoom = readFixtures().rooms["dialog-main"].hubId;
  let lag = await serverClockLag(probeRoom);
  if (lag > MAX_CLOCK_LAG_SECONDS) {
    console.log(`reticulum's clock is ${lag} s behind: restarting reticulum`);
    await restartReticulum();
    lag = await serverClockLag(probeRoom);
    if (lag > MAX_CLOCK_LAG_SECONDS) throw new Error(`reticulum's clock is still ${lag} s behind after a restart`);
  }
  process.env.E2E_SERVER_CLOCK_LAG = String(lag);

  await writeRunInfo();
  console.log(`evidence of this run: ${runDir()}`);
}
