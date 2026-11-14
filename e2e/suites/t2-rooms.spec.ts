// T2 transport and media, rooms and media servers (plan 4): T2.6 moving through an in-world link
// (Dialog to Dialog in the Dialog block; LiveKit to LiveKit and Dialog to LiveKit in a LiveKit block),
// T2.7 the owner switching the room's media server to LiveKit and back with microphone, camera and
// recording running (and again muted), T2.8 a third client joining after the switch.
import fs from "node:fs";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { BASE_URL } from "../lib/env";
import { sql, sqlText } from "../lib/stack";
import { room, SFU_ID, type MediaServer, type RoomName } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { answerRoomLinks, resolverStatus } from "../clients/local-stack";
import { readPeers, readSession, type Session } from "../probes/session";
import { audioGap, startPilotWatch, stopPilotWatch, type PilotWatch } from "../probes/audio";
import { liveConnections } from "../probes/connections";
import { matches, seenVideo, describeVideo } from "../probes/video";
import { summariseRecording } from "../probes/recording";
import { IS_CONNECTED } from "../probes/compat";
import { blockId, blockTitle, runsOn } from "./blocks";
import {
  closingChecks,
  connectedCheck,
  enterAll,
  frameRateCheck,
  gridText,
  hearingGrid,
  idOf,
  startClients,
  startPair,
  twoWayAudio,
  pilotText,
  waitUntil,
  micWishNote
} from "./common";

// ---------- T2.6 ----------

const AUDIO_BACK_MS = 5000;

/**
 * B, then A, moves through a link A placed to `target`. Pilot watches run on both from before the move,
 * following the other onto its new track, so the time until each hears the other again is measured from
 * the moment the second one arrived.
 */
