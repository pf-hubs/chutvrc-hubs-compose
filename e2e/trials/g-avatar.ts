// Trial (g): which URL form, put in the profile's avatarId, makes a full-body avatar load, on the
// own client and on an observer. Candidates:
//   assets   http://assets/avatars/<file>        e2e/assets served by the assets container, through the CORS proxy
//   assets-https  https://hubs.local:3001/avatars/<file>  the same files published on the host with TLS, fetched directly
//   public   https://raw.githubusercontent.com/...  a public URL, through the CORS proxy
//   upload   https://hubs.local:4000/files/<id>?token=...  uploaded to reticulum's media API (expires with the upload TTL)
//   npx tsx trials/g-avatar.ts
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { BASE, E2E, EVIDENCE, enterRoom, firstPage, launchClient, save, sleep, trialRoom } from "./common";
import { session } from "./probes";

const FILE = "VRM1_Constraint_Twist_Sample.vrm";
const PUBLIC =
  "https://raw.githubusercontent.com/vrm-c/vrm-specification/master/samples/VRM1_Constraint_Twist_Sample/vrm/VRM1_Constraint_Twist_Sample.vrm";

const result: any = { file: FILE, candidates: {} };
const a = await launchClient("desk1", { position: [0, 0] });
const b = await launchClient("desk2", { position: [640, 360] });
const pa = await firstPage(a);
const pb = await firstPage(b);
const logA: string[] = [];
const logB: string[] = [];
const keep = (into: string[]) => (m: any) => {
  const t = m.text();
  if (/Avatar of|avatar|Failed to load|fallback/i.test(t)) into.push(`${m.type()}: ${t.slice(0, 300)}`);
};
pa.on("console", keep(logA));
pb.on("console", keep(logB));

async function avatarState(page: Page, clientId: string) {
  return page.evaluate(clientId => {
    const APP = (window as any).APP;
    const models = APP.sfu.avatarSync.models;
    const eid = models.avatarEidByClientId.get(clientId);
    return { avatarId: models.avatarIdByClientId?.get(clientId) ?? null, eid: eid ?? null, ik: eid ? APP.world.eid2Ik.has(eid) : false };
  }, clientId);
}

try {
  const hubId = await trialRoom(pa, "avatar");
  result.hubId = hubId;
  await Promise.all([enterRoom(pa, hubId, { displayName: "desk1" }), enterRoom(pb, hubId, { displayName: "desk2" })]);
  await sleep(3000);
  const ida = (await session(pa)).clientId;
  result.defaultAvatar = { own: await avatarState(pa, ida), observer: await avatarState(pb, ida) };
  // Whether the observer ever gets the avatar the client entered with, without a change
  await sleep(10_000);
  result.defaultAvatarAfter13s = { observer: await avatarState(pb, ida), observerLog: logB.slice(0, 8), ownLog: logA.slice(0, 8) };

  // The upload form: the same API the client uses when a file is dropped in a room
  const upload = await pa.request.post(`${BASE}/api/v1/media`, {
    multipart: {
      media: { name: FILE, mimeType: "model/gltf-binary", buffer: fs.readFileSync(path.join(E2E, "assets", "avatars", FILE)) },
      promotion_mode: "with_token"
    }
  });
  const up = upload.ok() ? await upload.json() : null;
  result.upload = up ? { status: upload.status(), origin: up.origin, contentType: up.meta?.expected_content_type } : { status: upload.status(), body: (await upload.text()).slice(0, 200) };

  const candidates: Record<string, string> = {
    assets: `http://assets/avatars/${FILE}`,
    "assets-https": `https://hubs.local:3001/avatars/${FILE}`,
    public: PUBLIC
  };
  if (up) candidates.upload = `${up.origin}?token=${up.meta.access_token}`;

  for (const [name, url] of Object.entries(candidates)) {
    logA.length = 0;
    logB.length = 0;
    await pa.evaluate(url => (window as any).APP.store.update({ profile: { avatarId: url } }), url);
    const t0 = Date.now();
    let own: any, observer: any;
    while (Date.now() - t0 < 60_000) {
      await sleep(1000);
      own = await avatarState(pa, ida);
      observer = await avatarState(pb, ida);
      if (own.avatarId && observer.avatarId && own.avatarId === observer.avatarId) break;
    }
    result.candidates[name] = {
      url: name === "upload" ? url.replace(/token=.*/, "token=...") : url,
      seconds: Math.round((Date.now() - t0) / 1000),
      own,
      observer,
      ownLog: logA.slice(0, 6),
      observerLog: logB.slice(0, 6)
    };
    await pb.screenshot({ path: path.join(EVIDENCE, `g-avatar-${name}-observer.png`) });
  }
} catch (e) {
  result.error = String(e);
} finally {
  console.log(JSON.stringify(result, null, 1));
  save("g-avatar.json", result);
  await a.close();
  await b.close();
}
