// T3 public speaking (plan 4): a speaker in room X (speak-x) speaks through the global "public_speaking"
// room; the owner of a listening room (listen-y, listen-z) starts listening, which relays the speaker into
// that room as a stand-in client "PS-<speaker's id>" with the speaker's voice and pose
// (src/systems/public-speaking-system.js). Every client of the listening room should hear and see the
// stand-in.
//
// T3.1, T3.2, T3.4 and T3.5 run on Dialog; T3.3 is T3.1 on LiveKit (a probe: reticulum issues LiveKit
// tokens only for the hub's own room and the session's own identity, so delivery is not expected); T3.6
// switches the speaker's room to LiveKit while speaking and runs in a LiveKit block (it needs a LiveKit
// server to switch to). No workaround for the avatar announcement is used here: the stand-in's presence is
// a subject of T3.1.
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { room, SFU_ID, type MediaServer, type RoomName } from "../lib/fixtures";
import { sql, sqlText } from "../lib/stack";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { ensureSignedIn } from "../clients/signin";
import { enterRoom } from "../clients/enter";
import { speakerGestures, startTimeline, stopTimeline, takeApplied, exitVr, enterVr, isPresenting } from "../clients/motion";
import { CONTROL_HZ } from "../assets/media";
import { QUESTION_PDF_URL } from "../assets/generate";
import { heardPilot, type PilotResult } from "../probes/audio";
import { drawsAvatar, readPeers, readSession } from "../probes/session";
import { SELF, align, changeOver, recordFrames, tracesCsv, LEFT_HAND, RIGHT_HAND, type Channel, type FrameSample } from "../probes/poses";
import { messagesOf, recordPackets, startPacketLog, summarisePackets, takePacketLog } from "../probes/packets";
import { BLOCK, blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, exceptionsSince, frameRateCheck, heard, idOf, logMarks, pilotText, startClients, waitUntil, type Seat } from "./common";

const ANGLES: Channel = s => [s.yaw, s.headYaw, s.pitch];
const deg = (rad: number) => (rad * 180) / Math.PI;

/** The public speaking sessions of a page: the speaker's, the listener's mirror and its agents in the room */
type SpeakingSessions = {
  speaking: { sfuId: number | null; isConnected: boolean; clientId: string } | null;
  mirror: { sfuId: number | null; isConnected: boolean; clientId: string } | null;
  agents: { clientId: string; sfuId: number | null; isConnected: boolean }[];
};

function speakingSessions(c: Client): Promise<SpeakingSessions> {
  return c.page.evaluate(() => {
    const APP = (window as any).APP;
    const describe = (s: any) => (s ? { sfuId: s.sfuId ?? null, isConnected: !!s.isConnected, clientId: s.clientId ?? "" } : null);
    return {
      speaking: describe(APP.publicSpeakingSfu),
      mirror: describe(APP.publicSpeakersMirrorSfu),
      agents: Object.entries(APP.publicSpeakerAgentSfus ?? {}).map(([clientId, s]: [string, any]) => ({ clientId, sfuId: s?.sfuId ?? null, isConnected: !!s?.isConnected }))
    };
  });
}

const sessionsText = (c: Client, s: SpeakingSessions) =>
  `${c.name}: speaking ${s.speaking ? `${s.speaking.clientId} sfuId ${s.speaking.sfuId} connected ${s.speaking.isConnected}` : "none"}, mirror ${s.mirror ? `sfuId ${s.mirror.sfuId} connected ${s.mirror.isConnected}` : "none"}, agents ${s.agents.map(a => `${a.clientId} connected ${a.isConnected}`).join(" ") || "none"}`;

async function startSpeaking(a: Client) {
  await input.chutvrcAction(a.page, "Broadcast", "Start Speaking", () => a.page.evaluate(() => !!(window as any).APP.publicSpeakingSfu));
  await a.page.keyboard.press("Escape").catch(() => {});
}

/**
 * Broadcast > Stop Speaking. The menu keeps whether it is speaking in its own state, which starts as "not
 * speaking" each time the menu is shown again (PublicSpeakingMenu.js), so after the popover was closed it
 * offers "Start Speaking" while the speaking session runs. A user then clicks it (the session ignores the
 * second start, the label turns) and then "Stop Speaking"; this does the same and returns what the menu showed.
 */