async function moveByLink(evidence: Evidence, a: Client, b: Client, target: RoomName, covers: string) {
  const hub = room(target);
  const linkUrl = `${BASE_URL}/${hub.hubId}`;
  const resolver = await resolverStatus(a.page, linkUrl);
  await answerRoomLinks(a, [linkUrl]);
  await answerRoomLinks(b, [linkUrl]);
  evidence.note(`room link resolution: reticulum answered ${resolver} for ${linkUrl}; the harness answers it as a deployed server would (clients/local-stack.ts)`);

  return evidence.check(`Move through an in-world link to ${target} (${hub.mediaServer})`, covers, async () => {
    const [ida, idb] = [await idOf(a), await idOf(b)];
    const before = { A: await readSession(a.page), B: await readSession(b.page) };
    const connectionsBefore = { A: await liveConnections(a.page), B: await liveConnections(b.page) };
    await input.placeFromUrl(a.page, linkUrl);
    await Promise.all([input.waitForRoomLink(a.page, linkUrl), input.waitForRoomLink(b.page, linkUrl)]);
    await a.page.waitForTimeout(1000);
    await input.faceTowards(b.page, { mediaSrc: linkUrl });
    await evidence.screenshot(b, `link-to-${target}`);

    await startPilotWatch(b.page, "move", ida, a.pilotHz);
    await startPilotWatch(a.page, "move", idb, b.pilotHz);
    const moveThrough = async (c: Client) => {
      const t0 = Date.now();
      await input.clickHoverMenuButton(c.page, linkUrl, "visit room");
      await c.page.waitForFunction(id => (window as any).APP?.hub?.hub_id === id, hub.hubId, { timeout: 30_000 });
      await c.page.waitForFunction(IS_CONNECTED, undefined, { timeout: 30_000 });
      return { ms: Date.now() - t0, at: Date.now() };
    };
    const bMove = await moveThrough(b);
    await b.page.waitForTimeout(3000);
    const bAlone = await readPeers(b.page);
    await evidence.screenshot(b, `in-${target}-alone`);
    const aMove = await moveThrough(a);
    await a.page.waitForTimeout(AUDIO_BACK_MS + 3000);
    const [bWatch, aWatch] = await Promise.all([stopPilotWatch(b.page, "move"), stopPilotWatch(a.page, "move")]);
    evidence.saveJson(`move-to-${target}-watches.json`, { bArrivedAt: bMove.at, aArrivedAt: aMove.at, bHearsA: bWatch, aHearsB: aWatch }, "pilot watches during the move");
    const arrival = aMove.at;
    const back = (w: PilotWatch) => audioGap(w, arrival - w.startedAt).heardAfterMs;
    const [bBack, aBack] = [back(bWatch), back(aWatch)];

    const after = { A: await readSession(a.page), B: await readSession(b.page) };
    const peers = { A: await readPeers(a.page), B: await readPeers(b.page) };
    const audio = await twoWayAudio(a, b);
    const connectionsAfter = { A: await liveConnections(a.page), B: await liveConnections(b.page) };
    await input.faceTowards(a.page, { clientId: idb });
    await evidence.screenshot(a, `in-${target}`);

    const noReload = before.A.pageLoadedAt === after.A.pageLoadedAt && before.B.pageLoadedAt === after.B.pageLoadedAt;
    const inTarget = [after.A, after.B].every(s => s.hubId === hub.hubId);
    const connected = [after.A, after.B].every(s => s.isConnected && s.sfuId === SFU_ID[hub.mediaServer]);
    const micLive = [after.A, after.B].every(s => s.micTrack === "live");
    const leftNothing = bAlone.poses.length === 0 && bAlone.models.length === 0 && bAlone.avatarEntities === 0;
    const audioBack = aBack !== null && bBack !== null && aBack <= AUDIO_BACK_MS && bBack <= AUDIO_BACK_MS;
    return {
      ok: noReload && inTarget && connected && micLive && leftNothing && audioBack,
      summary:
        `B moved in ${(bMove.ms / 1000).toFixed(1)} s, A in ${(aMove.ms / 1000).toFixed(1)} s; page loaded again: ${!noReload}; in ${hub.hubId} on sfuId ${after.A.sfuId}/${after.B.sfuId}: ${inTarget && connected}; ` +
        `audio back after A arrived: B hears A ${bBack === null ? "never" : `after ${bBack} ms`}, A hears B ${aBack === null ? "never" : `after ${aBack} ms`} (limit ${AUDIO_BACK_MS} ms); ` +
        `B held from the old room ${bAlone.poses.length} pose(s), ${bAlone.models.length} model(s), ${bAlone.avatarEntities} avatar entit(ies); ` +
        `microphone A ${after.A.micTrack}${after.A.micEnabled ? "" : " but disabled"}, B ${after.B.micTrack}${after.B.micEnabled ? "" : " but disabled"}; at the end B hears A ${pilotText(audio.bHearsA)}, A hears B ${pilotText(audio.aHearsB)}; ` +
        `live connections A ${connectionsBefore.A} -> ${connectionsAfter.A}, B ${connectionsBefore.B} -> ${connectionsAfter.B}` +
        micWishNote([a, b]),
      data: { before, after, bMove, aMove, audioBackMs: { bHearsA: bBack, aHearsB: aBack }, bAlone, peers, audio, connectionsBefore, connectionsAfter }
    };
  });
}

const MOVES: { from: RoomName; to: RoomName; server: MediaServer; name: string; id: string }[] = [
  { from: "dialog-main", to: "move-target-dialog", server: "dialog", name: "Dialog to Dialog", id: "dialog-to-dialog" },
  { from: "livekit-main", to: "move-target-livekit", server: "livekit", name: "LiveKit to LiveKit", id: "livekit-to-livekit" },
  { from: "dialog-main", to: "move-target-livekit", server: "livekit", name: "Dialog to LiveKit", id: "dialog-to-livekit" }
];

