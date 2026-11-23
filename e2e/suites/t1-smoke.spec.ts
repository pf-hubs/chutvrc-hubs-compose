// T1 Smoke (plan section 4): two DESK clients, A (admin) and B (member 1), in one room.
// Two-way audio, mute and unmute with the toolbar, the other's avatar moves, the recording button
// downloads a JSON with #avatar-pose entries, a room move through an in-world link without a page load,
// and no console errors outside the allow-list. Every check runs even when an earlier one fails, and
// records its numbers; the test is NG if any check is.
import fs from "node:fs";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { BASE_URL } from "../lib/env";
import { room, SFU_ID, type MediaServer } from "../lib/fixtures";
import { launchClients, type Client } from "../clients/launch";
import { ensureSignedIn } from "../clients/signin";
import { enterTogether } from "../clients/enter";
import { answerRoomLinks, resolverStatus } from "../clients/local-stack";
import * as input from "../clients/input";
import { CONTROL_HZ } from "../assets/media";
import { MIN_FRAME_RATE, measureFrameRate, readPeers, readSession } from "../probes/session";
import { PILOT_HEARD, PILOT_SILENT, heardPilot, type PilotResult } from "../probes/audio";
import { movement, readPose, tracePose } from "../probes/poses";
import { summariseRecording } from "../probes/recording";
import { IS_CONNECTED, capabilities, poseLabel } from "../probes/compat";
import { noteClientApi } from "./common";
import { SEND_WATCH, collectErrors, countByReason, reticulumIoHosts, sendsBeforeOpen } from "../probes/errors";
import { CONSOLE_ALLOW_LIST } from "./console-allowlist";
import { blockId, blockTitle, runsOn } from "./blocks";

const heard = (r: PilotResult) => r.ratio >= PILOT_HEARD && r.controlRatio <= PILOT_SILENT;
const pilotText = (r: PilotResult) => `pilot ${r.ratio}${r.error ? ` (${r.error})` : ""}`;

/** Both directions: does each client hear the other's pilot? */
async function twoWayAudio(a: Client, b: Client) {
  const [ida, idb] = [(await readSession(a.page)).clientId, (await readSession(b.page)).clientId];
  const [bHearsA, aHearsB] = await Promise.all([
    heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ),
    heardPilot(a.page, idb, b.pilotHz, CONTROL_HZ)
  ]);
  return { bHearsA, aHearsB, ok: heard(bHearsA) && heard(aHearsB) };
}