async function stopSpeaking(a: Client): Promise<{ shown: string; clicks: number }> {
  const speaking = () => a.page.evaluate(() => !!(window as any).APP.publicSpeakingSfu);
  const shownNow = () =>
    a.page.evaluate(() => {
      const labels = [...document.querySelectorAll("button")].filter(b => b.getBoundingClientRect().width > 0).map(b => b.textContent?.trim());
      return labels.includes("Stop Speaking") ? "Stop Speaking" : labels.includes("Start Speaking") ? "Start Speaking" : "neither";
    });
  // Opens Chutvrc > Broadcast without clicking an action (clicking Broadcast again would close the menu)
  const visible = (label: string) =>
    a.page.evaluate(label => [...document.querySelectorAll("button")].some(b => b.textContent?.trim() === label && b.getBoundingClientRect().width > 0), label);
  if ((await shownNow()) === "neither") {
    if (!(await visible("Broadcast"))) {
      await input.toolbarButton(a.page, "Chutvrc").click();
      await a.page.waitForTimeout(300);
    }
    if ((await shownNow()) === "neither") {
      await input.clickPopoverItem(a.page, "Broadcast");
      await a.page.waitForTimeout(300);
    }
  }
  const shown = await shownNow();
  let clicks = 0;
  if (shown === "Start Speaking" && (await speaking())) {
    await input.clickPopoverItem(a.page, "Start Speaking");
    clicks++;
    await a.page.waitForTimeout(500);
  }
  await input.clickPopoverItem(a.page, "Stop Speaking");
  clicks++;
  await waitUntil(async () => !(await speaking()), 5000);
  await a.page.keyboard.press("Escape").catch(() => {});
  return { shown, clicks };
}

async function startListening(b: Client) {
  await input.chutvrcAction(b.page, "Broadcast", "Start Listening", () => b.page.evaluate(() => !!(window as any).APP.publicSpeakersMirrorSfu));
  await b.page.keyboard.press("Escape").catch(() => {});
}

/** What reticulum answers a client's refresh_sfu_token (what the listener's agent session waits for) */
function sfuTokenReply(c: Client): Promise<string> {
  return c.page.evaluate(() =>
    (window as any).APP.hubChannel.fetchSfuToken().then(
      (r: any) => `ok (a token for room ${r.roomId ?? "?"})`,
      (e: any) => `error ${e instanceof Error ? e.message : JSON.stringify(e)}`
    )
  );
}

/** What a client in a listening room has of the stand-in: its pose, its model drawn, the speaker's pilot */
async function standIn(c: Client, psId: string, pilotHz: number, ms = 4000) {
  const peers = await readPeers(c.page);
  const drawn = await drawsAvatar(c.page, psId);
  const pilot = await heardPilot(c.page, psId, pilotHz, CONTROL_HZ, ms);
  return { pose: peers.poses.includes(psId), model: drawn.model, visible: drawn.visible, pilot, peers };
}

const standInText = (c: Client, s: Awaited<ReturnType<typeof standIn>>) =>
  `${c.name}: pose ${s.pose ? "yes" : "no"}, model ${s.model ? (s.visible ? "drawn" : "loaded, hidden") : "none"}, ${pilotText(s.pilot)}`;

/** The speaker's main session: connected to its room's server, microphone live and on, sending its pose */
async function mainSessionState(a: Client, server: MediaServer) {
  const session = await readSession(a.page);
  const entries = await recordPackets(a.page, 2000).catch(() => []);
  const sent = summarisePackets(entries, 2).byLabel["#avatar-pose"]?.sentPerSecond ?? 0;
  return {
    session,
    sentPosePerSecond: sent,
    ok: session.sfuId === SFU_ID[server] && session.isConnected && session.micTrack === "live" && session.micEnabled === true && sent >= 25
  };
}

const mainText = (m: Awaited<ReturnType<typeof mainSessionState>>) =>
  `sfuId ${m.session.sfuId}, connected ${m.session.isConnected}, microphone ${m.session.micTrack}${m.session.micEnabled ? "" : " (off)"}, #avatar-pose sent ${m.sentPosePerSecond}/s`;

/** Sets rooms' media server in the database (plan 1.5: speak-x, listen-y and listen-z start on Dialog); returns a restore function */
function setRoomsServer(names: RoomName[], server: MediaServer): () => void {
  const ids = names.map(n => room(n).hubId);
  const before = ids.map(id => [id, sql(`select sfu from ret0.hubs where hub_sid = ${sqlText(id)}`)] as const);
  sql(`update ret0.hubs set sfu = ${SFU_ID[server]} where hub_sid in (${ids.map(sqlText).join(", ")})`);
  return () => {
    for (const [id, sfu] of before) sql(`update ret0.hubs set sfu = ${Number(sfu)} where hub_sid = ${sqlText(id)}`);
  };
}

/** Sets rooms' scene in the database; returns a restore function */
function setRoomsScene(names: RoomName[], sceneSid: string): () => void {
  const ids = names.map(n => room(n).hubId);
  const before = ids.map(id => [id, sql(`select scene_id from ret0.hubs where hub_sid = ${sqlText(id)}`)] as const);
  sql(`update ret0.hubs set scene_id = (select scene_id from ret0.scenes where scene_sid = ${sqlText(sceneSid)}) where hub_sid in (${ids.map(sqlText).join(", ")})`);
  return () => {
    for (const [id, sceneId] of before) sql(`update ret0.hubs set scene_id = ${sceneId} where hub_sid = ${sqlText(id)}`);
  };
}