for (const move of MOVES) {
  const suffix = move.server === "dialog" ? "" : ` (${blockTitle("livekit")})`;
  test(
    `T2.6 room move ${move.name}${suffix}`,
    {
      annotation: [
        { type: "id", description: `t2.6-${move.id}${move.server === "livekit" ? `-${blockId("livekit")}` : ""}` },
        { type: "covers", description: move.server === "livekit" ? "B6 L3 A5 A7" : "B6 A5 A7" }
      ]
    },
    async ({ evidence }) => {
      runsOn(move.server);
      await evidence.recordWithObs();
      const [a, b] = await startPair(evidence, move.from);
      await frameRateCheck(evidence, [a, b]);
      await connectedCheck(evidence, [a, b], room(move.from).mediaServer, "B6");
      await moveByLink(evidence, a, b, move.to, move.server === "livekit" ? "B6 L3 A5 A7" : "B6 A5 A7");
      await closingChecks(evidence, [a, b]);
    }
  );
}

// ---------- T2.7 and T2.8 ----------

/** The switch room starts on Dialog (plan 1.5); a run that failed half way may have left it on LiveKit */
function resetSwitchRoom() {
  const hubId = room("switch").hubId;
  sql(`update ret0.hubs set sfu = 0 where hub_sid = ${sqlText(hubId)}`);
  return hubId;
}

/**
 * The owner sets the room's WebRTC SFU in the Room Settings sidebar and applies it; waits until every
 * client reports the new media server and is connected. Returns when that was, per client.
 */
async function switchServer(owner: Client, clients: Client[], to: MediaServer) {
  const clickedAt = Date.now();
  await input.setRoomMediaServer(owner.page, to === "dialog" ? "Dialog" : "LiveKit");
  await input.closeSidebar(owner.page);
  const reached = await Promise.all(
    clients.map(c =>
      c.page
        .waitForFunction(id => (window as any).__e2eApi?.sfuId() === id && (window as any).__e2eApi?.isConnected(), SFU_ID[to], { timeout: 45_000 })
        .then(() => Date.now() - clickedAt)
        .catch(() => null)
    )
  );
  return { clickedAt, reachedMs: Object.fromEntries(clients.map((c, i) => [c.name, reached[i]])) };
}

type SwitchState = { session: Session; button: string; pageLoadedAt: number };

async function stateOf(c: Client): Promise<SwitchState> {
  const session = await readSession(c.page);
  return { session, button: await input.micButtonState(c.page), pageLoadedAt: session.pageLoadedAt };
}

