// Explicit, logged workarounds for known product failures, so that a test whose subject is something
// else can still check that. A test about the failure itself must not use them.
import type { Evidence } from "../report/evidence";
import type { Client } from "./launch";

/**
 * Known failure: a client announces its avatar (#avatarId) once, right after entry, often before the
 * channel is open, so the others never load its model (T1, "The other's avatar is drawn"). Sending the
 * announcement again once the channels are open makes the others load it. Recorded in the evidence as
 * "workaround applied".
 */
export async function reannounceAvatars(clients: Client[], evidence: Evidence, why: string) {
  const sent: string[] = [];
  for (const c of clients) {
    const ok = await c.page
      .evaluate(() => {
        const sync = (window as any).APP?.sfu?.avatarSync;
        if (!sync) return false;
        sync.sendSelfAvatarSrc();
        return true;
      })
      .catch(() => false);
    if (ok) sent.push(c.name);
  }
  // The others start loading at once; the model is in the cache after the first load
  await clients[0]?.page.waitForTimeout(2000);
  evidence.note(
    `workaround applied: the avatar announcement (#avatarId) sent again by ${sent.join(", ") || "nobody"} after entry (known failure: the first one goes out before the channel is open), ${why}`
  );
  return sent;
}
