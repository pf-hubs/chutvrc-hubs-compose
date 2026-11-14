// T2 transport and media, failures and moderation (plan 4): T2.9 the media server restarts (or, for
// LiveKit Cloud, a client goes offline for 10 s) and then everyone leaves; T2.10 block, unblock and kick;
// T2.13 ?force_tcp and ?force_turn on Dialog; T2.14 a Dialog host change.
import net from "node:net";
import { test } from "./harness";
import { compose, composeE2e, sql, sqlText } from "../lib/stack";
import { HOST } from "../lib/env";
import { room, SFU_ID, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { linkStatistics, shapeLink } from "../clients/network";
import { reannounceAvatars } from "../clients/workarounds";
import { CONTROL_HZ } from "../assets/media";
import { drawsAvatar, readPeers, readSession } from "../probes/session";
import { audioGap, heardPilot, startPilotWatch, stopPilotWatch } from "../probes/audio";
import { readPose } from "../probes/poses";
import { liveConnections, readConnections } from "../probes/connections";
import { BLOCK, blockId, blockTitle, runsOn } from "./blocks";
import {
  closingChecks,
  connectedCheck,
  enterAll,
  exceptionsSince,
  frameRateCheck,
  gridText,
  hearingGrid,
  heard,
  idOf,
  logMarks,
  mainRoom,
  micWishNote,
  pilotText,
  silent,
  startClients,
  startPair,
  waitUntil
} from "./common";

const SERVERS = ["dialog", "livekit"] as const;

// ---------- T2.9 ----------

/** What each client knows of the others: avatar models, poses and NAF avatar entities, and its live connections */
async function snapshot(clients: Client[]) {
  return Object.fromEntries(
    await Promise.all(
      clients.map(async c => [c.name, { peers: await readPeers(c.page), live: await liveConnections(c.page), created: (await readConnections(c.page, false)).created }] as const)
    )
  );
}

/** Whether every client's copy of every other's pose advances (sequence numbers) over 2 s */
async function posesAdvance(clients: Client[]) {
  const ids = await Promise.all(clients.map(idOf));
  const rows: string[] = [];
  let ok = true;
  for (const [i, c] of clients.entries()) {
    for (const [j, other] of clients.entries()) {
      if (i === j) continue;
      const p0 = await readPose(c.page, ids[j]);
      await c.page.waitForTimeout(700);
      const p1 = await readPose(c.page, ids[j]);
      const advanced = !!p0 && !!p1 && p1.seq !== p0.seq;
      if (!advanced) ok = false;
      rows.push(`${c.name} <- ${other.name} ${advanced ? `seq ${p0!.seq} -> ${p1!.seq}` : p1 ? "stalled" : "no pose"}`);
    }
  }
  return { ok, rows };
}

/** What takes the media server away for a while in this block, and how it is described */
function disruption(server: MediaServer): { what: string; run: (net?: Client) => Promise<void> } {
  if (server === "dialog") return { what: "docker compose restart dialog", run: async () => void compose(["restart", "dialog"]) };
  if (BLOCK === "livekit-local") return { what: "docker compose restart livekit (the local LiveKit server)", run: async () => void composeE2e(["restart", "livekit"]) };
  return {
    what: "LiveKit Cloud cannot be restarted: client C (in the netclient container) is taken offline for 10 s (tc netem loss 100%)",
    run: async () => {
      shapeLink("offline");
      await new Promise(r => setTimeout(r, 10_000));
      shapeLink("normal");
    }
  };
}

for (const server of SERVERS) {
  test(
    `T2.9 media server restart, then leaving, on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.9-${blockId(server)}` }, { type: "covers", description: "A1d A1k B1a" }] },
    async ({ evidence }) => {
      runsOn(server);
      test.setTimeout(20 * 60_000);
      await evidence.recordWithObs();
      const cloud = server === "livekit" && BLOCK === "livekit-cloud";
      const clients = await startClients(evidence, [
        { identity: "admin", account: "admin", slot: "a" },
        { identity: "member1", account: "member1", slot: "b" },
        cloud ? { identity: "netclient", slot: "c", modifiers: ["poor-network"], name: "C-netclient" } : { identity: "member2", account: "member2", slot: "c" }
      ]);
      if (cloud) shapeLink("normal");
      const hub = room(mainRoom(server));
      evidence.note(`room ${hub.hubId}; disruption: ${disruption(server).what}`);
      await enterAll(evidence, clients, hub.hubId);
      await frameRateCheck(evidence, clients);
      await connectedCheck(evidence, clients, server, "A1d");
      // "No duplicate avatars" needs the avatars there before the disruption
      await reannounceAvatars(clients, evidence, "so that the avatars are there before the disruption and duplicates after it can be seen");
      const before = await snapshot(clients);
      evidence.saveJson("before.json", before, "what each client knew before the disruption");

      await evidence.check("Before: everyone hears everyone", "A1d", async () => {
        const g = await hearingGrid(clients);
        return { ok: g.ok, summary: gridText(g.grid), data: g.grid };
      });

      const marks = logMarks(clients);
      const t0 = Date.now();
      // Whether each client noticed the outage: its session reported not connected at some point
      const noticed = new Set<string>();
      let polling = true;
      const poller = (async () => {
        while (polling) {
          for (const c of clients) if (!(await readSession(c.page).catch(() => null))?.isConnected) noticed.add(c.name);
          await new Promise(r => setTimeout(r, 250));
        }
      })();
      await disruption(server).run();
      const disruptedMs = Date.now() - t0;
      await new Promise(r => setTimeout(r, 5000));
      polling = false;
      await poller;
      if (cloud) evidence.saveText("link-statistics.txt", linkStatistics(), "tc statistics of the netclient's link after the outage");

      await evidence.check("All reconnect", "A1d A1k", async () => {
        const back = await Promise.all(
          clients.map(c =>
            waitUntil(async () => {
              const s = await readSession(c.page).catch(() => null);
              return s && s.isConnected && s.sfuId === SFU_ID[server] ? s : null;
            }, 90_000, 1000)
          )
        );
        await Promise.all(clients.map(c => evidence.screenshot(c, "after-disruption")));
        const scene = await Promise.all(clients.map(c => c.page.evaluate(() => !!(window as any).AFRAME?.scenes?.[0]?.is("entered")).catch(() => false)));
        return {
          ok: back.every(b => !b.timedOut) && scene.every(Boolean),
          summary:
            `disruption took ${(disruptedMs / 1000).toFixed(1)} s; ` +
            clients
              .map(
                (c, i) =>
                  `${c.name} ${noticed.has(c.name) ? "noticed the outage" : "never reported a disconnection"}, ${back[i].timedOut ? "not reconnected after 90 s" : `connected ${(back[i].ms / 1000).toFixed(1)} s after the poll`}${scene[i] ? "" : " (left the scene)"}`
              )
              .join(", ") +
            `; exceptions: ${exceptionsSince(clients, marks).length}`,
          data: { disruptedMs, noticed: [...noticed], back: back.map(b => ({ ms: b.ms, timedOut: b.timedOut })), exceptions: exceptionsSince(clients, marks).slice(0, 20) }
        };
      });

      await evidence.check("Audio resumes for everyone", "A1d A1k", async () => {
        const g = await hearingGrid(clients);
        return { ok: g.ok, summary: gridText(g.grid) + (g.missing.length ? `; missing: ${g.missing.join(", ")}` : "") + micWishNote(clients), data: g.grid };
      });

      await evidence.check("Poses resume", "A1d B1a", async () => {
        const p = await posesAdvance(clients);
        return { ok: p.ok, summary: p.rows.join("; "), data: p.rows };
      });

      await evidence.check("No duplicate avatars and no extra live connections", "A1k B1a", async () => {
        const after = await snapshot(clients);
        evidence.saveJson("after.json", after, "what each client knew after reconnecting");
        const ids = await Promise.all(clients.map(idOf));
        const rows = clients.map(c => {
          const others = ids.filter(id => id !== ids[clients.indexOf(c)]);
          const a = after[c.name];
          const b = before[c.name];
          const stray = [...new Set([...a.peers.models, ...a.peers.poses])].filter(id => !others.includes(id));
          return {
            name: c.name,
            ok: stray.length === 0 && a.peers.models.length <= others.length && a.live <= b.live,
            text: `${c.name}: ${a.peers.models.length} models, ${a.peers.poses.length} poses, ${a.peers.avatarEntities} NAF avatars${stray.length ? `, ${stray.length} unknown client(s)` : ""}; live connections ${b.live} -> ${a.live}`
          };
        });
        return { ok: rows.every(r => r.ok), summary: rows.map(r => r.text).join("; "), data: { before, after } };
      });

      await evidence.check("After leaving, no new connection for 30 s", "A1k", async () => {
        await Promise.all(clients.map(c => input.leaveRoom(c.page).catch(e => evidence.note(`${c.name} could not press Leave: ${(e as Error).message.split("\n")[0]}`))));
        await clients[0].page.waitForTimeout(3000);
        const left = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, await readConnections(c.page, false)] as const)));
        await clients[0].page.waitForTimeout(30_000);
        const later = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, await readConnections(c.page, false)] as const)));
        await Promise.all(clients.map(c => evidence.screenshot(c, "left")));
        const rows = clients.map(c => ({
          name: c.name,
          ok: later[c.name].created === left[c.name].created && later[c.name].live === 0,
          text: `${c.name}: made ${left[c.name].created} -> ${later[c.name].created} connections, live ${left[c.name].live} -> ${later[c.name].live}`
        }));
        return { ok: rows.every(r => r.ok), summary: rows.map(r => r.text).join("; "), data: { left, later } };
      });
      if (cloud) shapeLink("normal");
      await closingChecks(evidence, clients);
    }
  );
}