test(
  `T2.7 switching the room's media server with microphone, camera and recording running (${blockTitle("livekit")})`,
  { annotation: [{ type: "id", description: `t2.7-${blockId("livekit")}` }, { type: "covers", description: "L1 L4 A5 A7" }] },
  async ({ evidence }) => {
    runsOn("livekit");
    test.setTimeout(30 * 60_000);
    await evidence.recordWithObs();
    const hubId = resetSwitchRoom();
    const [a, b] = await startClients(evidence, [
      { identity: "admin", account: "admin", slot: "a" },
      { identity: "member1", account: "member1", slot: "b" }
    ]);
    evidence.note(`room switch ${hubId}, set to Dialog before the test`);
    await enterAll(evidence, [a, b], hubId);
    const [ida, idb] = [await idOf(a), await idOf(b)];
    await frameRateCheck(evidence, [a, b]);
    await connectedCheck(evidence, [a, b], "dialog", "L1");

    // A: microphone on (as entered), camera shared, recording running
    await input.toggleShareCamera(a.page);
    await a.page.waitForTimeout(3000);
    await input.startRecording(a.page);
    await startPilotWatch(b.page, "switch", ida, a.pilotHz);
    await startPilotWatch(a.page, "switch", idb, b.pilotHz);
    const loaded = { A: (await readSession(a.page)).pageLoadedAt, B: (await readSession(b.page)).pageLoadedAt };
    await a.page.waitForTimeout(4000);

    const switches: { to: MediaServer; muted: boolean; clickedAt: number }[] = [];
    const doSwitch = (to: MediaServer, muted: boolean) =>
      evidence.check(`${muted ? "Muted: " : ""}switch to ${to === "dialog" ? "Dialog" : "LiveKit"}`, to === "dialog" ? "L4 A5 A7" : "L1 A5 A7", async () => {
        const before = await stateOf(a);
        const sw = await switchServer(a, [a, b], to);
        switches.push({ to, muted, clickedAt: sw.clickedAt });
        await a.page.waitForTimeout(5000);
        const [sa, sb] = [await stateOf(a), await stateOf(b)];
        const [video, own] = await Promise.all([seenVideo(b.page, ida, 10_000), seenVideo(a.page, ida, 5000)]);
        await evidence.screenshot(b, `after-switch-to-${to}${muted ? "-muted" : ""}`);
        const noReload = sa.pageLoadedAt === loaded.A && sb.pageLoadedAt === loaded.B;
        const onServer = sa.session.sfuId === SFU_ID[to] && sb.session.sfuId === SFU_ID[to] && sa.session.isConnected && sb.session.isConnected;
        const muteKept = sa.button === before.button && sa.session.micEnabled === before.session.micEnabled && sa.session.micEnabled === !muted;
        // A's own published track is its camera clip; B's picture has to match it
        const cameraOk = matches(video, own.mean);
        return {
          ok: noReload && onServer && muteKept && cameraOk && Object.values(sw.reachedMs).every(v => v !== null),
          summary:
            `reached sfuId ${SFU_ID[to]}: ${Object.entries(sw.reachedMs).map(([n, ms]) => `${n} ${ms === null ? "never" : `${(ms / 1000).toFixed(1)} s`}`).join(", ")}; ` +
            `now A ${sa.session.sfuId}, B ${sb.session.sfuId}; page loaded again: ${!noReload}; ` +
            `A's microphone button ${before.button} -> ${sa.button}, isMicEnabled ${before.session.micEnabled} -> ${sa.session.micEnabled}; ` +
            `B sees A's camera: ${describeVideo(video)}${cameraOk ? "" : " (not A's camera)"}`,
          data: { before, after: { A: sa, B: sb }, reachedMs: sw.reachedMs, video, own }
        };
      });

    await doSwitch("livekit", false);
    await doSwitch("dialog", false);
    await input.clickMic(a.page);
    await a.page.waitForTimeout(1500);
    const mutedState = await stateOf(a);
    evidence.note(`A muted for the second round: button ${mutedState.button}, isMicEnabled ${mutedState.session.micEnabled}`);
    await doSwitch("livekit", true);
    await doSwitch("dialog", true);

    const [bWatch, aWatch] = await Promise.all([stopPilotWatch(b.page, "switch"), stopPilotWatch(a.page, "switch")]);
    evidence.saveJson("switch-watches.json", { switches, bHearsA: bWatch, aHearsB: aWatch }, "pilot watches over all four switches");

    await evidence.check("Audio continues across each switch (gap measured)", "L1 L4", async () => {
      const rows = switches.map((s, i) => {
        const end = (switches[i + 1]?.clickedAt ?? Date.now()) - 2000;
        const bHearsA = audioGap(bWatch, s.clickedAt - bWatch.startedAt, end - bWatch.startedAt);
        const aHearsB = audioGap(aWatch, s.clickedAt - aWatch.startedAt, end - aWatch.startedAt);
        return { to: s.to, muted: s.muted, bHearsA, aHearsB };
      });
      // Unmuted: both directions come back; muted: A stays silent for B, B is heard by A
      const ok = rows.every(r => (r.muted ? r.bHearsA.detections === 0 : r.bHearsA.heardAfterMs !== null) && r.aHearsB.heardAfterMs !== null);
      return {
        ok,
        summary: rows
          .map(
            r =>
              `to ${r.to}${r.muted ? " (A muted)" : ""}: B hears A ${r.muted ? `${r.bHearsA.detections} detections` : r.bHearsA.heardAfterMs === null ? "never" : `after ${r.bHearsA.heardAfterMs} ms, gap ${r.bHearsA.gapMs} ms`}, ` +
              `A hears B ${r.aHearsB.heardAfterMs === null ? "never" : `after ${r.aHearsB.heardAfterMs} ms, gap ${r.aHearsB.gapMs} ms`}`
          )
          .join("; ") + micWishNote([a, b]),
        data: rows
      };
    });

    await evidence.check("The recording has entries from before and after each switch", "L1 A7 B5", async () => {
      const download = await input.stopRecording(a.page);
      const file = evidence.file(`recording-${a.name}.json`);
      await download.saveAs(file);
      evidence.addFile(`recording-${a.name}.json`, "recording", `the recording A downloaded (${download.suggestedFilename()})`);
      const text = fs.readFileSync(file, "utf8");
      const summary = summariseRecording(text);
      let entries: { t: number; l: string }[] = [];
      try {
        entries = JSON.parse(text);
      } catch {
        // summary says it is not JSON
      }
      const edges = [...switches.map(s => s.clickedAt), Infinity];
      const counts = [0, ...switches.map(() => 0)];
      for (const e of entries) {
        const i = edges.findIndex(edge => e.t < edge);
        counts[i] += 1;
      }
      const ok = summary.valid && counts.every(n => n > 0);
      return {
        ok,
        summary: `${summary.valid ? "valid JSON" : "not JSON"}, ${summary.entries} entries; per stretch (before the first switch, after each): ${counts.join(", ")}`,
        data: { counts, switches, byLabel: summary.byLabel }
      };
    });
    await input.stopSharing(a.page).catch(() => {});
    resetSwitchRoom();
    await closingChecks(evidence, [a, b]);
  }
);