/** Enters each client into its room, all at once; notes the rooms */
async function enterRooms(evidence: Evidence, placed: [Client, RoomName][]) {
  const timings = await Promise.all(placed.map(([c, r]) => enterRoom(c, room(r).hubId, { displayName: c.name })));
  evidence.saveJson("entry.json", Object.fromEntries(placed.map(([c, r], i) => [c.name, { room: r, hubId: room(r).hubId, ...timings[i] }])), "entry timings (ms from opening the page) and rooms");
  evidence.note(placed.map(([c, r]) => `${c.name} in ${r} ${room(r).hubId}`).join("; "));
}

/** Waits until every listener holds the stand-in's pose; returns when each first did (ms from now) */
async function waitForStandIn(listeners: Client[], psId: string, timeoutMs = 30_000) {
  const t0 = Date.now();
  const at: (number | null)[] = listeners.map(() => null);
  while (Date.now() - t0 < timeoutMs && at.some(v => v === null)) {
    for (const [i, c] of listeners.entries()) if (at[i] === null && (await readPeers(c.page)).poses.includes(psId)) at[i] = Date.now() - t0;
    await listeners[0].page.waitForTimeout(250);
  }
  return at;
}

// ---------- T3.1 and T3.3 ----------

async function speakAndListen(evidence: Evidence, server: MediaServer) {
  const restore = server === "livekit" ? setRoomsServer(["speak-x", "listen-y"], "livekit") : () => {};
  if (server === "livekit") evidence.note("speak-x and listen-y set to LiveKit for this test (plan 1.5: Dialog, then LiveKit) and set back afterwards");
  try {
    const [a, b, c] = await startClients(evidence, [
      { identity: "admin", account: "admin", slot: "a" },
      { identity: "member1", account: "member1", slot: "b" },
      { identity: "member2", account: "member2", slot: "c" }
    ]);
    await enterRooms(evidence, [
      [a, "speak-x"],
      [b, "listen-y"],
      [c, "listen-y"]
    ]);
    await frameRateCheck(evidence, [a, b, c]);
    const ida = await idOf(a);
    const psId = `PS-${ida}`;
    const marks = logMarks([a, b, c]);
    const before = await mainSessionState(a, server);

    await startSpeaking(a);
    await a.page.waitForTimeout(3000);
    await startListening(b);
    const arrival = await waitForStandIn([b, c], psId, server === "livekit" ? 20_000 : 30_000);
    const sessions = { A: await speakingSessions(a), B: await speakingSessions(b) };
    // The listener's agent session needs an SFU token from reticulum before it connects into Y
    const tokenReply = await sfuTokenReply(b);
    evidence.note(`the listener's hub channel answers refresh_sfu_token with ${tokenReply} (initPublicSpeakerAgent awaits APP.hubChannel.getSfuTokenOrFetch() before it connects the agent into the listening room)`);
    evidence.saveJson("sessions.json", sessions, "the public speaking sessions of the speaker and the listener");
    await input.faceTowards(c.page, { clientId: psId });
    await evidence.screenshot(c, "C-sees-stand-in");
    await evidence.screenshot(a, "A-speaking");
    const atB = await standIn(b, psId, a.pilotHz);
    const atC = await standIn(c, psId, a.pilotHz);
    const during = await mainSessionState(a, server);

    // The stand-in's head against the speaker's own, while the speaker looks around
    // B's copy too: the listener's own mirror session writes the speaker's pose into B's page-wide pose
    // store, which shows whether the speaking session sends the pose at all, before any relay into Y
    const [sender, receiver, atMirror] = await recordFrames(
      [
        { page: a.page, ids: [SELF] },
        { page: c.page, ids: [psId] },
        { page: b.page, ids: [psId] }
      ],
      async () => {
        for (const [dx, dy] of [[-300, 60], [500, -100], [-200, 40]] as const) await input.look(a.page, dx, dy, 30);
        await a.page.waitForTimeout(800);
      }
    );
    const own = sender[SELF] ?? [];
    const copy = receiver[psId] ?? [];
    const mirrored = atMirror[psId] ?? [];
    evidence.saveText("pose-traces.csv", tracesCsv({ "A own": own, "stand-in at C": copy, "speaker at B": mirrored }), "per-frame traces: the speaker's own pose, C's copy of the stand-in and B's (the listener's)", "data");

    const stopMenu = await stopSpeaking(a).catch(e => ({ shown: `not reachable (${(e as Error).message.split("\n")[0].slice(0, 80)})`, clicks: 0 }));
    const removed = await waitUntil(async () => {
      const [pb, pc] = [await readPeers(b.page), await readPeers(c.page)];
      return !pb.poses.includes(psId) && !pc.poses.includes(psId) && !pb.models.includes(psId) && !pc.models.includes(psId);
    }, 15_000);
    const afterStop = { B: await readPeers(b.page), C: await readPeers(c.page), sessionsB: await speakingSessions(b) };
    await evidence.screenshot(c, "C-after-stop");
    const after = await mainSessionState(a, server);
    evidence.saveJson("stand-in.json", { arrival, atB, atC, afterStop, removedMs: removed.timedOut ? null : removed.ms }, "the stand-in in the listening room: arrival, pose, model, pilot, removal");

    const arrived = atB.pose && atC.pose && heard(atB.pilot) && heard(atC.pilot);
    if (server === "livekit") {
      await evidence.check("A's main session stays connected and keeps sending while it speaks (required)", "F2 A2", async () => ({
        ok: before.ok && during.ok && after.ok,
        summary: `before speaking: ${mainText(before)}; while speaking: ${mainText(during)}; after: ${mainText(after)}`,
        data: { before, during, after }
      }));
      await evidence.check("What the listening room receives (recorded; delivery is not expected)", "F2 A2", async () => ({
        ok: true,
        summary:
          `${standInText(b, atB)}; ${standInText(c, atC)}; stand-in pose first held after ${arrival.map(v => (v === null ? "never" : `${v} ms`)).join(" / ")} (B / C); ` +
          `${sessionsText(a, sessions.A)}; ${sessionsText(b, sessions.B)}`,
        data: { atB, atC, sessions, arrival }
      }));
      const errors = [a, b, c].flatMap(cl => cl.log.filter(e => (e.type === "error" || e.type === "pageerror") && /livekit|token|public_speaking|PS-|PC manager|negotiation/i.test(e.text)).slice(0, 3).map(e => `${cl.name}: ${e.text.split("\n")[0].slice(0, 200)}`));
      evidence.note(`errors about the speaking sessions: ${errors.join(" | ") || "none"}`);
      // LiveKit names the participant in its log lines: the speaker's identity under more than one participant id
      // means a second connection joined the speaker's own room under the speaker's identity
      const participants = [...new Set(a.log.flatMap(e => [...e.text.matchAll(new RegExp(`participant: ${ida}, pID: (PA_\\w+)`, "g"))].map(m => m[1])))];
      const unableShown = await a.page.evaluate(() => document.body.innerText.includes("Unable to connect to this room")).catch(() => null);
      evidence.note(`LiveKit participant ids of the speaker's identity ${ida} in its log: ${participants.join(", ") || "none"}; the speaker's page shows "Unable to connect to this room": ${unableShown}`);
      if (!arrived && before.ok && during.ok && after.ok) {
        test.info().annotations.push({ type: "known limitation", description: "LiveKit: the listening room receives nothing from the speaker (reticulum issues LiveKit tokens only for the hub's own room and identity)" });
        evidence.note("status known limitation: nothing of the speaker arrived in the listening room; the speaker's main session was unaffected");
      }
      return { a, b, c };
    }

    await evidence.check("A stand-in for A appears in Y, with A's model", "F2 B10", async () => ({
      ok: atB.pose && atC.pose && atB.model && atC.model && atC.visible,
      summary: `${standInText(b, atB)}; ${standInText(c, atC)}; pose first held after ${arrival.map(v => (v === null ? "never" : `${v} ms`)).join(" / ")} from Start Listening (B / C)`,
      data: { atB, atC, arrival }
    }));
    await evidence.check("B and C hear A's pilot through the stand-in", "F2", async () => ({
      ok: heard(atB.pilot) && heard(atC.pilot),
      summary: `B ${pilotText(atB.pilot)}, C ${pilotText(atC.pilot)}`,
      data: { b: atB.pilot, c: atC.pilot }
    }));
    await evidence.check("The stand-in's head follows A's", "B10", async () => {
      const r = align(own, copy, ANGLES, { maxLagMs: 800 });
      const range = (t: FrameSample[]) => (t.length ? deg(Math.max(...t.map(s => s.headYaw)) - Math.min(...t.map(s => s.headYaw))) : 0);
      return {
        ok: !!r && deg(r.rms) < 3 && range(copy) >= 0.8 * range(own) && range(own) > 10,
        summary: r
          ? `lag ${r.lagMs} ms; head angle error after alignment rms ${deg(r.rms).toFixed(2)}°, max ${deg(r.max).toFixed(2)}°; head yaw range A ${range(own).toFixed(0)}°, stand-in ${range(copy).toFixed(0)}° (${copy.length} frames; judged rms under 3°)`
          : `too few frames (A ${own.length}, stand-in at C ${copy.length})`,
        data: r
      };
    });
    await evidence.check("Stop Speaking removes the stand-in from Y", "F2", async () => ({
      ok: !atC.pose ? ("not applicable" as const) : !removed.timedOut,
      summary: !atC.pose
        ? `cannot be judged: the stand-in never appeared at C; B's own copy (its mirror session's) ${removed.timedOut ? "was still held after 15 s" : `was gone ${removed.ms} ms after Stop Speaking`}`
        : removed.timedOut
        ? `after 15 s: B holds the stand-in's pose ${afterStop.B.poses.includes(psId)}, model ${afterStop.B.models.includes(psId)}; C pose ${afterStop.C.poses.includes(psId)}, model ${afterStop.C.models.includes(psId)}; ${sessionsText(b, afterStop.sessionsB)}`
        : `gone from B and C after ${removed.ms} ms`,
      data: afterStop
    }));
    await evidence.check("The speaker's pose reaches the listener's own mirror session (recorded: the relay's input)", "B10", async () => {
      const r = align(own, mirrored, ANGLES, { maxLagMs: 800 });
      return {
        ok: true,
        summary: mirrored.length
          ? `B holds the speaker's pose (${mirrored.length} frames); head angle error after alignment rms ${r ? deg(r.rms).toFixed(2) : "?"}° at lag ${r?.lagMs ?? "?"} ms`
          : "B holds no pose of the speaker: the speaking session's poses do not reach the listener",
        data: r
      };
    });
    await evidence.check("The Broadcast menu offers Stop Speaking while A speaks", "F2", async () => ({
      ok: stopMenu.shown === "Stop Speaking",
      summary:
        stopMenu.shown === "Stop Speaking"
          ? "Stop Speaking shown; one click stopped"
          : `the menu, shown again after it was closed, offered "${stopMenu.shown}" while the speaking session ran; ${stopMenu.clicks} clicks stopped it (PublicSpeakingMenu.js keeps publicSpeakerActive in the menu's own state, which starts false each time the menu mounts; the same on develop)`,
      data: stopMenu
    }));
    await evidence.check("A's own session is unaffected", "F2 A1f", async () => ({
      ok: before.ok && during.ok && after.ok && exceptionsSince([a], marks).length === 0,
      summary: `before speaking: ${mainText(before)}; while speaking: ${mainText(during)}; after: ${mainText(after)}; exceptions on A ${exceptionsSince([a], marks).length}`,
      data: { before, during, after }
    }));
    return { a, b, c };
  } finally {
    restore();
  }
}

