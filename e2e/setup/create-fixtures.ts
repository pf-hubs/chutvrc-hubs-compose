// Creates what the tests need on this machine and writes e2e/fixtures.json (plan 1.5):
// - the accounts admin, member1, member2 (signed in through clients/signin.ts, never by e-mail), with
//   each DESK profile under profiles/ signed in;
// - the scene: assets/scenes/crater.glb published through the scene API as Spoke publishes one
//   (the local stack has no scenes or scene listings of its own);
// - the rooms of plan 1.5 with that scene, each created by the account that must own it, and the
//   media server set through the owner's hub channel with the message the Room Settings sidebar sends.
// Existing rooms and the scene are reused when they still exist. nimpro and bitecs are created but
// their special set-up is left to later steps (recorded as "todo").
//   npx tsx assets/generate.ts            # once, for the scene file
//   npx tsx setup/create-fixtures.ts
import fs from "node:fs";
import path from "node:path";
import { request, type APIRequestContext } from "@playwright/test";
import { BASE_URL, FIXTURES_FILE, HOST, sleep } from "../lib/env";
import { sql, sqlText } from "../lib/stack";
import { SFU_ID, writeFixtures, type AccountName, type Fixtures, type MediaServer, type RoomName } from "../lib/fixtures";
import { launchClient } from "../clients/launch";
import { ensureSignedIn, mintTokens, type SignedAccount } from "../clients/signin";
import { SCENE_FILE, SCENE_THUMBNAIL } from "../assets/generate";

const ROOMS: Record<RoomName, { owner: AccountName; mediaServer: MediaServer; todo?: string }> = {
  "dialog-main": { owner: "admin", mediaServer: "dialog" },
  "livekit-main": { owner: "admin", mediaServer: "livekit" },
  switch: { owner: "admin", mediaServer: "dialog" },
  "move-target-dialog": { owner: "admin", mediaServer: "dialog" },
  "move-target-livekit": { owner: "admin", mediaServer: "livekit" },
  "speak-x": { owner: "admin", mediaServer: "dialog" },
  "listen-y": { owner: "member1", mediaServer: "dialog" },
  "listen-z": { owner: "member2", mediaServer: "dialog" },
  nimpro: { owner: "admin", mediaServer: "dialog", todo: "a scene with waypoints N-impro-seat-01 to N-impro-seat-05 (built in Spoke)" },
  bitecs: { owner: "admin", mediaServer: "dialog", todo: "turn on the bitECS based client and the Behavior Graph add-on" }
};

const SCENE_NAME = "Crater e2e";
const SCENE_SOURCE = "services/spoke/test/fixtures/test-assets/crater.glb, wrapped by assets/generate.ts";

const previous: Partial<Fixtures> = fs.existsSync(FIXTURES_FILE) ? JSON.parse(fs.readFileSync(FIXTURES_FILE, "utf8")) : {};
if (!fs.existsSync(SCENE_FILE)) throw new Error("assets/scenes/crater.glb is missing: run npx tsx assets/generate.ts");

console.log("accounts: signing tokens in reticulum");
const accounts = mintTokens();
const api = await request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true });
const auth = (a: SignedAccount) => ({ authorization: `bearer ${a.token}` });

// Each DESK profile signed in, so tests start signed in
for (const account of Object.values(accounts)) {
  const client = await launchClient({ profile: "DESK", identity: account.name, slot: "a", headless: true });
  await ensureSignedIn(client, account.name, accounts);
  await client.close();
  console.log(`  ${account.name} ${account.email} account ${account.accountId}${account.isAdmin ? " (admin)" : ""}: profile desk-${account.name} signed in`);
}

const scene = await ensureScene(api, accounts.admin);
console.log(`scene: ${scene.sceneId} ${scene.name}`);

const rooms = {} as Fixtures["rooms"];
for (const [name, spec] of Object.entries(ROOMS) as [RoomName, (typeof ROOMS)[RoomName]][]) {
  const owner = accounts[spec.owner];
  const known = previous.rooms?.[name]?.hubId;
  let hubId = known && roomUsable(known, owner.accountId, scene.sceneId) ? known : "";
  if (!hubId) {
    hubId = await createRoom(api, owner, `e2e ${name}`, scene.sceneId);
    console.log(`room ${name}: created ${hubId} (owner ${spec.owner})`);
  } else {
    console.log(`room ${name}: reusing ${hubId}`);
  }
  rooms[name] = { hubId, owner: spec.owner, mediaServer: spec.mediaServer, sceneId: scene.sceneId, ...(spec.todo ? { todo: spec.todo } : {}) };
}