test(
  `T2.8 a third client joins after the switch (${blockTitle("livekit")})`,
  { annotation: [{ type: "id", description: `t2.8-${blockId("livekit")}` }, { type: "covers", description: "A5" }] },
  async ({ evidence }) => {
    runsOn("livekit");
    await evidence.recordWithObs();
    const hubId = resetSwitchRoom();
    const [a, b, c] = await startClients(evidence, [
      { identity: "admin", account: "admin", slot: "a" },
      { identity: "member1", account: "member1", slot: "b" },
      { identity: "member2", account: "member2", slot: "c" }
    ]);
    evidence.note(`room switch ${hubId}, set to Dialog before the test`);
    await enterAll(evidence, [a, b], hubId);
    await frameRateCheck(evidence, [a, b]);

    await evidence.check("The owner switches the room to LiveKit; A and B follow", "A5", async () => {
      const sw = await switchServer(a, [a, b], "livekit");
      return {
        ok: Object.values(sw.reachedMs).every(v => v !== null),
        summary: Object.entries(sw.reachedMs).map(([n, ms]) => `${n} on LiveKit ${ms === null ? "never" : `after ${(ms / 1000).toFixed(1)} s`}`).join(", "),
        data: sw
      };
    });

    await evidence.check("C joins after the switch: it is on LiveKit and hears both", "A5", async () => {
      await enterAll(evidence, [c], hubId, {}, "entry-c.json");
      await c.page.waitForTimeout(3000);
      const sc = await readSession(c.page);
      const grid = await hearingGrid([a, b, c]);
      evidence.saveJson("hearing-grid.json", grid.grid, "who hears whom after C joined");
      await evidence.screenshot(c, "joined");
      return {
        ok: sc.sfuId === SFU_ID.livekit && sc.isConnected && grid.ok,
        summary: `C: sfuId ${sc.sfuId}, connected ${sc.isConnected}; ${gridText(grid.grid)}${grid.missing.length ? `; missing: ${grid.missing.join(", ")}` : ""}${micWishNote([a, b, c])}`,
        data: { c: sc, missing: grid.missing }
      };
    });

    await evidence.check("Switched back to Dialog: all three follow", "A5", async () => {
      const sw = await switchServer(a, [a, b, c], "dialog");
      return {
        ok: Object.values(sw.reachedMs).every(v => v !== null),
        summary: Object.entries(sw.reachedMs).map(([n, ms]) => `${n} on Dialog ${ms === null ? "never" : `after ${(ms / 1000).toFixed(1)} s`}`).join(", "),
        data: sw
      };
    });
    resetSwitchRoom();
    await closingChecks(evidence, [a, b, c]);
  }
);