// ---------- T3.2 ----------

async function twoRoomsListen(evidence: Evidence) {
  const [a, b, d, c] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" },
    { identity: "member2", account: "member2", slot: "d" },
    { identity: "guest", slot: "c", name: "C-guest" }
  ]);
  await enterRooms(evidence, [
    [a, "speak-x"],
    [b, "listen-y"],
    [d, "listen-z"],
    [c, "listen-y"]
  ]);
  await frameRateCheck(evidence, [a, b, d, c]);
  const psId = `PS-${await idOf(a)}`;
  await startSpeaking(a);
  await a.page.waitForTimeout(3000);
  await Promise.all([startListening(b), startListening(d)]);
  const arrival = await waitForStandIn([b, c, d], psId);
  const rows = await Promise.all([b, c, d].map(async l => ({ l, s: await standIn(l, psId, a.pilotHz) })));
  for (const l of [c, d]) {
    await input.faceTowards(l.page, { clientId: psId });
    await evidence.screenshot(l, "sees-stand-in");
  }
  await evidence.check("Y and Z, listening at once, both receive A", "F2", async () => ({
    ok: rows.every(r => r.s.pose && heard(r.s.pilot)),
    summary: rows.map((r, i) => `${standInText(r.l, r.s)} (pose after ${arrival[i] ?? "never"} ms)`).join("; "),
    data: rows.map(r => ({ name: r.l.name, ...r.s }))
  }));
  await evidence.check("Both listening rooms draw the stand-in", "F2 B10", async () => ({
    ok: rows.every(r => r.s.model && r.s.visible),
    summary: rows.map(r => `${r.l.name}: ${r.s.model ? (r.s.visible ? "drawn" : "hidden") : "no model"}`).join(", ")
  }));
  await stopSpeaking(a).catch(() => {});
  await closingChecks(evidence, [a, b, d, c]);
}

