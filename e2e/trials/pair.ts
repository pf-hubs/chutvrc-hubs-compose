// Trial helper and probe sanity check (D): two DESK clients in one room. Reports the session of
// each, whether each detects the other's pilot through APP.sfu.getMediaStream, whether A's walk
// reaches B's copy of A's pose, and what the packet log records.
//   npx tsx trials/pair.ts <room key in fixtures.trials, or a hub id> [--label=name]
import path from "node:path";
import { CLIENT_MEDIA, EVIDENCE, collectErrors, enterRoom, firstPage, launchClient, readFixtures, save, sleep, trialRoom } from "./common";
import { holdKey, pilot, recordPackets, remotePose, session } from "./probes";

export async function runPair(hubIdOrKey: string, label: string, opts: { headless?: boolean } = {}) {
  const result: any = { label };
  const a = await launchClient("desk1", { position: [0, 0], headless: opts.headless });
  const b = await launchClient("desk2", { position: [640, 360], headless: opts.headless });
  const pa = await firstPage(a);
  const pb = await firstPage(b);
  const ea = collectErrors(pa);
  const eb = collectErrors(pb);
  try {
    const fixtures = readFixtures();
    const hubId = fixtures.trials?.[hubIdOrKey] ?? (/^[A-Za-z0-9]{7}$/.test(hubIdOrKey) ? hubIdOrKey : await trialRoom(pa, hubIdOrKey));
    result.hubId = hubId;
    result.entry = await Promise.all([
      enterRoom(pa, hubId, { displayName: "desk1" }),
      enterRoom(pb, hubId, { displayName: "desk2" })
    ]);
    await sleep(4000);
    const [sa, sb] = [await session(pa), await session(pb)];
    result.session = { a: sa, b: sb };
    result.audio = {
      bHearsA: await pilot(pb, sa.clientId, CLIENT_MEDIA.desk1.pilotHz, CLIENT_MEDIA.desk3.pilotHz),
      aHearsB: await pilot(pa, sb.clientId, CLIENT_MEDIA.desk2.pilotHz, CLIENT_MEDIA.desk3.pilotHz)
    };
    const before = await remotePose(pb, sa.clientId);
    await holdKey(pa, "w", 1500);
    await sleep(500);
    result.pose = { before, after: await remotePose(pb, sa.clientId) };
    result.packetsA = await recordPackets(pa, 3000);
    await pa.screenshot({ path: path.join(EVIDENCE, `pair-${label}-a.png`) });
    await pb.screenshot({ path: path.join(EVIDENCE, `pair-${label}-b.png`) });
  } catch (e) {
    result.error = String(e);
    await pa.screenshot({ path: path.join(EVIDENCE, `pair-${label}-a-error.png`) }).catch(() => {});
    await pb.screenshot({ path: path.join(EVIDENCE, `pair-${label}-b-error.png`) }).catch(() => {});
  } finally {
    result.errors = { a: ea.slice(0, 20), b: eb.slice(0, 20) };
    save(`pair-${label}.json`, result);
    await a.close();
    await b.close();
  }
  return result;
}

if (import.meta.main ?? process.argv[1]?.endsWith("pair.ts")) {
  const key = process.argv[2] ?? "pair";
  const label = process.argv.find(x => x.startsWith("--label="))?.slice(8) ?? key;
  const headless = process.argv.includes("--headless");
  console.log(JSON.stringify(await runPair(key, label, { headless }), null, 1));
}
