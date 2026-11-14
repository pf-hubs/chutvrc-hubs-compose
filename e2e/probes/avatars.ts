// Avatar probe (T4.5 to T4.7): which model a page shows for a client, how its rig was mapped, where its
// neck and name tag are, and how many avatar models the page holds. Reads the avatar sync's model manager
// (APP.sfu.avatarSync.models), the solvers (APP.world.eid2Ik, whose managers keep the rig description) and
// the remote avatar entities' name tags. The model manager and rig descriptions came with the avatar
// refactor; on an older build the probe throws NotApplicable.
import type { Page } from "@playwright/test";
import { NotApplicable } from "./compat";
import type { Client } from "../clients/launch";

export type AvatarState = {
  clientId: string;
  /** The avatar id the page last loaded for the client (a URL, a reticulum avatar id, or "default-avatar" after a fallback) */
  avatarId: string | null;
  loading: boolean;
  /** The avatar entity, when a model is shown */
  eid: number | null;
  /** "vrm" or "keywords": how the rig's bones were found */
  rigSource: string | null;
  /** The bones the rig description resolved, and the ones it did not */
  bones: string[];
  missingBones: string[];
  /** World positions (metres) of a few bones of the client's model */
  hips: [number, number, number] | null;
  neck: [number, number, number] | null;
  head: [number, number, number] | null;
  leftHand: [number, number, number] | null;
  /** The name tag of the client's remote avatar entity: world position and whether it is shown */
  nameTag: [number, number, number] | null;
  nameTagVisible: boolean | null;
};

export type AvatarCounts = {
  /** Avatar entities with a solver (the own avatar included) */
  solvers: number;
  /** Direct children of the scene holding a skinned mesh: the loaded avatar models, the own one included */
  skinnedModels: number;
  /** Avatar entities by client, as the model manager has them */
  models: Record<string, number>;
};

const PAGE_CODE = `
  const APP = window.APP;
  const sync = APP && APP.sfu && APP.sfu.avatarSync;
  const models = sync && sync.models;
  if (!models || !models.avatarEidByClientId || !APP.world || !APP.world.eid2Ik) return { notApplicable: true };
  const V = AFRAME.THREE.Vector3;
  const world = o => { if (!o) return null; o.updateWorldMatrix(true, false); const v = new V().setFromMatrixPosition(o.matrixWorld); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
`;

/** How `page` shows `clientId`'s avatar */
export async function avatarState(page: Page, clientId: string): Promise<AvatarState> {
  const state = await page.evaluate(
    ({ code, clientId }) =>
      new Function(
        "clientId",
        code +
          `
  const eid = models.avatarEidByClientId.get(clientId);
  const ik = eid !== undefined ? APP.world.eid2Ik.get(eid) : undefined;
  const rig = ik && ik.rig;
  const bones = rig ? Object.entries(rig.bones) : [];
  // The client's remote avatar entity carries its client id (network-schemas.js); its name tag is a child
  let nameTag = null, nameTagVisible = null;
  for (const el of document.querySelectorAll("[name-tag]")) {
    let owner = el;
    while (owner && !(owner.getAttribute && owner.getAttribute("client-id"))) owner = owner.parentElement;
    if (!owner || owner.getAttribute("client-id") !== clientId) continue;
    nameTag = world(el.object3D);
    let shown = true;
    for (let o = el.object3D; o; o = o.parent) if (!o.visible) shown = false;
    nameTagVisible = shown;
  }
  return {
    clientId,
    avatarId: models.avatarIdOf ? models.avatarIdOf(clientId) ?? null : null,
    loading: models.isLoading ? models.isLoading(clientId) : false,
    eid: eid === undefined ? null : eid,
    rigSource: rig ? rig.source : null,
    bones: bones.filter(([, b]) => !!b).map(([n]) => n),
    missingBones: bones.filter(([, b]) => !b).map(([n]) => n),
    hips: rig ? world(rig.bones.hips) : null,
    neck: rig ? world(rig.bones.neck) : null,
    head: rig ? world(rig.bones.head) : null,
    leftHand: rig ? world(rig.bones.leftHand) : null,
    nameTag,
    nameTagVisible
  };`
      )(clientId),
    { code: PAGE_CODE, clientId }
  );
  if ((state as any).notApplicable) throw new NotApplicable("the avatar probe needs the avatar model manager (APP.sfu.avatarSync.models) and the solvers' rig descriptions");
  return state as AvatarState;
}

/** How many avatars `page` holds */
export async function avatarCounts(page: Page): Promise<AvatarCounts> {
  const counts = await page.evaluate(
    code =>
      new Function(
        code +
          `
  const scene = AFRAME.scenes[0].object3D;
  let skinnedModels = 0;
  for (const child of scene.children) {
    let skinned = false;
    child.traverse(o => { if (o.isSkinnedMesh) skinned = true; });
    if (skinned) skinnedModels++;
  }
  return { solvers: APP.world.eid2Ik.size, skinnedModels, models: Object.fromEntries([...models.avatarEidByClientId.entries()]) };`
      )(),
    PAGE_CODE
  );
  if ((counts as any).notApplicable) throw new NotApplicable("the avatar probe needs the avatar model manager (APP.sfu.avatarSync.models)");
  return counts as AvatarCounts;
}

/** Waits until `page` has loaded `avatarId` for `clientId` (or a fallback replaced it); returns the state and the time taken */
export async function waitForAvatar(page: Page, clientId: string, avatarId: string, timeoutMs = 30_000) {
  const t0 = Date.now();
  let state = await avatarState(page, clientId);
  // The manager records the avatar id once a load has finished: the one asked for, or "default-avatar" after a failed load
  const done = (s: AvatarState) => !s.loading && (s.avatarId === avatarId || s.avatarId === "default-avatar");
  while (!done(state) && Date.now() - t0 < timeoutMs) {
    await page.waitForTimeout(250);
    state = await avatarState(page, clientId);
  }
  return { state, ms: Date.now() - t0, loaded: done(state) };
}

/** The "Avatar of <id> mapped from <source>[, without <bones>]" lines a client logged since a point in its log */
export function mappedLines(client: Client, clientId: string, sinceT = 0): string[] {
  return client.log.filter(e => e.t >= sinceT && e.text.startsWith(`Avatar of ${clientId} mapped from`)).map(e => e.text);
}

/** Sets the client's avatar as a user does with a custom avatar URL: the profile's avatarId */
export async function setAvatar(client: Client, avatarId: string) {
  await client.page.evaluate(id => (window as any).APP.store.update({ profile: { avatarId: id } }), avatarId);
}

/** The client's own avatar id (profile) */
export function ownAvatarId(client: Client): Promise<string> {
  return client.page.evaluate(() => (window as any).APP.store.state.profile.avatarId);
}