// ---------- T3.4 ----------

async function pdfAndLaser(evidence: Evidence) {
  const nimpro = room("nimpro");
  const restoreScene = setRoomsScene(["speak-x", "listen-y"], nimpro.sceneId!);
  evidence.note(`speak-x and listen-y use the N-impro scene (${nimpro.sceneId}) for this test, for its question slide (${QUESTION_PDF_URL}), and get their scene back afterwards`);
  try {
    const [a, b, c] = await startClients(evidence, [
      { identity: "admin", account: "admin", slot: "a" },
      { identity: "member1", account: "member1", slot: "b" },
      { identity: "member2", account: "member2", slot: "c" }
    ]);
    await enterRooms(evidence, [
      [a, "speak-x"],
      [b, "listen-y"],
      [c, "listen-y"]
    ]);
    const psId = `PS-${await idOf(a)}`;
    await startSpeaking(a);
    await a.page.waitForTimeout(3000);
    await startListening(b);
    await waitForStandIn([b, c], psId);
    // The speaker's speaking session's own packet log: is #pdfPage or #laserPointer sent at all?
    await a.page.evaluate(() => {
      const bus = (window as any).APP.publicSpeakingSfu?.bus;
      bus?.takeRecording();
      bus?.startRecording();
    });
    await Promise.all([b, c].map(l => startPacketLog(l.page)));
    await input.faceTowards(a.page, { mediaSrc: QUESTION_PDF_URL });
    await input.faceTowards(c.page, { mediaSrc: QUESTION_PDF_URL });
    const pagesBefore = await Promise.all([a, b, c].map(cl => input.pdfPageOf(cl.page, QUESTION_PDF_URL)));
    await input.pagePdf(a.page, QUESTION_PDF_URL, "next");
    await a.page.waitForTimeout(500);
    await input.pagePdf(a.page, QUESTION_PDF_URL, "next");
    const followed = await waitUntil(async () => {
      const p = await Promise.all([b, c].map(cl => input.pdfPageOf(cl.page, QUESTION_PDF_URL)));
      return p.every(x => x === (pagesBefore[0] ?? 0) + 2) ? p : null;
    }, 10_000);
    // Points at the slide for 4 s
    const { width, height } = a.page.viewportSize() ?? { width: 1280, height: 720 };
    for (let i = 0; i < 40; i++) {
      await a.page.mouse.move(width / 2 + 120 * Math.sin(i / 5), height / 2 + 60 * Math.cos(i / 5));
      await a.page.waitForTimeout(100);
    }
    await evidence.screenshot(a, "A-pages-and-points");
    await evidence.screenshot(c, "C-sees-slide");
    const pagesAfter = await Promise.all([a, b, c].map(cl => input.pdfPageOf(cl.page, QUESTION_PDF_URL)));
    const speakerLog = await a.page.evaluate(() => {
      const bus = (window as any).APP.publicSpeakingSfu?.bus;
      if (!bus) return null;
      bus.stopRecording();
      return bus.takeRecording().map((e: any) => ({ l: e.l, s: e.s, m: typeof e.m === "string" ? e.m.slice(0, 40) : undefined }));
    });
    const logs = await Promise.all([b, c].map(l => takePacketLog(l.page)));
    const sentBySpeaker = (label: string, match?: RegExp) => (speakerLog ?? []).filter((e: any) => e.l === label && e.s === 1 && (!match || match.test(e.m ?? ""))).length;
    evidence.saveJson("pdf-and-laser.json", { pagesBefore, pagesAfter, speakerLog: speakerLog?.slice(0, 200), received: logs.map(l => summarisePackets(l)) }, "slide pages, what the speaking session sent and what Y received");
    await evidence.check("The speaker pages the slide: Y's slide follows", "F3", async () => ({
      ok: !!followed.value,
      summary:
        `pages before ${pagesBefore.join("/")}, after ${pagesAfter.join("/")} (A/B/C); the speaking session sent #pdfPage ${sentBySpeaker("#pdfPage")} times; B and C received #pdfPage ${logs.map(l => messagesOf(l, "#pdfPage", "received").length).join(" and ")} times` +
        (sentBySpeaker("#pdfPage") === 0
          ? ". media-loader.js sends the page over the speaking session only for an object whose media-loader isPinned is true (line 695) and applies a received one only then (line 687); nothing sets isPinned, which stays at its schema default false, also for scene media (gltf-component-mappings.js); the same on develop"
          : ""),
      data: { pagesBefore, pagesAfter }
    }));
    await evidence.check("The speaker's laser pointer is shown in Y", "F3", async () => {
      const received = logs.map(l => messagesOf(l, "#laserPointer", "received", /^1\|/).length);
      return {
        ok: received.every(n => n > 0),
        summary:
          `the speaking session sent #laserPointer ${sentBySpeaker("#laserPointer")} times, ${sentBySpeaker("#laserPointer", /^1\|/)} of them with a position (the rest hide the pointer); B and C received positions ${received.join(" and ")} times` +
          (sentBySpeaker("#laserPointer", /^1\|/) === 0 ? "; known failure 10 of BASELINE.md: cursor-controller.js sends a position only when this.isHoverTargetMainScreen is set, which nothing sets; the same on develop" : ""),
        data: { received }
      };
    });
    await stopSpeaking(a).catch(() => {});
    await closingChecks(evidence, [a, b, c]);
  } finally {
    restoreScene();
  }
}