async function smoke(evidence: Evidence, server: MediaServer) {
  const start = room(server === "dialog" ? "dialog-main" : "livekit-main");
  const target = room(server === "dialog" ? "move-target-dialog" : "move-target-livekit");
  const linkUrl = `${BASE_URL}/${target.hubId}`;
  evidence.note(`rooms: ${start.hubId} (start), ${target.hubId} (link target); media server ${server} (block ${blockId(server)})`);

  await evidence.recordWithObs();
  const [a, b] = await launchClients([
    { profile: "DESK", identity: "admin", slot: "a", evidence, position: [0, 0], initScripts: [SEND_WATCH] },
    { profile: "DESK", identity: "member1", slot: "b", evidence, position: [640, 330], initScripts: [SEND_WATCH] }
  ]);
  await Promise.all([ensureSignedIn(a, "admin"), ensureSignedIn(b, "member1")]);

  // The local reticulum cannot resolve its own room URLs (clients/local-stack.ts); recorded every run
  const resolver = await resolverStatus(a.page, linkUrl);
  await answerRoomLinks(a, [linkUrl]);
  await answerRoomLinks(b, [linkUrl]);
  evidence.note(
    `room link resolution: reticulum answered ${resolver} for ${linkUrl}; the harness answers it as a deployed server would (clients/local-stack.ts)`
  );

  const entry = await enterTogether([a, b], start.hubId);
  evidence.saveJson("entry.json", { A: entry[0], B: entry[1] }, "entry timings (ms from opening the page)");
  await noteClientApi(evidence, a);
  await evidence.screenshot(a, "entered");
  await evidence.screenshot(b, "entered");

  await evidence.check("Frame rate of both clients", "2.2", async () => {
    const [fa, fb] = await Promise.all([measureFrameRate(a.page), measureFrameRate(b.page)]);
    const low = Math.min(fa.raf, fb.raf);
    return {
      ok: low >= MIN_FRAME_RATE ? true : ("invalid" as const),
      summary: `A ${fa.raf} fps, B ${fb.raf} fps (floor ${MIN_FRAME_RATE}; scene with sky, sun and shadows)`,
      data: { A: fa, B: fb }
    };
  });

  await evidence.check("Both connected to the media server with a live microphone", "B1", async () => {
    const [sa, sb] = [await readSession(a.page), await readSession(b.page)];
    const good = (s: typeof sa) => s.sfuId === SFU_ID[server] && s.isConnected && s.micTrack === "live" && s.micEnabled === true;
    return {
      ok: good(sa) && good(sb),
      summary: `A: sfuId ${sa.sfuId}, connected ${sa.isConnected}, mic ${sa.micTrack}; B: sfuId ${sb.sfuId}, connected ${sb.isConnected}, mic ${sb.micTrack}`,
      data: { A: sa, B: sb }
    };
  });

  await evidence.check("Two-way audio", "B1", async () => {
    const r = await twoWayAudio(a, b);
    return { ok: r.ok, summary: `B hears A: ${pilotText(r.bHearsA)}; A hears B: ${pilotText(r.aHearsB)} (heard at ${PILOT_HEARD} or more)`, data: r };
  });

  await evidence.check("Mute and unmute with the toolbar's Voice button", "B2", async () => {
    const ida = (await readSession(a.page)).clientId;
    const state = async () => ({
      button: await input.micButtonState(a.page),
      micEnabled: (await readSession(a.page)).micEnabled,
      bHears: await heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ, 3000)
    });
    const before = await input.micButtonState(a.page);
    await input.clickMic(a.page);
    await a.page.waitForTimeout(1000);
    const muted = await state();
    await evidence.screenshot(a, "muted");
    await input.clickMic(a.page);
    await a.page.waitForTimeout(1000);
    const unmuted = await state();
    // When the toggle went wrong, the microphone is left as it ended; put it back on so the later checks
    // still hear A (this does not change this check's result)
    if (unmuted.button !== "on" || unmuted.micEnabled !== true) {
      await input.clickMic(a.page);
      await a.page.waitForTimeout(1000);
      evidence.note(`the microphone was left ${unmuted.micEnabled ? "on" : "off"} after the mute check; Voice clicked once more: button ${await input.micButtonState(a.page)}, isMicEnabled ${(await readSession(a.page)).micEnabled}`);
    }
    const ok =
      before === "on" &&
      muted.button === "muted" && muted.micEnabled === false && muted.bHears.ratio <= PILOT_SILENT &&
      unmuted.button === "on" && unmuted.micEnabled === true && heard(unmuted.bHears);
    return {
      ok,
      summary:
        `muted: button ${muted.button}, isMicEnabled ${muted.micEnabled}, B ${pilotText(muted.bHears)}; ` +
        `unmuted: button ${unmuted.button}, isMicEnabled ${unmuted.micEnabled}, B ${pilotText(unmuted.bHears)}`,
      data: { before, muted, unmuted }
    };
  });

  await evidence.check("The other's avatar is drawn (avatar model loaded)", "B3", async () => {
    const [ida, idb] = [(await readSession(a.page)).clientId, (await readSession(b.page)).clientId];
    let peers = { A: await readPeers(a.page), B: await readPeers(b.page) };
    for (let i = 0; i < 15 && !(peers.A.models.includes(idb) && peers.B.models.includes(ida)); i++) {
      await a.page.waitForTimeout(1000);
      peers = { A: await readPeers(a.page), B: await readPeers(b.page) };
    }
    const facing = await input.faceTowards(b.page, { clientId: ida });
    await evidence.screenshot(b, "facing-A");
    const lost = sendsBeforeOpen([a, b]);
    return {
      ok: peers.A.models.includes(idb) && peers.B.models.includes(ida),
      summary:
        `A draws ${peers.A.models.length} other avatar(s), B draws ${peers.B.models.length}; both hold the other's pose ` +
        `(${peers.A.poses.length}, ${peers.B.poses.length}). Sends before the channel was open: ` +
        Object.entries(lost).map(([c, n]) => `${c} ${Object.entries(n).map(([l, k]) => `${l} x${k}`).join(", ") || "none"}`).join("; "),
      data: { peers, sendsBeforeOpen: lost, bFacingAOffDegrees: facing }
    };
  });

  await evidence.check("The other's avatar moves (pose arrives and follows)", "B3", async () => {
    const [ida, idb] = [(await readSession(a.page)).clientId, (await readSession(b.page)).clientId];
    const aTrace = await tracePose(b.page, ida, async () => {
      await input.walk(a.page, "w", 1500);
      await input.snapTurn(a.page, "left", 1);
      await input.look(a.page, -150, 60);
      await input.walk(a.page, "s", 800);
      await a.page.waitForTimeout(500);
    });
    const aMoved = movement(aTrace);
    const [aOwn, aSeenByB] = [await readPose(a.page, ida), await readPose(b.page, ida)];
    const gap = aOwn && aSeenByB ? Math.hypot(aOwn.rig[0] - aSeenByB.rig[0], aOwn.rig[2] - aSeenByB.rig[2]) : NaN;
    await input.faceTowards(b.page, { clientId: ida });
    await evidence.screenshot(b, "facing-A-after-walk");
    const bTrace = await tracePose(a.page, idb, async () => {
      await input.walk(b.page, "w", 1000);
      await b.page.waitForTimeout(500);
    });
    const bMoved = movement(bTrace);
    evidence.saveJson("pose-traces.json", { aAsSeenByB: aTrace, bAsSeenByA: bTrace }, "pose traces: each client's copy of the other while it moved");
    const ok = aMoved.travelled >= 2 && aMoved.turned >= 30 && aMoved.pitchRange >= 5 && gap < 0.15 && aMoved.seqAdvanced > 0 && bMoved.travelled >= 1;
    return {
      ok,
      summary:
        `B's copy of A: ${aMoved.travelled} m walked, ${aMoved.turned}° turned, head pitch range ${aMoved.pitchRange}°, ` +
        `${aMoved.seqAdvanced} packets; ends ${gap.toFixed(3)} m from A's own pose. A's copy of B: ${bMoved.travelled} m`,
      data: { aSeenByB: aMoved, bSeenByA: bMoved, endGapMetres: gap, aOwn, aSeenByBEnd: aSeenByB }
    };
  });

  await evidence.check("Recording button downloads a JSON with avatar pose entries", "B5", async () => {
    const [ida, idb] = [(await readSession(a.page)).clientId, (await readSession(b.page)).clientId];
    // #avatar-pose; #avatar-RIG on the adapter build (develop)
    const label = poseLabel(await capabilities(a.page));
    await input.startRecording(a.page);
    const recordingOn = (await readSession(a.page)).isRecording;
    await evidence.screenshot(a, "recording");
    await Promise.all([input.walk(b.page, "s", 1500), input.walk(a.page, "d", 1000)]);
    await a.page.waitForTimeout(7500);
    const download = await input.stopRecording(a.page);
    const name = download.suggestedFilename();
    const file = evidence.file(`recording-${a.name}.json`);
    await download.saveAs(file);
    evidence.addFile(`recording-${a.name}.json`, "recording", `the recording A downloaded (${name})`);
    const summary = summariseRecording(fs.readFileSync(file, "utf8"), label);
    const recordingOff = (await readSession(a.page)).isRecording;
    const ok =
      recordingOn === true && recordingOff === false && name.startsWith(`chutvrc-recording-${start.hubId}-`) &&
      summary.valid && summary.poseSent > 0 && summary.poseReceived > 0 && summary.poseSenders.includes(idb);
    return {
      ok,
      summary:
        `${name}: ${summary.valid ? "valid JSON" : `not JSON (${summary.error})`}, ${summary.entries} entries over ${summary.spanSeconds} s; ` +
        `${label} ${summary.poseSent} sent, ${summary.poseReceived} received (from B: ${summary.poseReceivedBySender[idb] ?? 0}` +
        `, A's own packets coming back: ${summary.poseReceivedBySender[ida] ?? 0})`,
      data: { name, recordingOn, recordingOff, ownPacketsReceivedBack: summary.poseReceivedBySender[ida] ?? 0, ...summary }
    };
  });

  await evidence.check("Room move through an in-world link, without a page load", "B6", async () => {
    const before = { A: await readSession(a.page), B: await readSession(b.page) };
    await input.placeFromUrl(a.page, linkUrl);
    await Promise.all([input.waitForRoomLink(a.page, linkUrl), input.waitForRoomLink(b.page, linkUrl)]);
    await a.page.waitForTimeout(1000);
    await evidence.screenshot(a, "link-placed");
    const bOffDegrees = await input.faceTowards(b.page, { mediaSrc: linkUrl });
    await evidence.screenshot(b, "facing-link");

    const moveThrough = async (c: Client) => {
      const t0 = Date.now();
      await input.clickHoverMenuButton(c.page, linkUrl, "visit room");
      await c.page.waitForFunction(id => (window as any).APP?.hub?.hub_id === id, target.hubId, { timeout: 30_000 });
      await c.page.waitForFunction(IS_CONNECTED, undefined, { timeout: 30_000 });
      return Date.now() - t0;
    };
    // B goes first, using the link A placed; then B must hold nothing of the room it left
    const bMoveMs = await moveThrough(b);
    await b.page.waitForTimeout(3000);
    const bAlone = await readPeers(b.page);
    await evidence.screenshot(b, "moved");
    const aMoveMs = await moveThrough(a);
    await a.page.waitForTimeout(4000);
    const after = { A: await readSession(a.page), B: await readSession(b.page) };
    const audio = await twoWayAudio(a, b);
    const peers = { A: await readPeers(a.page), B: await readPeers(b.page) };
    await input.faceTowards(a.page, { clientId: after.B.clientId });
    await evidence.screenshot(a, "moved");

    const noReload = before.A.pageLoadedAt === after.A.pageLoadedAt && before.B.pageLoadedAt === after.B.pageLoadedAt;
    const inTarget = [after.A, after.B].every(s => s.hubId === target.hubId && new URL(s.url).pathname.startsWith(`/${target.hubId}`));
    const connected = [after.A, after.B].every(s => s.isConnected && s.sfuId === SFU_ID[target.mediaServer] && s.micTrack === "live");
    const leftNothing = bAlone.poses.length === 0 && bAlone.models.length === 0 && bAlone.avatarEntities === 0;
    const seeEachOther = peers.A.poses.includes(after.B.clientId) && peers.B.poses.includes(after.A.clientId);
    return {
      ok: noReload && inTarget && connected && leftNothing && seeEachOther && audio.ok,
      summary:
        `B moved in ${(bMoveMs / 1000).toFixed(1)} s, A in ${(aMoveMs / 1000).toFixed(1)} s; page loaded again: ${!noReload}; ` +
        `both in ${target.hubId}: ${inTarget}; connected with live microphone: ${connected}; ` +
        `B held from the old room ${bAlone.poses.length} pose(s), ${bAlone.models.length} model(s), ${bAlone.avatarEntities} avatar entit(ies); ` +
        `poses of each other after the move: ${seeEachOther}; B hears A ${pilotText(audio.bHearsA)}, A hears B ${pilotText(audio.aHearsB)}`,
      data: { before, after, bMoveMs, aMoveMs, bAlone, peers, audio, bOffDegreesFacingLink: bOffDegrees, resolverStatus: resolver }
    };
  });

  await evidence.check("No console errors outside the allow-list", "T6.10", async () => {
    const { unexpected, allowed } = collectErrors([a, b], CONSOLE_ALLOW_LIST);
    evidence.saveJson("errors.json", { unexpected, allowedByReason: countByReason(allowed), allowed }, "console errors, sorted by the allow-list");
    return {
      ok: unexpected.length === 0,
      summary:
        `${unexpected.length} unexpected, ${allowed.length} allowed` +
        (unexpected.length ? `; first: ${unexpected[0].client} ${unexpected[0].type}: ${unexpected[0].text.split("\n")[0].slice(0, 160)}` : ""),
      data: { unexpected: unexpected.map(e => `${e.client} ${e.type}: ${e.text.split("\n")[0].slice(0, 300)} ${e.url ?? ""}`), allowedByReason: countByReason(allowed) }
    };
  });

  await evidence.check("No request to a reticulum.io host", "T6.8", async () => {
    const hosts = reticulumIoHosts([a, b]);
    return { ok: hosts.length === 0, summary: hosts.length ? `requests to ${hosts.join(", ")}` : "none", data: { hosts } };
  });
}

// Plan 4: T1 at the start of every run, on Dialog and on LiveKit. The Dialog test runs in the Dialog block,
// the LiveKit test in whichever LiveKit block the run uses (MEDIA_BLOCK, suites/blocks.ts).
test.describe("T1 smoke", () => {
  for (const server of ["dialog", "livekit"] as const) {
    test(
      `T1 smoke on ${blockTitle(server)}`,
      {
        annotation: [
          { type: "id", description: `t1-smoke-${blockId(server)}` },
          { type: "covers", description: server === "dialog" ? "B1 B2 B3 B5 B6" : "B1 B2 B3 B5 B6 L2 L3" }
        ]
      },
      async ({ evidence }) => {
        runsOn(server);
        await smoke(evidence, server);
      }
    );
  }
});