// Media server per room, through each owner's hub channel
for (const ownerName of ["admin", "member1", "member2"] as AccountName[]) {
  const todo = (Object.entries(rooms) as [RoomName, Fixtures["rooms"][RoomName]][]).filter(
    ([, r]) => r.owner === ownerName && Number(sql(`select sfu from ret0.hubs where hub_sid = ${sqlText(r.hubId)}`)) !== SFU_ID[r.mediaServer]
  );
  if (!todo.length) continue;
  const client = await launchClient({ profile: "DESK", identity: ownerName, slot: "a", headless: true });
  for (const [name, r] of todo) {
    await client.page.goto(`${BASE_URL}/${r.hubId}`, { waitUntil: "domcontentloaded" });
    await client.page.waitForFunction(() => (window as any).APP?.hubChannel?.channel?.state === "joined" && (window as any).APP?.hub, undefined, { timeout: 120_000 });
    const sent = await client.page.evaluate(sfu => {
      const APP = (window as any).APP;
      if (!APP.hubChannel.can("update_hub")) return "the owner cannot update this room";
      // The Room Settings sidebar submits the whole room object with the changed fields
      APP.hubChannel.updateHub({ ...APP.hub, sfu });
      return "sent";
    }, SFU_ID[r.mediaServer]);
    await sleep(1500);
    const now = Number(sql(`select sfu from ret0.hubs where hub_sid = ${sqlText(r.hubId)}`));
    console.log(`room ${name}: media server ${r.mediaServer} (${sent}; sfu now ${now})`);
    if (now !== SFU_ID[r.mediaServer]) throw new Error(`room ${name}: sfu is ${now}, expected ${SFU_ID[r.mediaServer]}`);
  }
  await client.close();
}

const fixtures: Fixtures = {
  host: HOST,
  scene,
  accounts: Object.fromEntries(
    Object.values(accounts).map(a => [a.name, { email: a.email, accountId: a.accountId, isAdmin: a.isAdmin }])
  ) as Fixtures["accounts"],
  rooms,
  ...(previous.trials ? { trials: previous.trials } : {})
};
writeFixtures(fixtures);
await api.dispose();
console.log(`wrote ${path.relative(process.cwd(), FIXTURES_FILE)}`);

/** The scene, published once: upload the model and thumbnail, then create the scene as the admin */
async function ensureScene(api: APIRequestContext, admin: SignedAccount): Promise<NonNullable<Fixtures["scene"]>> {
  // Reuse the scene of an earlier run: the one in fixtures.json, else the admin's newest scene of that name
  const known =
    previous.scene?.sceneId ||
    sql(
      `select scene_sid from ret0.scenes where name = ${sqlText(SCENE_NAME)} and account_id = ${admin.accountId} and state = 'active' order by inserted_at desc limit 1`
    );
  if (known && sql(`select count(*) from ret0.scenes where scene_sid = ${sqlText(known)} and state = 'active'`) === "1") {
    const res = await api.get(`/api/v1/scenes/${known}`);
    if (res.ok()) {
      const found = (await res.json()).scenes[0];
      return { sceneId: known, name: found.name, modelUrl: found.model_url, source: SCENE_SOURCE };
    }
  }
  const upload = async (file: string, mimeType: string) => {
    const res = await api.post("/api/v1/media", {
      headers: auth(admin),
      multipart: { media: { name: path.basename(file), mimeType, buffer: fs.readFileSync(file) } }
    });
    if (!res.ok()) throw new Error(`upload ${file}: ${res.status()} ${await res.text()}`);
    const body = await res.json();
    // As Spoke does: the upload's access token is the file token the scene API promotes with
    return { id: body.file_id as string, token: body.meta.access_token as string };
  };
  const model = await upload(SCENE_FILE, "model/gltf-binary");
  const shot = await upload(SCENE_THUMBNAIL, "image/jpeg");
  const res = await api.post("/api/v1/scenes", {
    headers: auth(admin),
    data: {
      scene: {
        name: SCENE_NAME,
        description: "Crater terrain from Spoke's test assets with a sun, sky, ambient light and eight spawn points",
        allow_remixing: false,
        // Promotion would announce the scene; nothing is announced from tests
        allow_promotion: false,
        attributions: { creator: "Mozilla (Spoke test assets)", content: [] },
        model_file_id: model.id,
        model_file_token: model.token,
        screenshot_file_id: shot.id,
        screenshot_file_token: shot.token
      }
    }
  });
  if (!res.ok()) throw new Error(`create scene: ${res.status()} ${await res.text()}`);
  const created = (await res.json()).scenes[0];
  return {
    sceneId: created.scene_id,
    name: SCENE_NAME,
    modelUrl: created.model_url,
    source: SCENE_SOURCE
  };
}

function roomUsable(hubId: string, ownerAccountId: string, sceneId: string): boolean {
  const row = sql(
    `select h.created_by_account_id, h.entry_mode, coalesce(s.scene_sid, '') from ret0.hubs h left join ret0.scenes s on s.scene_id = h.scene_id where h.hub_sid = ${sqlText(hubId)}`
  );
  const [owner, entryMode, scene] = row.split("\t");
  return owner === ownerAccountId && entryMode === "allow" && scene === sceneId;
}

/** Creates a room as the owner, as the home page's Create Room does, with the scene set */
async function createRoom(api: APIRequestContext, owner: SignedAccount, name: string, sceneId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    // The hub and scene APIs allow one request a second from an address, and answer 403 above that
    await sleep(1200);
    const res = await api.post("/api/v1/hubs", { headers: auth(owner), data: { hub: { name, scene_id: sceneId } } });
    if (res.ok()) return (await res.json()).hub_id;
    if (res.status() === 403 || res.status() === 429) continue;
    throw new Error(`create room ${name}: ${res.status()} ${await res.text()}`);
  }
  throw new Error(`create room ${name}: rate limited`);
}
