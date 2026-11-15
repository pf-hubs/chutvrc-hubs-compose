// Explicit, logged workarounds for known product failures, so that a test whose subject is something
// else can still check that. A test about the failure itself must not use them.
import type { Evidence } from "../report/evidence";
import type { Client } from "./launch";

/**
 * AVATAR_REANNOUNCE=0 turns the avatar re-announce workaround off in every test: reannounceAvatars below sends nothing
 * and says so in the evidence, and t5-ik's own announcements are skipped as well. On by default.
 */
export const avatarReannounceEnabled = () => process.env.AVATAR_REANNOUNCE !== "0";

/**
 * Known failure: a client announces its avatar (#avatarId) once, right after entry, often before the
 * channel is open, so the others never load its model (T1, "The other's avatar is drawn"). Sending the
 * announcement again once the channels are open makes the others load it. Recorded in the evidence as
 * "workaround applied". Sent through the capability layer, so it works on the adapter build as well.
 */
export async function reannounceAvatars(clients: Client[], evidence: Evidence, why: string) {
  if (!avatarReannounceEnabled()) {
    evidence.note(`workaround not applied: AVATAR_REANNOUNCE=0, the avatar announcement is not sent again after entry (${why})`);
    return [];
  }
  const sent: string[] = [];
  for (const c of clients) {
    const ok = await c.page
      .evaluate(() => !!(window as any).__e2eApi?.announceAvatar())
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

/**
 * Known failures 3 and 21 of BASELINE.md (Dialog): when clients join together, one client's sending can fail
 * for the whole session: nobody receives its poses or its voice, while it receives everyone; or, the other
 * way, a client receives nobody while the others receive each other. A test whose subject is something else
 * lets such a client enter the room again (a page load, as a person reloading would), at most twice, and
 * records it as "workaround applied". Returns the clients that entered again.
 */
export async function reenterSilentSenders(clients: Client[], evidence: Evidence, why: string, enter: (c: Client) => Promise<unknown>) {
  const reentered: string[] = [];
  const people = clients.filter(c => c.profile !== "BOT");
  for (let round = 1; round <= 2; round++) {
    const ids = await Promise.all(clients.map(c => c.page.evaluate(() => (window as any).__e2eApi?.clientId() ?? "").catch(() => "")));
    const seqs = () =>
      Promise.all(clients.map(r => r.page.evaluate(ids => ids.map((id: string) => (id ? ((window as any).__e2eApi?.pose(id)?.seq ?? null) : null)), ids).catch(() => ids.map(() => null))));
    const before = await seqs();
    await clients[0].page.waitForTimeout(2000);
    const after = await seqs();
    const silent = people.filter(sender => {
      const j = clients.indexOf(sender);
      const others = clients.filter((_, i) => i !== j);
      return others.length > 0 && others.every(r => {
        const i = clients.indexOf(r);
        return after[i][j] === null || after[i][j] === before[i][j];
      });
    });
    // The other way round: a client that receives nobody's poses while the others receive each other
    // (its receiving failed); with two clients this is the same situation as a silent sender, which goes first
    const deaf = people.filter(receiver => {
      const i = clients.indexOf(receiver);
      const others = clients.filter((_, j) => j !== i);
      const hearsNobody = others.length > 0 && others.every(sender => {
        const j = clients.indexOf(sender);
        return after[i][j] === null || after[i][j] === before[i][j];
      });
      return hearsNobody && clients.length > 2 && !silent.includes(receiver);
    });
    if (!silent.length && !deaf.length) break;
    for (const c of silent) {
      reentered.push(c.name);
      evidence.note(`workaround applied: nobody received ${c.name}'s poses after entry (known failures 3 and 21: its sending failed at the joint join); ${c.name} enters the room again (round ${round}), ${why}`);
      await enter(c);
    }
    for (const c of deaf) {
      reentered.push(c.name);
      evidence.note(`workaround applied: ${c.name} received nobody's poses after entry while the others received each other (known failure 3: one-way at the joint join, its receiving side); ${c.name} enters the room again (round ${round}), ${why}`);
      await enter(c);
    }
    await clients[0].page.waitForTimeout(3000);
  }
  return reentered;
}
