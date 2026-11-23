// Trial (e): an OLD-build client (hubs feature/sfu-refactor served by hubs-client-old on 8082) next
// to a new DESK client in one room.
// The old build's pages load their scripts from https://hubs.local:8080/ (its BASE_ASSETS_PATH),
// which on the host is the current client, so the old client's browser maps hubs.local:8080 to
// 127.0.0.1:8082 and opens the page through that name.
//   npx tsx trials/e-old.ts [url-form]   url-form: 8080 (default) | 8082 | 4000
import path from "node:path";
import { CLIENT_MEDIA, EVIDENCE, collectErrors, enterRoom, firstPage, launchClient, save, sleep, trialRoom } from "./common";
import { holdKey, pilot, recordPackets, remotePose, session } from "./probes";

const form = process.argv[2] ?? "8080";
const result: any = { form };
const old = await launchClient("old1", {
  position: [0, 0],
  extraArgs: ["--host-resolver-rules=MAP hubs.local:8080 127.0.0.1:8082"]
});
const desk = await launchClient("desk2", { position: [640, 360] });
const po = await firstPage(old);
const pd = await firstPage(desk);
const eo = collectErrors(po);
const ed = collectErrors(pd);
const scripts: string[] = [];
po.on("response", r => {
  if (r.request().resourceType() === "script" && /hubs\.local/.test(r.url())) scripts.push(`${r.status()} ${r.url().slice(0, 120)}`);
});

try {
  const hubId = await trialRoom(pd, "old");
  result.hubId = hubId;
  await enterRoom(pd, hubId, { displayName: "desk2" });
  if (form === "4000") {
    result.entry = await enterRoom(po, hubId, { displayName: "old1" });
  } else {
    // hub.html?hub_id= is how the client is opened straight from its own dev server
    result.entry = await enterRoom(po, `hub.html?hub_id=${hubId}`, { displayName: "old1", base: `https://hubs.local:${form}` });
  }
  await sleep(4000);
  result.oldPage = await po.evaluate(() => {
    const APP = (window as any).APP;
    return {
      href: location.href,
      hasAvatarPoses: !!APP.avatarPoses,
      hasSfu: !!APP.sfu,
      hasBus: !!APP.sfu?.bus,
      sfuId: APP.sfu?.sfuId,
      isConnected: APP.sfu?.isConnected,
      clientId: APP.sfu?.clientId
    };
  });
  result.scripts = scripts.filter(s => /\/assets\/js\/(hub|vendors|app)/.test(s)).slice(0, 8);
  result.newSession = await session(pd);
  if (result.oldPage.hasBus) result.oldPackets = await recordPackets(po, 3000);
  result.newPackets = await recordPackets(pd, 3000);
  const oldId = result.oldPage.clientId;
  result.audio = {
    newHearsOld: await pilot(pd, oldId, CLIENT_MEDIA.old1.pilotHz, CLIENT_MEDIA.desk3.pilotHz),
    oldHearsNew: await pilot(po, result.newSession.clientId, CLIENT_MEDIA.desk2.pilotHz, CLIENT_MEDIA.desk3.pilotHz).catch(e => String(e))
  };
  const before = await remotePose(pd, oldId);
  await holdKey(po, "w", 1500);
  await sleep(500);
  result.newSeesOld = { before, after: await remotePose(pd, oldId) };
  await po.screenshot({ path: path.join(EVIDENCE, `e-old-${form}-old.png`) });
  await pd.screenshot({ path: path.join(EVIDENCE, `e-old-${form}-new.png`) });
} catch (e) {
  result.error = String(e);
  result.scripts = scripts.slice(0, 10);
  await po.screenshot({ path: path.join(EVIDENCE, `e-old-${form}-error.png`) }).catch(() => {});
} finally {
  result.errors = { old: eo.slice(0, 20), new: ed.slice(0, 20) };
  console.log(JSON.stringify(result, null, 1));
  save(`e-old-${form}.json`, result);
  await old.close();
  await desk.close();
}