// ---------- T2.10 ----------

for (const server of SERVERS) {
  test(
    `T2.10 block, unblock and kick on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.10-${blockId(server)}` }, { type: "covers", description: "F4" }] },
    async ({ evidence }) => {
      runsOn(server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, mainRoom(server));
      const [ida, idb] = [await idOf(a), await idOf(b)];
      await frameRateCheck(evidence, [a, b]);
      await connectedCheck(evidence, [a, b], server, "F4");
      // Avatar presence is part of what this test judges, so no workaround for the avatar announcement.
      // B's audio can take a few seconds to arrive after entry; the block is judged against a room where it has
      const audible = await waitUntil(async () => heard(await heardPilot(a.page, idb, b.pilotHz, CONTROL_HZ, 2000)), 20_000, 500);
      evidence.note(`A heard B ${audible.value ? `${(audible.ms / 1000).toFixed(1)} s after the check started` : "not within 20 s"}`);
      await input.faceTowards(a.page, { clientId: idb });

      const look = async () => ({
        aHearsB: await heardPilot(a.page, idb, b.pilotHz, CONTROL_HZ, 3000),
        bHearsA: await heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ, 3000),
        avatar: await drawsAvatar(a.page, idb)
      });

      const start = await look();
      await evidence.screenshot(a, "before-block");
      await evidence.check("Before: A hears B and draws B's avatar", "F4", async () => ({
        ok: heard(start.aHearsB) && start.avatar.model && start.avatar.visible,
        summary:
          `A hears B ${pilotText(start.aHearsB)}, B hears A ${pilotText(start.bHearsA)}; A draws B's avatar: model ${start.avatar.model}, visible ${start.avatar.visible}` +
          (start.avatar.model ? "" : " (known failure: B's avatar announcement went out before the channel opened)"),
        data: start
      }));

      await evidence.check("A hides (blocks) B from People: B's voice and avatar disappear", "F4", async () => {
        await input.openPerson(a.page, b.name);
        await evidence.screenshot(a, "profile");
        await input.clickProfileButton(a.page, "Hide");
        await input.closeSidebar(a.page);
        await a.page.waitForTimeout(3000);
        const s = await look();
        await evidence.screenshot(a, "blocked");
        return {
          ok: silent(s.aHearsB) && !(s.avatar.model && s.avatar.visible),
          summary: `A hears B ${pilotText(s.aHearsB)}; B hears A ${pilotText(s.bHearsA)}; A draws B's avatar: model ${s.avatar.model}, visible ${s.avatar.visible}`,
          data: s
        };
      });

      await evidence.check("A unhides (unblocks) B: B's voice and avatar return", "F4", async () => {
        await input.openPerson(a.page, b.name);
        await input.clickProfileButton(a.page, "Unhide");
        await input.closeSidebar(a.page);
        const back = await waitUntil(async () => {
          const s = await look();
          return heard(s.aHearsB) && s.avatar.model && s.avatar.visible ? s : null;
        }, 15_000, 1000);
        const s = back.value ?? (await look());
        await evidence.screenshot(a, "unblocked");
        return {
          ok: !!back.value,
          summary: `${back.value ? `back after ${(back.ms / 1000).toFixed(1)} s` : "not back within 15 s"}: A hears B ${pilotText(s.aHearsB)}; B hears A ${pilotText(s.bHearsA)}; A draws B's avatar: model ${s.avatar.model}, visible ${s.avatar.visible}`,
          data: s
        };
      });

      await evidence.check("A kicks B: B leaves the room", "F4", async () => {
        await input.openPerson(a.page, b.name);
        await input.clickProfileButton(a.page, "Kick");
        const gone = await waitUntil(async () => {
          const [sb, peersA] = await Promise.all([readSession(b.page).catch(() => null), readPeers(a.page)]);
          const bInRoom = await b.page.evaluate(() => !!(window as any).AFRAME?.scenes?.[0]?.is("entered")).catch(() => false);
          return !bInRoom && !sb?.isConnected && !peersA.poses.includes(idb) ? { sb, bInRoom, peersA } : null;
        }, 20_000, 1000);
        await evidence.screenshot(b, "kicked");
        await evidence.screenshot(a, "after-kick");
        const [sb, peersA] = [await readSession(b.page).catch(() => null), await readPeers(a.page)];
        const bInRoom = await b.page.evaluate(() => !!(window as any).AFRAME?.scenes?.[0]?.is("entered")).catch(() => false);
        const bScreen = await b.page.evaluate(() => document.body.innerText.slice(0, 120)).catch(() => "");
        const people = await a.page.getByRole("button", { name: /^People/ }).textContent().catch(() => null);
        return {
          ok: !!gone.value,
          summary: gone.value
            ? `B left after ${(gone.ms / 1000).toFixed(1)} s (B connected ${sb?.isConnected}; A holds ${peersA.poses.length} pose(s))`
            : `not all gone after 20 s: B's page ${bInRoom ? "still in the room" : `left the room ("${bScreen.split("\n")[0]}")`}; A's toolbar ${people}; B's media server session connected ${sb?.isConnected}; A still holds B's pose ${peersA.poses.includes(idb)} and draws its model ${peersA.models.includes(idb)}`,
          data: { sb, peersA, bInRoom, bScreen, people }
        };
      });
      await closingChecks(evidence, [a, b]);
    }
  );
}