// ---------- T3.5 ----------

async function headsetSpeaker(evidence: Evidence) {
  const [q, b, c] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "member1", account: "member1", slot: "b" },
    { identity: "member2", account: "member2", slot: "c" }
  ]);
  evidence.note("A-quest is Edge with IWER emulating a Quest 3, signed in as the admin (owner of speak-x)");
  await enterRooms(evidence, [
    [q, "speak-x"],
    [b, "listen-y"],
    [c, "listen-y"]
  ]);
  await frameRateCheck(evidence, [q, b, c]);
  const psId = `PS-${await idOf(q)}`;
  // The Broadcast menu is in the 2D interface: the headset user leaves VR, starts speaking and enters VR again
  await exitVr(q.page);
  await startSpeaking(q);
  await enterVr(q.page);
  await q.page.waitForTimeout(2000);
  await startListening(b);
  const arrival = await waitForStandIn([b, c], psId);
  await input.faceTowards(c.page, { clientId: psId });
  const DURATION = 10_000;
  const [sender, receiver, atMirror] = await recordFrames(
    [
      { page: q.page, ids: [SELF] },
      { page: c.page, ids: [psId] },
      { page: b.page, ids: [psId] }
    ],
    async () => {
      await startTimeline(q.page, speakerGestures(DURATION));
      await c.page.waitForTimeout(DURATION / 2);
      await evidence.screenshot(c, "C-sees-stand-in-gesture");
      await c.page.waitForTimeout(DURATION / 2 + 300);
    }
  );
  await stopTimeline(q.page).catch(() => {});
  const applied = await takeApplied(q.page);
  const own = sender[SELF] ?? [];
  const copy = receiver[psId] ?? [];
  const mirrored = atMirror[psId] ?? [];
  const presenting = await isPresenting(q.page);
  evidence.saveText("pose-traces.csv", tracesCsv({ "A own": own, "stand-in at C": copy, "speaker at B": mirrored }), "per-frame traces: the headset's own pose, C's copy of the stand-in and B's (the listener's)", "data");
  evidence.saveJson("devices.json", applied.filter((_, i) => i % 6 === 0), "what the emulated headset and controllers were set to (every sixth frame)");
  await evidence.check("The stand-in moves its hands as well as its head", "B10", async () => {
    const hands = (["left", "right"] as const).map(side => {
      const ch = side === "left" ? LEFT_HAND : RIGHT_HAND;
      const r = align(own, copy, ch, { maxLagMs: 800 });
      const range = (t: FrameSample[]) => (t.length ? Math.max(...[0, 1, 2].map(k => Math.max(...t.map(s => ch(s)[k])) - Math.min(...t.map(s => ch(s)[k])))) : 0);
      return { side, r, ownRange: range(own), copyRange: range(copy) };
    });
    const head = align(own, copy, ANGLES, { maxLagMs: 800 });
    const isVR = copy.slice(-30).map(s => s.isVR);
    const ok = copy.length > 100 && hands.every(h => !!h.r && h.r.p95 < 0.05 && h.copyRange >= 0.8 * h.ownRange && h.ownRange > 0.2) && !!head && deg(head.rms) < 3 && isVR.every(v => v === true);
    return {
      ok,
      summary:
        hands.map(h => `${h.side} hand: moved ${(h.ownRange * 100).toFixed(0)} cm at A, ${(h.copyRange * 100).toFixed(0)} cm at C; error after alignment p95 ${h.r ? (h.r.p95 * 100).toFixed(1) : "?"} cm (lag ${h.r?.lagMs ?? "?"} ms)`).join("; ") +
        `; head angle error rms ${head ? deg(head.rms).toFixed(2) : "?"}°; the stand-in's isVR ${[...new Set(isVR)].join("/")}; A presenting ${presenting}; stand-in first held after ${arrival.map(v => v ?? "never").join(" / ")} ms (B / C)`,
      data: { hands, head, frames: copy.length }
    };
  });
  await evidence.check("The headset speaker's hands reach the listener's own mirror session (recorded: the relay's input)", "B10", async () => {
    const r = align(own, mirrored, RIGHT_HAND, { maxLagMs: 800 });
    const moved = changeOver(mirrored, RIGHT_HAND);
    return {
      ok: true,
      summary: mirrored.length
        ? `B holds the speaker's pose (${mirrored.length} frames): right hand moved ${(moved.net * 100).toFixed(0)} cm net, error after alignment p95 ${r ? (r.p95 * 100).toFixed(1) : "?"} cm at lag ${r?.lagMs ?? "?"} ms`
        : "B holds no pose of the speaker: the speaking session's poses do not reach the listener",
      data: r
    };
  });
  await stopSpeaking(q).catch(async () => {
    await exitVr(q.page).catch(() => {});
    await stopSpeaking(q).catch(() => {});
  });
  await closingChecks(evidence, [q, b, c]);
}

// ---------- T3.6 ----------

async function switchWhileSpeaking(evidence: Evidence) {
  const restore = setRoomsServer(["speak-x", "listen-y"], "dialog");
  try {
    const [a, b, c] = await startClients(evidence, [
      { identity: "admin", account: "admin", slot: "a" },
      { identity: "member1", account: "member1", slot: "b" },
      { identity: "member2", account: "member2", slot: "c" }
    ]);
    await enterRooms(evidence, [
      [a, "speak-x"],
      [b, "listen-y"],
      [c, "listen-y"]
    ]);
    const psId = `PS-${await idOf(a)}`;
    await startSpeaking(a);
    await a.page.waitForTimeout(3000);
    await startListening(b);
    await waitForStandIn([b, c], psId);
    const before = { main: await readSession(a.page), speaking: await speakingSessions(a), atC: await standIn(c, psId, a.pilotHz) };
    await input.setRoomMediaServer(a.page, "LiveKit");
    const moved = await waitUntil(async () => (await readSession(a.page)).sfuId === SFU_ID.livekit && (await readSession(a.page)).isConnected, 30_000);
    await a.page.waitForTimeout(3000);
    const onLiveKit = { main: await readSession(a.page), speaking: await speakingSessions(a), atC: await standIn(c, psId, a.pilotHz) };
    await evidence.screenshot(c, "C-after-switch");
    await input.setRoomMediaServer(a.page, "Dialog");
    const back = await waitUntil(async () => (await readSession(a.page)).sfuId === SFU_ID.dialog && (await readSession(a.page)).isConnected, 30_000);
    await a.page.waitForTimeout(3000);
    const backOnDialog = { main: await readSession(a.page), speaking: await speakingSessions(a), atC: await standIn(c, psId, a.pilotHz) };
    evidence.saveJson("switch.json", { before, onLiveKit, backOnDialog, movedMs: moved.ms, backMs: back.ms }, "the speaker's sessions and the stand-in in Y around the switch");
    const row = (name: string, s: typeof before) =>
      `${name}: main sfuId ${s.main.sfuId} connected ${s.main.isConnected} microphone ${s.main.micTrack}; speaking session sfuId ${s.speaking.speaking?.sfuId ?? "none"} connected ${s.speaking.speaking?.isConnected ?? false}; at C ${standInText(c, s.atC)}`;
    await evidence.check("Recorded: the speaker's sessions and the stand-in when the speaker's room switches to LiveKit and back", "F2 L1", async () => ({
      ok: !moved.timedOut && !back.timedOut && onLiveKit.main.micTrack === "live" && backOnDialog.main.micTrack === "live",
      summary: `${row("before", before)}; ${row("on LiveKit", onLiveKit)}; ${row("back on Dialog", backOnDialog)}; main session moved in ${moved.timedOut ? "more than 30000" : moved.ms} ms and back in ${back.timedOut ? "more than 30000" : back.ms} ms`,
      data: { before, onLiveKit, backOnDialog }
    }));
    await stopSpeaking(a).catch(() => {});
    await closingChecks(evidence, [a, b, c]);
  } finally {
    restore();
  }
}