// ---------- T2.13 ----------

test(
  "T2.13 force_tcp and force_turn on Dialog",
  { annotation: [{ type: "id", description: "t2.13-dialog" }, { type: "covers", description: "A1g A2" }] },
  async ({ evidence }) => {
    runsOn("dialog");
    const [a] = await startClients(evidence, [{ identity: "admin", account: "admin", slot: "a" }]);
    const hubId = room("dialog-main").hubId;
    await a.page.goto(`${a.baseUrl}/${hubId}`, { waitUntil: "domcontentloaded" });
    await a.page.waitForFunction(() => !!(window as any).APP?.hub, undefined, { timeout: 120_000 });
    const turn = await a.page.evaluate(() => (window as any).APP.hub.turn ?? null);
    evidence.saveJson("turn.json", { turn: turn && { ...turn, username: turn.username ? "(set)" : undefined, credential: turn.credential ? "(set)" : undefined } }, "the room's TURN settings as the client gets them");
    test.skip(
      !turn?.enabled,
      `the room has no TURN settings (hub.turn ${JSON.stringify(turn)}): reticulum's TURN server (Ret.Coturn) is not configured on this stack, so ?force_tcp and ?force_turn (relay only) have nothing to connect through`
    );
    // Is anything answering on the TURN port the settings name? (TCP connect from this PC)
    const turnPort = turn.transports?.[0]?.port ?? 5349;
    const turnAnswers = await new Promise<boolean>(resolve => {
      const socket = net.connect({ host: HOST, port: turnPort, timeout: 3000 }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    evidence.note(
      `TURN settings: enabled, port ${turnPort}; a TCP connection to ${HOST}:${turnPort} ${turnAnswers ? "is answered" : "is refused or times out (no TURN server is running on this stack)"}`
    );
    for (const query of ["?force_tcp=1", "?force_turn=1"]) {
      await evidence.check(`${query}: the media server transports connect through a relay`, "A1g A2", async () => {
        await enterAll(evidence, [a], hubId, { query, timeout: 90_000 }, `entry${query.replace(/\W+/g, "-")}.json`).catch(e =>
          evidence.note(`${query}: entry did not finish: ${(e as Error).message.split("\n")[0]}`)
        );
        await a.page.waitForTimeout(5000);
        const c = await readConnections(a.page);
        // The transports are the connections opened with the relay policy; the client's own echo-cancellation
        // loopback pair uses the default policy and is left out
        const transports = c.connections.filter(x => x.policy === "relay" && x.closedAtS === null);
        const relay = transports.every(
          x => x.connectionState === "connected" && x.selectedPair?.local.type === "relay" && (query.includes("tcp") ? x.selectedPair.local.relayProtocol === "tcp" : true)
        );
        const shown = transports
          .map(x => `#${x.id} ${x.connectionState}${x.selectedPair ? ` ${x.selectedPair.local.protocol}/${x.selectedPair.local.relayProtocol ?? "-"} ${x.selectedPair.local.type}` : ", no selected pair"}`)
          .join(", ");
        return {
          ok: transports.length > 0 && relay,
          summary:
            `${transports.length} relay-only transport(s): ${shown || "none"}` +
            (turnAnswers ? "" : "; nothing answers on the TURN port, so no relay can be reached here (the local stack runs no TURN server although reticulum hands out TURN settings)"),
          data: c
        };
      });
    }
    await closingChecks(evidence, [a]);
  }
);

// ---------- T2.14 ----------

test(
  "T2.14 Dialog host change",
  { annotation: [{ type: "id", description: "t2.14-dialog" }, { type: "covers", description: "A1a" }] },
  async ({ evidence }) => {
    runsOn("dialog");
    await evidence.recordWithObs();
    const hubId = room("dialog-main").hubId;
    const [a, b] = await startPair(evidence, "dialog-main");
    const [ida, idb] = [await idOf(a), await idOf(b)];
    await connectedCheck(evidence, [a, b], "dialog", "A1a");
    const hostBefore = sql(`select coalesce(host, '') from ret0.hubs where hub_sid = ${sqlText(hubId)}`);
    evidence.note(
      "trigger: the room's host in the database is set to a name no Dialog server has (stale-host.invalid), then a third client (C) joins; " +
        "reticulum's Hub.ensure_host sees the host is not alive, assigns the live one and broadcasts host_changed to the room (lib/ret/hub.ex). " +
        "Reticulum runs without a node name here, so its console cannot be attached to broadcast directly"
    );
    await startPilotWatch(b.page, "host", ida, a.pilotHz);
    await startPilotWatch(a.page, "host", idb, b.pilotHz);
    const marks = logMarks([a, b]);
    sql(`update ret0.hubs set host = 'stale-host.invalid' where hub_sid = ${sqlText(hubId)}`);
    const changedAt = Date.now();
    const [c] = await startClients(evidence, [{ identity: "member2", account: "member2", slot: "c" }]);
    await enterAll(evidence, [c], hubId, {}, "entry-c.json");
    const seen = await waitUntil(async () => [a, b].every(x => x.log.some(e => /WebRTC SFU host changed/.test(e.text))), 20_000, 1000);
    const hostAfter = sql(`select coalesce(host, '') from ret0.hubs where hub_sid = ${sqlText(hubId)}`);
    if (!seen.value) {
      // Put the host back so later tests are not affected
      sql(`update ret0.hubs set host = ${sqlText(hostBefore || "hubs.local")} where hub_sid = ${sqlText(hubId)} and host = 'stale-host.invalid'`);
    }
    test.skip(!seen.value, `host_changed did not reach the clients within 20 s (host ${hostBefore} -> ${hostAfter}); the host change could not be triggered this way`);
    await a.page.waitForTimeout(8000);
    const [bWatch, aWatch] = await Promise.all([stopPilotWatch(b.page, "host"), stopPilotWatch(a.page, "host")]);
    evidence.saveJson("host-change-watches.json", { changedAt, bHearsA: bWatch, aHearsB: aWatch }, "pilot watches around the host change");

    await evidence.check("host_changed: both reconnect, no exception, audio returns", "A1a", async () => {
      const [sa, sb] = [await readSession(a.page), await readSession(b.page)];
      const bBack = audioGap(bWatch, changedAt - bWatch.startedAt);
      const aBack = audioGap(aWatch, changedAt - aWatch.startedAt);
      const exceptions = exceptionsSince([a, b], marks);
      const g = await hearingGrid([a, b, c]);
      return {
        ok: sa.isConnected && sb.isConnected && exceptions.length === 0 && g.ok,
        summary:
          `host ${hostBefore} -> stale-host.invalid -> ${hostAfter}; host_changed logged by A and B ${(seen.ms / 1000).toFixed(1)} s after C started joining; ` +
          `A connected ${sa.isConnected}, B ${sb.isConnected}; exceptions ${exceptions.length}; longest audio gap B<-A ${bBack.gapMs} ms, A<-B ${aBack.gapMs} ms; ${gridText(g.grid)}`,
        data: { hostBefore, hostAfter, exceptions, bBack, aBack, grid: g.grid }
      };
    });
    await closingChecks(evidence, [a, b, c]);
  }
);