// ---------- The tests ----------

test.describe("T3 public speaking", () => {
  test(
    "T3.1 a speaker in X heard and seen in Y, on Dialog",
    { annotation: [{ type: "id", description: "t3.1-dialog" }, { type: "covers", description: "F2 A1f B10" }] },
    async ({ evidence }) => {
      runsOn("dialog");
      const { a, b, c } = await speakAndListen(evidence, "dialog");
      await closingChecks(evidence, [a, b, c]);
    }
  );
  test(
    "T3.2 Y and Z listen at once, on Dialog",
    { annotation: [{ type: "id", description: "t3.2-dialog" }, { type: "covers", description: "F2" }] },
    async ({ evidence }) => {
      runsOn("dialog");
      await twoRoomsListen(evidence);
    }
  );
  test(
    `T3.3 public speaking on ${blockTitle("livekit")} (probe)`,
    { annotation: [{ type: "id", description: `t3.3-${blockId("livekit")}` }, { type: "covers", description: "F2 A2" }] },
    async ({ evidence }) => {
      runsOn("livekit");
      const { a, b, c } = await speakAndListen(evidence, "livekit");
      await closingChecks(evidence, [a, b, c]);
    }
  );
  test(
    "T3.4 the speaker pages a PDF and points with the laser, on Dialog",
    { annotation: [{ type: "id", description: "t3.4-dialog" }, { type: "covers", description: "F3" }] },
    async ({ evidence }) => {
      runsOn("dialog");
      await pdfAndLaser(evidence);
    }
  );
  test(
    "T3.5 a headset speaker's stand-in moves its hands, on Dialog",
    { annotation: [{ type: "id", description: "t3.5-dialog" }, { type: "covers", description: "B10" }] },
    async ({ evidence }) => {
      runsOn("dialog");
      await headsetSpeaker(evidence);
    }
  );
  test(
    `T3.6 the speaker's room switches media server while speaking, Dialog to ${blockTitle("livekit")} (known limitation)`,
    {
      annotation: [
        { type: "id", description: `t3.6-${blockId("livekit")}` },
        { type: "covers", description: "F2 L1" },
        { type: "known limitation", description: "the speaking sessions stay on the server they started on (chutvrc_sfu-avatar-refactor_changes 2.7)" }
      ]
    },
    async ({ evidence }) => {
      runsOn("livekit");
      await switchWhileSpeaking(evidence);
    }
  );
});

// Silence unused-import warnings for helpers kept for the later steps' variants
void ensureSignedIn;
void BLOCK;
void ([] as Seat[]);
void ({} as PilotResult);
