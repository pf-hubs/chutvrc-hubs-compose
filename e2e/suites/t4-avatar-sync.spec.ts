// T4 avatar sync (plan 4): what a client sends for its avatar, how another client's copy follows it, late
// joiners, avatar changes and models, the headset's flags, interpolation, a frozen sender, the old build
// beside the new one, and eight avatars in one room. Each test is written for Dialog and LiveKit and runs in
// the matching media server block (suites/blocks.ts).
//
// Pose numbers come from the frame recorder (probes/poses.ts): the sender's own rig objects and the
// receiver's copy, sampled on every animation frame of each page and stamped with the PC's clock.
// Known failure #1 of BASELINE.md: on Dialog a client announces its avatar once, before the channel is
// open, so the others often draw no model for it. Tests whose subject is the model (T4.5, T4.6, T4.7) do not
// work around it; the others re-announce through the logged workaround where a model helps the evidence.
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { room, type MediaServer } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { enterRoom } from "../clients/enter";
import { reannounceAvatars } from "../clients/workarounds";
import { launchBot, waitBotEntered } from "../clients/bot";
import { slowDrift, speakerGestures, hold, REST, takeApplied, playTimeline, setControllerConnected, exitVr, enterVr, isPresenting, yawPitchRoll } from "../clients/motion";
import {
  SELF,
  RIG,
  HEAD_ANGLES,
  HEAD_WORLD,
  RIGHT_HAND,
  LEFT_HAND,
  align,
  changeOver,
  freezes,
  recordFrames,
  smoothness,
  thin,
  tracesCsv,
  movement,
  readPose,
  tracePose,
  type FrameSample
} from "../probes/poses";
import { messagesOf, recordPackets, startPacketLog, summarisePackets, takePacketLog, type PacketEntry } from "../probes/packets";
import { readConnections } from "../probes/connections";
import { readMemory } from "../probes/memory";
import { avatarCounts, avatarState, mappedLines, ownAvatarId, setAvatar, waitForAvatar } from "../probes/avatars";
import { capabilities, requireCapability } from "../probes/compat";
import { collectErrors } from "../probes/errors";
import { CONSOLE_ALLOW_LIST } from "./console-allowlist";
import { readPeers, readSession, measureFrameRate } from "../probes/session";
import { AVATARS, avatarUrl, missingAvatars, type AvatarName } from "../assets/avatars";
import { blockId, blockTitle, runsOn } from "./blocks";
import {
  closingChecks,
  connectedCheck,
  enterAll,
  exceptionsSince,
  frameRateCheck,
  idOf,
  logMarks,
  mainRoom,
  startClients,
  twoWayAudio,
  pilotText,
  waitUntil
} from "./common";
import type { SlotName } from "../assets/media";

const SERVERS = ["dialog", "livekit"] as const;

/** Labels of the old per-part format and its flag channels: a new client sends none of them */
const OLD_POSE_LABELS = ["#avatar-RIG", "#avatar-HEAD", "#avatar-LEFT", "#avatar-RIGHT", "#isVR", "#avatarAnimState"];
const POSE_LABELS = ["#avatar-pose", ...OLD_POSE_LABELS];

const meta = (id: string, server: MediaServer, covers: string) => ({
  annotation: [
    { type: "id", description: `${id}-${blockId(server)}` },
    { type: "covers", description: covers }
  ]
});

/** A walk the keyboard drives: forward, a snap turn, a look around, back, a look up */
async function walkAround(page: Client["page"]) {
  await input.walk(page, "w", 1500);
  await input.snapTurn(page, "left", 1);
  await input.look(page, -200, 0);
  await input.walk(page, "d", 800);
  await input.look(page, 150, 60);
  await input.walk(page, "s", 1200);
  await input.look(page, 0, -60);
  await page.waitForTimeout(600);
}

const bytesOf = (id: string) => new TextEncoder().encode(id).length;

/** Pose-related labels of a packet summary: sent per second and payload bytes per second */
function poseTraffic(entries: PacketEntry[], seconds: number) {
  const summary = summarisePackets(entries, seconds);
  const rows = Object.fromEntries(
    POSE_LABELS.map(l => [l, { perSecond: summary.byLabel[l]?.sentPerSecond ?? 0, bytesPerSecond: summary.byLabel[l]?.sentBytesPerSecond ?? 0 }])
  );
  const bytesPerSecond = Object.values(rows).reduce((a, r) => a + r.bytesPerSecond, 0);
  // The send rate from the packets' own times (the window's edges add a partial interval)
  const sentPose = entries.filter(e => e.l === "#avatar-pose" && e.s === 1).map(e => e.t);
  const poseRate = sentPose.length > 2 ? +((sentPose.length - 1) / ((sentPose[sentPose.length - 1] - sentPose[0]) / 1000)).toFixed(1) : 0;
  return { rows, bytesPerSecond, poseRate, summary };
}

/** Bytes sent per data channel label between two readings of the connections probe (Dialog opens one channel per label) */
async function channelBytes(c: Client) {
  const reading = await readConnections(c.page);
  const out: Record<string, { messages: number; bytes: number }> = {};
  for (const conn of reading.connections) {
    for (const d of conn.dataChannels) {
      const row = (out[d.label] ??= { messages: 0, bytes: 0 });
      row.messages += d.messagesSent;
      row.bytes += d.bytesSent;
    }
  }
  return out;
}

function channelDelta(before: Record<string, { messages: number; bytes: number }>, after: Record<string, { messages: number; bytes: number }>, seconds: number) {
  const out: Record<string, { perSecond: number; bytesPerSecond: number; bytesPerMessage: number | null }> = {};
  for (const [label, a] of Object.entries(after)) {
    const b = before[label] ?? { messages: 0, bytes: 0 };
    const messages = a.messages - b.messages;
    const bytes = a.bytes - b.bytes;
    if (!messages) continue;
    out[label] = { perSecond: +(messages / seconds).toFixed(1), bytesPerSecond: Math.round(bytes / seconds), bytesPerMessage: +(bytes / messages).toFixed(1) };
  }
  return out;
}

/**
 * Where an avatar announcement went: the #avatarId messages A's packet log sent and B's received from A
 * while `during` ran, and on Dialog the #avatarId data channels' state and counts on both (the connections
 * probe; LiveKit carries every label on two channels)
 */
async function traceAnnouncement(a: Client, b: Client, ida: string, during: () => Promise<unknown>) {
  const channels = async (c: Client) =>
    (await readConnections(c.page)).connections.flatMap(x => x.dataChannels).filter(d => d.label === "#avatarId").map(d => `${d.state} sent ${d.messagesSent} received ${d.messagesReceived}`);
  await Promise.all([startPacketLog(a.page), startPacketLog(b.page)]);
  try {
    await during();
  } catch (e) {
    await Promise.all([takePacketLog(a.page).catch(() => []), takePacketLog(b.page).catch(() => [])]);
    throw e;
  }
  const [la, lb] = await Promise.all([takePacketLog(a.page), takePacketLog(b.page)]);
  return {
    aSent: messagesOf(la, "#avatarId", "sent").map(e => e.m ?? ""),
    bReceivedFromA: messagesOf(lb, "#avatarId", "received").filter(e => (e.m ?? "").startsWith(`${ida}|`)).map(e => e.m ?? ""),
    aChannels: await channels(a),
    bChannels: await channels(b)
  };
}

const announcementText = (t: Awaited<ReturnType<typeof traceAnnouncement>>) =>
  `A sent #avatarId ${t.aSent.length}x, B received it from A ${t.bReceivedFromA.length}x; #avatarId channels at A [${t.aChannels.join("; ")}], at B [${t.bChannels.join("; ")}]`;

// ---------- T4.1 ----------

async function sendCounts(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, old] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "old1", slot: "c", name: "C-old", profile: "OLD" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); C-old runs the previous build (hubs feature/sfu-refactor) from hubs-client-old`);
  await enterAll(evidence, [a, old], hub.hubId);
  await connectedCheck(evidence, [a, old], server, "V8");
  await frameRateCheck(evidence, [a, old]);
  const [ida, idOld] = [await idOf(a), await idOf(old)];
  evidence.note(`client ids: A ${ida} (${bytesOf(ida)} bytes), C-old ${idOld} (${bytesOf(idOld)} bytes)`);

  const WINDOW_MS = 5000;
  const measure = async (c: Client, moving: boolean) => {
    const before = server === "dialog" ? await channelBytes(c) : null;
    const t0 = Date.now();
    const entries = await recordPackets(c.page, async () => {
      if (moving) {
        // Walking and looking around at once, so the rig and the head both change on every frame
        for (const [key, dx, dy] of [["w", 240, 40], ["s", -240, -40]] as const) {
          await c.page.keyboard.down(key);
          await input.look(c.page, dx, dy, 60);
          await c.page.keyboard.up(key);
        }
      } else {
        await c.page.waitForTimeout(WINDOW_MS);
      }
    });
    const seconds = (Date.now() - t0) / 1000;
    const after = server === "dialog" ? await channelBytes(c) : null;
    return { seconds, traffic: poseTraffic(entries, seconds), channels: before && after ? channelDelta(before, after, seconds) : null, ownPose: entries.filter(e => e.l === "#avatar-pose" && e.s === 1).slice(0, 3) };
  };
  const newIdle = await measure(a, false);
  const newMoving = await measure(a, true);
  const oldIdle = await measure(old, false);
  const oldMoving = await measure(old, true);
  evidence.saveJson("traffic.json", { newIdle, newMoving, oldIdle, oldMoving }, "what each client sent, per label: packet log (payload bytes from the codecs' layouts) and, on Dialog, the data channels' own byte counts");

  await evidence.check("#avatar-pose sent 30 to 45 times a second, idle and moving", "V8 K2", async () => {
    const rates = [newIdle.traffic.poseRate, newMoving.traffic.poseRate];
    // 29.5: at 60 frames a second the 22 ms gate sends on every other frame, 30 a second, and one late frame lowers the count
    return {
      ok: rates.every(r => r >= 29.5 && r <= 45),
      summary: `A: idle ${rates[0]}/s, moving ${rates[1]}/s (from the packets' times; counted over the window ${newIdle.traffic.rows["#avatar-pose"].perSecond} and ${newMoving.traffic.rows["#avatar-pose"].perSecond}/s)`
    };
  });
  await evidence.check(`Packet size 50 bytes plus the client id (${50 + bytesOf(ida)} bytes for A's ${bytesOf(ida)}-byte id)`, "V8 K2", async () => {
    const expected = 50 + bytesOf(ida);
    const fromLog = newMoving.ownPose.map(e => e.b);
    const onWire = newMoving.channels?.["#avatar-pose"]?.bytesPerMessage ?? null;
    const ok = fromLog.length > 0 && fromLog.every(b => b === expected) && (onWire === null || onWire === expected);
    return {
      ok,
      summary: `expected ${expected}; from the packet log ${[...new Set(fromLog)].join(", ") || "none"}` + (onWire !== null ? `; the #avatar-pose data channel's own count ${onWire} bytes a message` : "; LiveKit carries every label on two channels, so only the packet log's size is available"),
      data: { expected, fromLog, onWire }
    };
  });
  await evidence.check("Nothing sent on #avatar-RIG, -HEAD, -LEFT, -RIGHT, #isVR or #avatarAnimState", "V8 K2", async () => {
    const sent = OLD_POSE_LABELS.map(l => [l, newIdle.traffic.rows[l].perSecond + newMoving.traffic.rows[l].perSecond] as const).filter(([, n]) => n > 0);
    return { ok: sent.length === 0, summary: sent.length ? `sent: ${sent.map(([l, n]) => `${l} ${n}/s`).join(", ")}` : "none of the six labels sent, idle or moving" };
  });
  await evidence.check("Pose bytes a quarter or less of the old build's", "V8 K2", async () => {
    const ratioMoving = newMoving.traffic.bytesPerSecond / Math.max(1, oldMoving.traffic.bytesPerSecond);
    const ratioIdle = newIdle.traffic.bytesPerSecond / Math.max(1, oldIdle.traffic.bytesPerSecond);
    const describe = (t: ReturnType<typeof poseTraffic>) =>
      Object.entries(t.rows)
        .filter(([, r]) => r.perSecond > 0)
        .map(([l, r]) => `${l} ${r.perSecond}/s ${r.bytesPerSecond} B/s`)
        .join(", ");
    return {
      ok: ratioMoving <= 0.25 && oldMoving.traffic.bytesPerSecond > 0,
      summary:
        `moving: new ${newMoving.traffic.bytesPerSecond} B/s against old ${oldMoving.traffic.bytesPerSecond} B/s (${ratioMoving.toFixed(2)}); ` +
        `idle: new ${newIdle.traffic.bytesPerSecond} against old ${oldIdle.traffic.bytesPerSecond} B/s (${ratioIdle.toFixed(2)}). ` +
        `Old moving: ${describe(oldMoving.traffic)}; new moving: ${describe(newMoving.traffic)}`,
      data: { ratioMoving, ratioIdle }
    };
  });

  // Recorded beside it: a headset on each build moving its head and both hands, the case in which the
  // old build sends all four per-part channels at its full rate
  const [hq, oq] = await startClients(evidence, [
    { identity: "quest1", slot: "d", name: "D-quest", profile: "QUEST" },
    { identity: "oldquest1", slot: "e", name: "E-old-quest", profile: "OLD_QUEST" }
  ]);
  await enterAll(evidence, [hq, oq], hub.hubId, {}, "entry-headsets.json");
  const headset = async (c: Client) => {
    const idle = await recordPackets(c.page, 4000);
    const t0 = Date.now();
    const moving = await recordPackets(c.page, () => playTimeline(c.page, speakerGestures(4000)));
    return { idle: poseTraffic(idle, 4), moving: poseTraffic(moving, (Date.now() - t0) / 1000) };
  };
  const [newHeadset, oldHeadset] = [await headset(hq), await headset(oq)];
  evidence.saveJson("traffic-headsets.json", { newHeadset, oldHeadset }, "a headset on each build, idle and moving its head and hands: what it sent per label");
  await evidence.check("Headsets (recorded beside the plan's pair): pose bytes of the new build against the old", "V8 K2", async () => {
    const describe = (t: ReturnType<typeof poseTraffic>) =>
      Object.entries(t.rows)
        .filter(([, r]) => r.perSecond > 0)
        .map(([l, r]) => `${l} ${r.perSecond}/s`)
        .join(", ");
    const ratio = newHeadset.moving.bytesPerSecond / Math.max(1, oldHeadset.moving.bytesPerSecond);
    return {
      ok: true,
      summary:
        `moving head and hands: new ${newHeadset.moving.bytesPerSecond} B/s against old ${oldHeadset.moving.bytesPerSecond} B/s (${ratio.toFixed(2)}); idle: new ${newHeadset.idle.bytesPerSecond} against old ${oldHeadset.idle.bytesPerSecond} B/s. ` +
        `Old moving: ${describe(oldHeadset.moving)}; new moving: ${describe(newHeadset.moving)}`,
      data: { ratio }
    };
  });
  await closingChecks(evidence, [a, old, hq, oq]);
}

// ---------- T4.2 ----------

async function followsPath(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  await connectedCheck(evidence, [a, b], server, "B3");
  await frameRateCheck(evidence, [a, b]);
  await reannounceAvatars([a, b], evidence, "so the videos show A's model; the subject here is the pose");
  const ida = await idOf(a);
  await input.faceTowards(b.page, { clientId: ida });
  const [sender, receiver] = await recordFrames(
    [
      { page: a.page, ids: [SELF] },
      { page: b.page, ids: [ida] }
    ],
    async () => {
      await a.page.waitForTimeout(500);
      await walkAround(a.page);
      await walkAround(a.page);
      await a.page.waitForTimeout(800);
    }
  );
  const own = sender[SELF] ?? [];
  const copy = receiver[ida] ?? [];
  evidence.saveText("pose-traces.csv", tracesCsv({ "A own": own, "A at B": copy }), "per-frame traces: A's own rig and head, B's copy of A", "data");
  await evidence.screenshot(b, "B-sees-A");

  await evidence.check("B's copy of A follows A's path: position error under 2 cm after alignment; lag reported", "B3", async () => {
    const rig = align(own, copy, RIG);
    const head = align(own, copy, HEAD_WORLD);
    if (!rig) return { ok: false, summary: `too few frames (A ${own.length}, B ${copy.length})` };
    const angles = align(own, copy, HEAD_ANGLES, { maxLagMs: rig.lagMs, stepMs: 1000 });
    return {
      ok: rig.p95 < 0.02 && rig.rms < 0.02,
      summary:
        `lag ${rig.lagMs} ms; rig error after alignment rms ${(rig.rms * 100).toFixed(2)} cm, p95 ${(rig.p95 * 100).toFixed(2)} cm, max ${(rig.max * 100).toFixed(2)} cm over ${rig.senderTravel} m walked (${rig.samples} frames); ` +
        `head ${head ? `p95 ${(head.p95 * 100).toFixed(2)} cm at lag ${head.lagMs} ms` : "n/a"}; head angles at the rig's lag rms ${angles ? ((angles.rms * 180) / Math.PI).toFixed(2) : "?"}° (judged: rms and p95 under 2 cm; the max includes frame-timing misalignment of single frames)`,
      data: { rig, head, angles }
    };
  });
  await evidence.check("No freeze over 300 ms in B's copy while A moves", "B3", async () => {
    const rig = align(own, copy, RIG);
    if (copy.length < 10) return { ok: false, summary: `B holds no copy of A to judge (${copy.length} frames)` };
    const f = freezes(own, copy, rig?.lagMs ?? 100);
    return { ok: f.longestMs <= 300, summary: `longest freeze ${f.longestMs} ms (${f.stretches.length} over 300 ms); longest stretch without change at all ${f.longestStillMs} ms`, data: f };
  });
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.3 ----------

async function startQuestPair(evidence: Evidence, server: MediaServer, extra: { questAvatar?: string } = {}) {
  const hub = room(mainRoom(server));
  const [q, b] = await startClients(evidence, [
    { identity: "quest1", slot: "a", name: "A-quest", profile: "QUEST" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A-quest is Edge with IWER emulating a Quest 3 and the Quest Browser's user agent`);
  await enterAll(evidence, [q, b], hub.hubId, extra.questAvatar ? {} : {});
  return { q, b, hub };
}

async function slowMotion(evidence: Evidence, server: MediaServer) {
  const { q, b } = await startQuestPair(evidence, server);
  await connectedCheck(evidence, [q, b], server, "B1b");
  await frameRateCheck(evidence, [q, b]);
  const idq = await idOf(q);
  await reannounceAvatars([q, b], evidence, "so the video shows the headset's avatar; the subject here is the pose");
  await input.faceTowards(b.page, { clientId: idq });
  const DURATION = 20_000;
  const [sender, receiver] = await recordFrames(
    [
      { page: q.page, ids: [SELF] },
      { page: b.page, ids: [idq] }
    ],
    () => playTimeline(q.page, slowDrift(DURATION, 1, 2))
  );
  const own = sender[SELF] ?? [];
  const copy = receiver[idq] ?? [];
  const applied = await takeApplied(q.page);
  evidence.saveText("pose-traces.csv", tracesCsv({ "A own": own, "A at B": copy }), "per-frame traces: the headset's own pose and B's copy", "data");
  evidence.saveJson("devices.json", applied.filter((_, i) => i % 6 === 0), "what the emulated headset and controllers were set to (every sixth frame)");
  await evidence.screenshot(b, "B-sees-A");

  await evidence.check("B's copy keeps changing throughout: right hand at 1 cm/s and head at 2°/s for 20 s", "K2 B1b", async () => {
    const window = (t: FrameSample[]) => t.filter(s => s.t >= (copy[0]?.t ?? 0) + 500);
    const hand = changeOver(window(copy), RIGHT_HAND);
    const head = changeOver(window(copy), HEAD_ANGLES);
    const ownHand = changeOver(window(own), RIGHT_HAND);
    const first = copy[0];
    const last = copy[copy.length - 1];
    const headTurn = first && last ? (((last.headYaw - first.headYaw) * 180) / Math.PI).toFixed(1) : "?";
    const ok = copy.length > 100 && hand.longestStillMs <= 300 && head.longestStillMs <= 300 && hand.net >= 0.15;
    return {
      ok,
      summary:
        `B's copy: right hand moved ${(hand.net * 100).toFixed(1)} cm (the headset's own ${(ownHand.net * 100).toFixed(1)} cm), longest stretch without change ${hand.longestStillMs} ms; ` +
        `head turned ${headTurn}°, longest stretch without change ${head.longestStillMs} ms (judged: 300 ms or less; ${copy.length} frames)`,
      data: { hand, head, ownHand, frames: copy.length }
    };
  });
  await closingChecks(evidence, [q, b]);
}

// ---------- T4.4 ----------

async function leaveAndReenter(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  await connectedCheck(evidence, [a, b], server, "V2");
  const rounds: unknown[] = [];
  for (let round = 1; round <= 3; round++) {
    const oldId = await idOf(a);
    await input.leaveRoom(a.page);
    await a.page.waitForURL(url => !url.pathname.includes(hub.hubId), { timeout: 30_000 }).catch(() => {});
    const gone = await waitUntil(async () => !(await readPeers(b.page)).poses.includes(oldId), 15_000);
    await enterRoom(a, hub.hubId, { displayName: a.name });
    const ida = await idOf(a);
    await a.page.waitForTimeout(1500);
    let sent: ReturnType<typeof summarisePackets> | null = null;
    const trace = await tracePose(b.page, ida, async () => {
      const entries = await recordPackets(a.page, () => input.walk(a.page, round % 2 ? "w" : "s", 2000));
      sent = summarisePackets(entries);
    });
    const moved = movement(trace);
    const peers = await readPeers(b.page);
    const bRate = await (async () => {
      const entries = await recordPackets(b.page, 2000);
      return summarisePackets(entries, 2).byLabel["#avatar-pose"]?.receivedBySender?.[ida] ?? 0;
    })();
    await evidence.screenshot(b, `round-${round}`);
    rounds.push({
      round,
      oldIdGoneFromBMs: gone.timedOut ? null : gone.ms,
      newId: ida,
      bSawMove: moved.travelled,
      aSentPerSecond: (sent as any)?.byLabel?.["#avatar-pose"]?.sentPerSecond ?? 0,
      bReceivedFromAPerSecond: +(bRate / 2).toFixed(1),
      bHoldsPoses: peers.poses.length,
      bHoldsOldId: peers.poses.includes(oldId)
    });
  }
  evidence.saveJson("rounds.json", rounds, "each leave and re-entry: how B saw A");
  const rows = rounds as any[];
  await evidence.check("B sees A move after each of three re-entries", "V2 B1a", async () => ({
    ok: rows.every(r => r.bSawMove >= 1),
    summary: rows.map(r => `round ${r.round}: B saw A walk ${r.bSawMove} m`).join("; "),
    data: rows
  }));
  await evidence.check("A's send rate does not double; B holds one pose for A", "V2 B1a", async () => ({
    ok: rows.every(r => r.aSentPerSecond >= 25 && r.aSentPerSecond <= 45 && r.bReceivedFromAPerSecond <= 45 && r.bHoldsPoses === 1 && !r.bHoldsOldId),
    summary: rows
      .map(r => `round ${r.round}: A sends ${r.aSentPerSecond}/s, B receives ${r.bReceivedFromAPerSecond}/s from A, B holds ${r.bHoldsPoses} other pose(s)${r.bHoldsOldId ? " including A's previous id" : ""}; previous id gone from B after ${r.oldIdGoneFromBMs ?? "more than 15000"} ms`)
      .join("; "),
    data: rows
  }));
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.5 ----------

async function lateJoin(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const avatar = avatarUrl("rpm");
  const [a, b, c] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" },
    { identity: "member2", account: "member2", slot: "c" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); A enters with a custom avatar (${AVATARS.rpm.describe}, ${avatar}); no workaround for the avatar announcement`);
  await enterAll(evidence, [a, b], hub.hubId, { avatarUrl: avatar });
  const ida = await idOf(a);
  await a.page.waitForTimeout(5000);
  const bView = await avatarState(b.page, ida).catch(e => ({ error: String(e) }));
  const t0 = Date.now();
  await enterRoom(c, hub.hubId, { displayName: c.name });
  const enteredAt = Date.now();
  // From C's entry: when it first holds A's pose and A's model
  let poseAt: number | null = null;
  let modelAt: number | null = null;
  let last = await avatarState(c.page, ida);
  while (Date.now() - enteredAt < 15_000 && (poseAt === null || modelAt === null)) {
    const peers = await readPeers(c.page);
    if (poseAt === null && peers.poses.includes(ida)) poseAt = Date.now() - enteredAt;
    last = await avatarState(c.page, ida);
    if (modelAt === null && last.eid !== null && last.avatarId === avatar) modelAt = Date.now() - enteredAt;
    await c.page.waitForTimeout(200);
  }
  await input.faceTowards(c.page, { clientId: ida });
  await evidence.screenshot(c, "C-sees-A");
  await evidence.screenshot(b, "B-sees-A");
  evidence.saveJson("late-join.json", { cEntryMs: enteredAt - t0, poseAt, modelAt, cView: last, bView }, "when the late joiner had A's pose and model");
  await evidence.check("C, joining late, has A's model and pose within 3 s", "A5", async () => ({
    ok: poseAt !== null && poseAt <= 3000 && modelAt !== null && modelAt <= 3000,
    summary:
      `after C entered: A's pose ${poseAt === null ? "not within 15 s" : `after ${poseAt} ms`}, A's model ${modelAt === null ? `not within 15 s (C has avatar id ${last.avatarId ?? "none"}, entity ${last.eid ?? "none"})` : `after ${modelAt} ms`}; ` +
      `B (entered with A) ${"error" in bView ? bView.error : bView.eid !== null ? `draws A (${bView.avatarId === avatar ? "the custom avatar" : bView.avatarId})` : "draws no model for A"}`,
    data: { poseAt, modelAt, last, bView }
  }));
  await closingChecks(evidence, [a, b, c]);
}

// ---------- T4.6 ----------

async function changeAvatar(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  const ida = await idOf(a);
  const original = await ownAvatarId(a);
  // The first avatar must differ from the one A entered with, or setting it announces nothing
  const candidates = (["rpm", "vrm0", "vrm1"] as const).map(n => avatarUrl(n));
  const order = [...candidates.filter(u => u !== original), ...candidates.filter(u => u === original)];
  const first = order[0];
  evidence.note(`A's profile avatar at entry: ${original}; A first changes to ${first} (B loads it on that announcement), which is the baseline; then three changes: ${order.slice(1).join(", ")} and back to the first. No workaround`);
  let baseLoad!: Awaited<ReturnType<typeof waitForAvatar>>;
  const baseTrace = await traceAnnouncement(a, b, ida, async () => {
    await setAvatar(a, first);
    baseLoad = await waitForAvatar(b.page, ida, first);
  });
  await b.page.waitForTimeout(2000);
  const baseline = { memory: await readMemory(b), counts: await avatarCounts(b.page) };
  await input.faceTowards(b.page, { clientId: ida });
  await evidence.screenshot(b, "baseline");
  const steps: unknown[] = [];
  for (const [name, url] of [[order[1].split("/").pop()!, order[1]], [order[2].split("/").pop()!, order[2]], [`${first.split("/").pop()} (back)`, first]] as const) {
    let load!: Awaited<ReturnType<typeof waitForAvatar>>;
    const trace = await traceAnnouncement(a, b, ida, async () => {
      await setAvatar(a, url);
      load = await waitForAvatar(b.page, ida, url);
    });
    await b.page.waitForTimeout(2000);
    const counts = await avatarCounts(b.page);
    const memory = await readMemory(b);
    steps.push({ name, loadedMs: load.ms, loaded: load.loaded, avatarId: load.state.avatarId, entity: load.state.eid, counts, geometries: memory.geometries, textures: memory.textures, announcement: announcementText(trace) });
    await evidence.screenshot(b, `after-${name.split(" ")[0]}`);
  }
  const final = { memory: await readMemory(b), counts: await avatarCounts(b.page) };
  // A second round of the same three changes tells a one-time allocation from a leak per change
  const second: { name: string; geometries: number; textures: number; loaded: boolean }[] = [];
  for (const url of [order[1], order[2], first]) {
    await setAvatar(a, url);
    const load = await waitForAvatar(b.page, ida, url);
    await b.page.waitForTimeout(2000);
    const memory = await readMemory(b);
    second.push({ name: url.split("/").pop()!, geometries: memory.geometries, textures: memory.textures, loaded: load.loaded });
  }
  evidence.saveJson("avatar-changes.json", { original, baseLoad, baseTrace, baseline, steps, final, second }, "B's models and renderer memory through A's avatar changes, and a second round of the same changes");
  await evidence.check("B holds one model for A at every step", "V4 B4", async () => {
    const rows = steps as any[];
    const ok = baseLoad.loaded && rows.every(r => r.loaded && r.counts.models[ida] !== undefined && r.counts.solvers === 2 && r.counts.skinnedModels === 2);
    return {
      ok,
      summary:
        `baseline: B ${baseLoad.loaded ? `loaded A's first avatar in ${baseLoad.ms} ms` : `did not load A's first avatar (${announcementText(baseTrace)})`}, ${baseline.counts.solvers} avatar solvers, ${baseline.counts.skinnedModels} skinned models; ` +
        rows.map(r => `${r.name}: ${r.loaded ? `loaded in ${r.loadedMs} ms` : `not loaded (${r.announcement})`}, ${r.counts.solvers} solvers, ${r.counts.skinnedModels} skinned models`).join("; ") +
        " (expected 2 each: B's own and A's)",
      data: { baseLoad, rows }
    };
  });
  await evidence.check("Geometry and texture counts return to the baseline after the three changes", "V4 B4", async () => {
    const d = { geometries: final.memory.geometries - baseline.memory.geometries, textures: final.memory.textures - baseline.memory.textures };
    return {
      ok: !baseLoad.loaded || (steps as any[]).some(r => !r.loaded) ? ("not applicable" as const) : d.geometries === 0 && d.textures === 0,
      summary:
        `geometries ${baseline.memory.geometries} -> ${final.memory.geometries} (${d.geometries >= 0 ? "+" : ""}${d.geometries}), textures ${baseline.memory.textures} -> ${final.memory.textures} (${d.textures >= 0 ? "+" : ""}${d.textures}); heap ${baseline.memory.heapUsedMb} -> ${final.memory.heapUsedMb} MB; ` +
        `per step ${(steps as any[]).map(r => `${r.name} ${r.geometries}/${r.textures}`).join(", ")}; a second round of the same changes: ${second.map(r => `${r.name} ${r.geometries}/${r.textures}`).join(", ")} (geometries/textures)`,
      data: { baseline: baseline.memory, final: final.memory, steps, second }
    };
  });
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.7 ----------

async function eachAvatar(evidence: Evidence, server: MediaServer) {
  const missing = missingAvatars();
  if (missing.length) throw new Error(`avatar files missing (${missing.join(", ")}): npx tsx assets/avatars.ts`);
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  const ida = await idOf(a);
  await input.faceTowards(b.page, { clientId: ida });
  const results: Record<string, any> = {};
  for (const name of Object.keys(AVATARS) as AvatarName[]) {
    const url = avatarUrl(name);
    const marks = logMarks([a, b]);
    const aMark = a.log.length ? a.log[a.log.length - 1].t + 1 : 0;
    const bMark = b.log.length ? b.log[b.log.length - 1].t + 1 : 0;
    let load!: Awaited<ReturnType<typeof waitForAvatar>>;
    const trace = await traceAnnouncement(a, b, ida, async () => {
      await setAvatar(a, url);
      load = await waitForAvatar(b.page, ida, url);
    });
    await b.page.waitForTimeout(2500);
    await input.walk(a.page, "w", 300);
    await b.page.waitForTimeout(800);
    const state = await avatarState(b.page, ida);
    const ownState = await avatarState(a.page, ida);
    await input.faceTowards(b.page, { clientId: ida });
    await evidence.screenshot(b, `B-sees-${name}`);
    results[name] = {
      url,
      expect: AVATARS[name].expect,
      loadMs: load.ms,
      loaded: load.loaded,
      atB: state,
      atA: { avatarId: ownState.avatarId, rigSource: ownState.rigSource, missingBones: ownState.missingBones },
      linesAtB: mappedLines(b, ida, bMark),
      linesAtA: mappedLines(a, ida, aMark),
      announcement: announcementText(trace),
      exceptions: exceptionsSince([a, b], marks)
    };
  }
  evidence.saveJson("avatars.json", results, "each avatar: how B mapped it, the bones it found, the neck and the name tag");
  const known = (["rpm", "vrm0", "vrm1"] as const).map(n => [n, results[n]] as const);

  await evidence.check("Bones resolved for each humanoid avatar (VRM through the humanoid extension)", "V1 B4", async () => {
    const rows = known.map(([n, r]) => ({
      n,
      ok: r.loaded && r.atB.eid !== null && r.atB.rigSource === r.expect && ["hips", "spine", "head", "leftUpperArm", "leftLowerArm", "leftHand", "rightHand", "leftUpperLeg", "leftFoot"].every(bone => r.atB.bones.includes(bone)),
      text: `${n}: ${r.loaded ? `loaded in ${r.loadMs} ms, mapped from ${r.atB.rigSource ?? "nothing"} (expected ${r.expect}), ${r.atB.bones.length} bones, without ${r.atB.missingBones.join(" ") || "none"}` : `not loaded at B (${r.announcement}); A mapped it from ${r.atA.rigSource ?? "nothing"}`}`
    }));
    return { ok: rows.every(r => r.ok), summary: rows.map(r => r.text).join("; "), data: Object.fromEntries(known.map(([n, r]) => [n, { bones: r.atB.bones, missing: r.atB.missingBones, lines: r.linesAtB }])) };
  });
  await evidence.check("Name tag above the neck for each humanoid avatar", "V1", async () => {
    const rows = known.map(([n, r]) => {
      const tag = r.atB.nameTag;
      const neck = r.atB.neck;
      const horizontal = tag && neck ? Math.hypot(tag[0] - neck[0], tag[2] - neck[2]) : null;
      const above = tag && neck ? tag[1] - neck[1] : null;
      return { n, horizontal, above, visible: r.atB.nameTagVisible, ok: horizontal !== null && above !== null && horizontal <= 0.25 && above > 0 && above <= 1.2 };
    });
    return {
      ok: rows.every(r => r.ok),
      summary: rows.map(r => `${r.n}: ${r.horizontal === null ? "no name tag or neck found" : `tag ${r.above!.toFixed(2)} m above the neck, ${r.horizontal.toFixed(2)} m to the side${r.visible ? "" : " (hidden)"}`}`).join("; ") + " (judged: above it, within 1.2 m, and within 0.25 m to the side)",
      data: rows
    };
  });
  await evidence.check("The model with unfamiliar bone names falls back to the default avatar", "B1f", async () => {
    const r = results.unfamiliar;
    return {
      ok: r.atB.avatarId === "default-avatar" && r.atB.eid !== null,
      summary: `B: avatar id ${r.atB.avatarId ?? "none"}, entity ${r.atB.eid ?? "none"}, ${r.atB.rigSource ? `mapped from ${r.atB.rigSource} with ${r.atB.bones.length} bones (${r.atB.bones.join(" ")})` : "no rig"}; console: ${r.linesAtB.join(" | ") || "no mapping line"}`,
      data: r
    };
  });
  await evidence.check("No exception while loading the avatars", "V1 B4", async () => {
    const all = Object.entries(results).flatMap(([n, r]) => r.exceptions.map((e: string) => `${n}: ${e}`));
    return { ok: all.length === 0, summary: all.length ? all.slice(0, 5).join("; ") : "none" };
  });
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.8 ----------

/**
 * Page code: wraps the own pose sampler and the pose sender of the room session to note, per frame, how
 * often the pose was sampled and sent, with which tracked bits, whether the controllers were visible, and
 * whether an XR frame was being run. Diagnosis for the earlier observation that the sent packets carried
 * tracked 1 while the own pose read between frames had 7.
 */
const SAMPLER_WATCH = () => {
  const APP = (window as any).APP;
  const sync = APP.sfu.avatarSync;
  const source = sync.localPoseSource;
  const sender = sync.poseSender;
  const w = window as any;
  if (!source || w.__e2eSamplerWatch) return !!source;
  const log: any[] = [];
  w.__e2eSamplerWatch = log;
  const renderer = (window as any).AFRAME.scenes[0].renderer;
  const left = (document.querySelector("#player-left-controller") as any).object3D;
  const right = (document.querySelector("#player-right-controller") as any).object3D;
  const sample = source.sample.bind(source);
  source.sample = (now: number) => {
    sample(now);
    const pose = APP.avatarPoses.get(APP.sfu.clientId);
    log.push({ k: "sample", at: performance.now(), now, tracked: pose?.tracked, isVR: pose?.isVR, lv: left.visible, rv: right.visible, xrFrame: !!renderer.xr.getFrame?.() });
  };
  const send = sender.send.bind(sender);
  sender.send = () => {
    const pose = APP.avatarPoses.get(APP.sfu.clientId);
    log.push({ k: "send", at: performance.now(), tracked: pose?.tracked, isVR: pose?.isVR, lv: left.visible, rv: right.visible, xrFrame: !!renderer.xr.getFrame?.() });
    send();
  };
  return true;
};

async function headsetFlags(evidence: Evidence, server: MediaServer) {
  const { q, b } = await startQuestPair(evidence, server);
  await connectedCheck(evidence, [q, b], server, "B8");
  await frameRateCheck(evidence, [q, b]);
  const idq = await idOf(q);
  await reannounceAvatars([q, b], evidence, "so the video shows the headset's avatar; the subject here is the flags");
  await input.faceTowards(b.page, { clientId: idq });
  const watched = await q.page.evaluate(SAMPLER_WATCH);
  if (!watched) evidence.note("the own pose sampler was not found; the per-frame diagnosis is missing");

  type Phase = { name: string; own: FrameSample[]; copy: FrameSample[]; sent: PacketEntry[]; received: PacketEntry[]; watch: any[]; presenting: boolean };
  const phases: Phase[] = [];
  const phase = async (name: string, during: () => Promise<unknown>) => {
    await q.page.evaluate(() => ((window as any).__e2eSamplerWatch || []).splice(0));
    await startPacketLog(q.page);
    await startPacketLog(b.page);
    const [sender, receiver] = await recordFrames(
      [
        { page: q.page, ids: [SELF] },
        { page: b.page, ids: [idq] }
      ],
      during
    );
    const sent = (await takePacketLog(q.page)).filter(e => e.l === "#avatar-pose" && e.s === 1);
    const received = (await takePacketLog(b.page)).filter(e => e.l === "#avatar-pose" && e.s === 0 && e.c === idq);
    const watch = await q.page.evaluate(() => ((window as any).__e2eSamplerWatch || []).splice(0));
    phases.push({ name, own: sender[SELF] ?? [], copy: receiver[idq] ?? [], sent, received, watch, presenting: await isPresenting(q.page) });
    await evidence.screenshot(b, name.replace(/[^a-z0-9]+/gi, "-"));
  };
  // The left controller raised high and forward, so whether its hand rests after a disconnect shows
  const raised = { ...REST, left: { pos: [-0.3, 1.75, -0.45] as [number, number, number], quat: yawPitchRoll(0, 40), connected: true } };
  await playTimeline(q.page, hold("raise the left controller", 1000, raised));
  await phase("in VR, both controllers", () => q.page.waitForTimeout(3000));
  await setControllerConnected(q.page, "left", false);
  await phase("in VR, left controller disconnected", async () => {
    await q.page.waitForTimeout(1000);
    // Moving a disconnected controller must not move anything
    await playTimeline(q.page, hold("disconnected controller moved", 2500, { ...raised, left: { pos: [-0.6, 0.9, 0.2], quat: [0, 0, 0, 1], connected: false } }));
  });
  // Both solvers: the setting belongs to the viewer (plan T5), so B switches it and reads its copy again
  const leftHandAtB = { old: await avatarHandHeight(b, idq, false), new: await avatarHandHeight(b, idq, true) };
  await b.page.evaluate(() => (window as any).APP.store.update({ preferences: { avatarIkV2: false } }));
  await setControllerConnected(q.page, "left", true);
  await phase("in VR, left controller back", () => q.page.waitForTimeout(3000));
  let exited = true;
  await exitVr(q.page).catch(e => {
    exited = false;
    evidence.note(`leaving VR failed: ${(e as Error).message.split("\n")[0]}`);
  });
  await phase("out of VR", () => q.page.waitForTimeout(3000));
  let reentered = true;
  await enterVr(q.page).catch(e => {
    reentered = false;
    evidence.note(`entering VR again failed: ${(e as Error).message.split("\n")[0]}`);
  });
  await phase("in VR again", () => q.page.waitForTimeout(3000));

  const summary = phases.map(p => {
    const tail = (t: FrameSample[]) => t.slice(Math.floor(t.length / 3));
    const set = (v: (number | boolean | null | undefined)[]) => [...new Set(v.map(x => String(x)))].join("/");
    const sampleRows = p.watch.filter(w => w.k === "sample");
    const sendRows = p.watch.filter(w => w.k === "send");
    // Each send against the sample taken on the same frame just before it
    const sendsUnlikeSample = sendRows.filter(w => {
      const before = sampleRows.filter(x => x.at <= w.at);
      return before.length > 0 && before[before.length - 1].tracked !== w.tracked;
    }).length;
    const framesPerSample = sampleRows.length;
    return {
      name: p.name,
      presenting: p.presenting,
      ownTracked: set(tail(p.own).map(s => s.tracked)),
      ownIsVR: set(tail(p.own).map(s => s.isVR)),
      sentTracked: set(p.sent.slice(Math.floor(p.sent.length / 3)).map(e => e.tr)),
      sentIsVR: set(p.sent.slice(Math.floor(p.sent.length / 3)).map(e => e.vr)),
      copyTracked: set(tail(p.copy).map(s => s.tracked)),
      copyIsVR: set(tail(p.copy).map(s => s.isVR)),
      sent: p.sent.length,
      samples: framesPerSample,
      samplesInXrFrame: sampleRows.filter(w => w.xrFrame).length,
      sampleTracked: set(sampleRows.map(w => w.tracked)),
      sendsInXrFrame: sendRows.filter(w => w.xrFrame).length,
      sends: sendRows.length,
      sendTracked: set(sendRows.map(w => w.tracked)),
      sendsUnlikeSample,
      leftHandMovedAtB: changeOver(p.copy, LEFT_HAND).net
    };
  });
  evidence.saveJson("phases.json", { summary, watch: phases.map(p => ({ name: p.name, watch: p.watch.slice(0, 120) })) }, "per phase: the flags of the own pose, the sent packets and B's copy; the sampler and sender per call");
  evidence.saveText("pose-traces.csv", tracesCsv(Object.fromEntries(phases.flatMap(p => [[`own: ${p.name}`, thin(p.own)], [`at B: ${p.name}`, thin(p.copy)]]))), "per-frame traces per phase (every third frame)", "data");

  const expected: Record<string, { tracked: string; isVR: string }> = {
    "in VR, both controllers": { tracked: "7", isVR: "true" },
    "in VR, left controller disconnected": { tracked: "5", isVR: "true" },
    "in VR, left controller back": { tracked: "7", isVR: "true" },
    "out of VR": { tracked: "*", isVR: "false" },
    "in VR again": { tracked: "7", isVR: "true" }
  };
  await evidence.check("B's copy of the headset has the matching isVR and tracked bits in every phase", "B8", async () => {
    const rows = summary.map(s => {
      const e = expected[s.name];
      const ok = s.copyIsVR === e.isVR && (e.tracked === "*" || s.copyTracked === e.tracked) && s.copyTracked === s.ownTracked && s.copyIsVR === s.ownIsVR;
      return { ...s, ok, e };
    });
    return {
      ok: rows.every(r => r.ok) && exited && reentered,
      summary: rows
        .map(r => `${r.name}: own tracked ${r.ownTracked} isVR ${r.ownIsVR}; sent tracked ${r.sentTracked} isVR ${r.sentIsVR}; B's copy tracked ${r.copyTracked} isVR ${r.copyIsVR}${r.ok ? "" : ` (expected tracked ${r.e.tracked}, isVR ${r.e.isVR})`}`)
        .join("; "),
      data: rows
    };
  });
  await evidence.check("The own pose is sampled once per frame and the packets carry the sampled bits (diagnosis of the earlier tracked 1 observation)", "B8", async () => {
    const rows = summary.map(s => `${s.name}: ${s.samples} samples (${s.samplesInXrFrame} inside an XR frame) with tracked ${s.sampleTracked}; ${s.sends} sends (${s.sendsInXrFrame} inside an XR frame) with tracked ${s.sendTracked}, ${s.sendsUnlikeSample} unlike their frame's sample`);
    // Per frame: one sample (inside the XR frame while presenting), and every send carries the bits of its frame's sample
    const mismatch = summary.some(s => s.sendsUnlikeSample > 0 || (s.name !== "out of VR" && s.samples > s.samplesInXrFrame * 1.1));
    return { ok: !mismatch, summary: rows.join("; "), data: summary };
  });
  await evidence.check("The untracked hand rests: B's copy of the disconnected hand does not follow the controller and the avatar's hand hangs", "B8", async () => {
    const disconnected = summary.find(s => s.name === "in VR, left controller disconnected");
    // Resting: the hand bone no higher than a little above the hips (the controller was raised to 1.75 m)
    const rests = (h: { handAboveHips: number } | null) => h !== null && h.handAboveHips < 0.25;
    const text = (h: { handAboveHips: number } | null) => (h === null ? "no model drawn, not readable" : `${h.handAboveHips.toFixed(2)} m above the hips`);
    return {
      ok: !!disconnected && disconnected.leftHandMovedAtB < 0.01 && rests(leftHandAtB.old) && rests(leftHandAtB.new),
      summary:
        `while disconnected B's copy of the left hand moved ${disconnected ? (disconnected.leftHandMovedAtB * 100).toFixed(1) : "?"} cm (the disconnected controller was moved 1 m); ` +
        `the avatar's left hand bone at B: old solver ${text(leftHandAtB.old)}, new solver ${text(leftHandAtB.new)} (judged resting below 0.25 m; the controller was last at 1.75 m, above the head)`,
      data: { disconnected, leftHandAtB }
    };
  });
  await closingChecks(evidence, [q, b]);
}

/** Where the viewer's model of a client has its left hand, against the model's hips (world heights), with the old or the new solver */
async function avatarHandHeight(viewer: Client, clientId: string, newSolver: boolean) {
  await viewer.page.evaluate(v => (window as any).APP.store.update({ preferences: { avatarIkV2: v } }), newSolver);
  await viewer.page.waitForTimeout(1000);
  const state = await avatarState(viewer.page, clientId).catch(() => null);
  if (!state || state.eid === null || !state.leftHand || !state.hips) return null;
  return { handAboveHips: +(state.leftHand[1] - state.hips[1]).toFixed(3), leftHand: state.leftHand, hips: state.hips };
}

// ---------- T4.9 ----------

async function interpolationDelay(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  await connectedCheck(evidence, [a, b], server, "V7");
  await frameRateCheck(evidence, [a, b]);
  await requireCapability(b.page, "poseStore", "interpolation delay");
  const ida = await idOf(a);
  const runs: Record<string, { own: FrameSample[]; copy: FrameSample[] }> = {};
  for (const delay of [0, 100, 0, 100]) {
    await b.page.evaluate(d => ((window as any).APP.avatarPoses.interpolationDelayMs = d), delay);
    const [sender, receiver] = await recordFrames(
      [
        { page: a.page, ids: [SELF] },
        { page: b.page, ids: [ida] }
      ],
      () => walkAround(a.page)
    );
    const key = `${delay} ms (${Object.keys(runs).filter(k => k.startsWith(`${delay} `)).length + 1})`;
    runs[key] = { own: sender[SELF] ?? [], copy: receiver[ida] ?? [] };
  }
  await b.page.evaluate(() => ((window as any).APP.avatarPoses.interpolationDelayMs = 100));
  evidence.saveText("pose-traces.csv", tracesCsv(Object.fromEntries(Object.entries(runs).flatMap(([k, r]) => [[`own ${k}`, r.own], [`at B ${k}`, r.copy]]))), "per-frame traces of each run", "data");
  const rows = Object.entries(runs).map(([k, r]) => ({ run: k, delay: Number(k.split(" ")[0]), rig: smoothness(r.copy, RIG), head: smoothness(r.copy, HEAD_WORLD), own: smoothness(r.own, RIG), lag: align(r.own, r.copy, RIG)?.lagMs ?? null }));
  await evidence.check("Lower jerk at 100 ms than at 0 ms (B's copy of A, the same walk twice each)", "V7 B6", async () => {
    const mean = (d: number, f: (r: (typeof rows)[number]) => number) => {
      const v = rows.filter(r => r.delay === d).map(f);
      return v.reduce((a, x) => a + x, 0) / v.length;
    };
    const j0 = mean(0, r => r.rig.jerkRms);
    const j100 = mean(100, r => r.rig.jerkRms);
    const s0 = mean(0, r => r.rig.stepP99);
    const s100 = mean(100, r => r.rig.stepP99);
    return {
      ok: j100 < j0,
      summary:
        `rig jerk rms ${j0.toFixed(0)} at 0 ms against ${j100.toFixed(0)} m/s³ at 100 ms; p99 step ${(s0 * 100).toFixed(2)} against ${(s100 * 100).toFixed(2)} cm; ` +
        rows.map(r => `${r.run}: jerk ${r.rig.jerkRms}, head jerk ${r.head.jerkRms}, lag ${r.lag} ms (A's own ${r.own.jerkRms})`).join("; "),
      data: rows
    };
  });
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.10 ----------

async function frozenSender(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  await enterAll(evidence, [a, b], hub.hubId);
  await connectedCheck(evidence, [a, b], server, "B8");
  await frameRateCheck(evidence, [a, b]);
  await requireCapability(b.page, "packetLog", "the packet arrival times");
  const ida = await idOf(a);
  await reannounceAvatars([a, b], evidence, "so the video shows A's model; the subject here is the pose");
  await input.faceTowards(b.page, { clientId: ida });
  const cdp = await a.context.newCDPSession(a.page);
  await cdp.send("Debugger.enable");
  let pausedAt = 0;
  let resumedAt = 0;
  await startPacketLog(b.page);
  const [receiver] = await recordFrames([{ page: b.page, ids: [ida] }], async () => {
    await a.page.keyboard.down("w");
    await b.page.waitForTimeout(1500);
    pausedAt = Date.now();
    await cdp.send("Debugger.pause");
    // Nothing touches A while it is paused: B's recorder runs in B's page
    await b.page.waitForTimeout(3000);
    await cdp.send("Debugger.resume");
    resumedAt = Date.now();
    await b.page.waitForTimeout(1500);
    await a.page.keyboard.up("w");
    await b.page.waitForTimeout(500);
  });
  await cdp.send("Debugger.disable").catch(() => {});
  const packets = (await takePacketLog(b.page)).filter(e => e.l === "#avatar-pose" && e.s === 0 && e.c === ida);
  const copy = receiver[ida] ?? [];
  evidence.saveText("pose-traces.csv", tracesCsv({ "A at B": copy }), "B's per-frame copy of A around the freeze", "data");
  evidence.saveJson("packets.json", packets, "A's packets as B received them (arrival time, sequence number, rig position)");

  // The gap: the longest pause between two packets B received
  let gapIndex = -1;
  for (let i = 1; i < packets.length; i++) if (gapIndex < 0 || packets[i].t - packets[i - 1].t > packets[gapIndex].t - packets[gapIndex - 1].t) gapIndex = i;
  const lastBefore = gapIndex > 0 ? packets[gapIndex - 1] : null;
  const firstAfter = gapIndex > 0 ? packets[gapIndex] : null;
  const pLast = lastBefore?.p ?? null;
  // A's speed just before the gap, from the packets' positions and arrival times
  const before = packets.filter(p => lastBefore && p.t >= lastBefore.t - 400 && p.t <= lastBefore.t && p.p);
  const speed = before.length > 2 ? Math.hypot(before[before.length - 1].p![0] - before[0].p![0], before[before.length - 1].p![2] - before[0].p![2]) / ((before[before.length - 1].t - before[0].t) / 1000) : null;
  const dist = (s: FrameSample) => (pLast ? Math.hypot(s.rig[0] - pLast[0], s.rig[2] - pLast[2]) : NaN);
  // Ahead of the newest sample: the frames after the delay has caught up with it
  const delay = 100;
  // Until the first packet after the gap arrives: from then on B blends toward A's new position, as it should
  const during = lastBefore && firstAfter ? copy.filter(s => s.t > lastBefore.t + delay && s.t < firstAfter.t) : [];
  const beyond = during.map(dist);
  const overshoot = beyond.length ? Math.max(...beyond) : NaN;
  const holdFrames = lastBefore && firstAfter ? copy.filter(s => s.t > lastBefore.t + delay + 250 && s.t < firstAfter.t) : [];
  const holdSpread = holdFrames.length ? Math.max(...holdFrames.map(dist)) : NaN;
  const after = firstAfter ? copy.filter(s => s.t > firstAfter.t + delay) : [];
  const resumed = after.length > 30 ? changeOver(after.slice(0, 60), RIG) : null;
  const resumeMs = (() => {
    if (!firstAfter || !holdFrames.length) return null;
    const held = holdFrames[holdFrames.length - 1];
    const moved = copy.find(s => s.t > firstAfter.t && Math.hypot(s.rig[0] - held.rig[0], s.rig[2] - held.rig[2]) > 0.01);
    return moved ? Math.round(moved.t - firstAfter.t) : null;
  })();
  const facts = {
    pausedAt,
    resumedAt,
    gapMs: lastBefore && firstAfter ? Math.round(firstAfter.t - lastBefore.t) : null,
    speedBefore: speed,
    overshootMetres: overshoot,
    overshootMs: speed ? Math.round((overshoot / speed) * 1000) : null,
    holdFrames: holdFrames.length,
    holdSpreadMetres: holdSpread,
    resumeMs,
    resumed
  };
  evidence.saveJson("freeze.json", facts, "the gap in A's packets and what B showed");
  await evidence.check("While A is frozen, B carries A on for at most 100 ms, then holds", "B8 B6", async () => ({
    ok: !!speed && speed > 0.5 && overshoot <= speed * 0.13 + 0.01 && holdFrames.length > 30 && holdSpread <= 0.003,
    summary:
      `gap in A's packets ${facts.gapMs} ms; A's speed before it ${speed ? speed.toFixed(2) : "?"} m/s; B's copy went ${(overshoot * 100).toFixed(1)} cm past A's last position (${facts.overshootMs ?? "?"} ms at that speed; judged 100 ms plus 30 ms for frame timing); ` +
      `then held within ${(holdSpread * 1000).toFixed(1)} mm of it for ${holdFrames.length} frames`,
    data: facts
  }));
  await evidence.check("B's copy resumes when A's packets return", "B8", async () => ({
    ok: resumeMs !== null && resumeMs <= 500 && !!resumed && resumed.net > 0.2,
    summary: `B's copy moved again ${resumeMs ?? "never (within the trace)"} ms after the first packet after the gap; then ${resumed ? `${resumed.net} m in ${after.slice(0, 60).length} frames` : "no frames"}`,
    data: { resumeMs, resumed }
  }));
  await closingChecks(evidence, [a, b]);
}

// ---------- T4.11 ----------

async function oldBesideNew(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [old, n] = await startClients(evidence, [
    { identity: "old1", slot: "c", name: "C-old", profile: "OLD" },
    { identity: "member1", account: "member1", slot: "b" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); C-old runs the previous build (hubs feature/sfu-refactor)`);
  await enterAll(evidence, [old, n], hub.hubId);
  await connectedCheck(evidence, [old, n], server, "V9");
  await frameRateCheck(evidence, [old, n]);
  const [idOld, idNew] = [await idOf(old), await idOf(n)];
  await input.faceTowards(n.page, { clientId: idOld });
  const [sender, receiver] = await recordFrames(
    [
      { page: old.page, ids: [SELF] },
      { page: n.page, ids: [idOld] }
    ],
    () => walkAround(old.page)
  );
  const own = sender[SELF] ?? [];
  const copy = receiver[idOld] ?? [];
  await evidence.screenshot(n, "new-sees-old");
  // The reverse, recorded only: the old build cannot read #avatar-pose
  const reverse = await tracePose(old.page, idNew, () => input.walk(n.page, "w", 1500));
  const audio = await twoWayAudio(old, n);
  evidence.saveText("pose-traces.csv", tracesCsv({ "old own": own, "old at new": copy }), "per-frame traces: the old client's own rig and the new client's copy", "data");
  await evidence.check("The new client shows the old one moving", "V9 K2", async () => {
    const r = align(own, copy, RIG);
    const moved = changeOver(copy, RIG);
    const ownMoved = changeOver(own, RIG);
    return {
      ok: !!r && moved.net >= 0.5 * ownMoved.net && ownMoved.net > 0.5 && r.p95 < 0.05,
      summary: `the old client walked ${ownMoved.net} m net; the new client's copy ${moved.net} m; lag ${r?.lagMs ?? "?"} ms, error after alignment p95 ${r ? (r.p95 * 100).toFixed(2) : "?"} cm, max ${r ? (r.max * 100).toFixed(2) : "?"} cm (judged p95 under 5 cm)`,
      data: { align: r, moved, ownMoved }
    };
  });
  await evidence.check("The reverse (not expected): the old client's copy of the new one", "V9", async () => {
    const m = movement(reverse);
    return {
      ok: true,
      summary: `recorded only: the old client ${reverse.length ? `holds a pose of the new client that moved ${m.travelled} m (${m.seqAdvanced} packets seen) while it walked` : "holds no pose of the new client"}; audio: new hears old ${pilotText(audio.bHearsA)}, old hears new ${pilotText(audio.aHearsB)}`,
      data: { movement: m, audio }
    };
  });
  await closingChecks(evidence, [old, n]);
}

// ---------- T4.12 ----------

async function eightAvatars(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  // The bots load first: with four DESK clients already in a Dialog room a bot page, busy with known failure
  // 11 (its pose sender throws every frame), did not take its files within 4 minutes in three runs
  const botSlots: SlotName[] = ["e", "f", "g", "h"];
  const bots: Client[] = [];
  for (const slot of botSlots) bots.push(await launchBot({ hubId: hub.hubId, slot, evidence }));
  const desks = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a" },
    { identity: "member1", account: "member1", slot: "b" },
    { identity: "member2", account: "member2", slot: "c" },
    { identity: "guest", slot: "d", name: "D-guest" }
  ]);
  await enterAll(evidence, desks, hub.hubId);
  const entered = await Promise.all(bots.map(b => waitBotEntered(b).then(() => true).catch(() => false)));
  evidence.note(`room ${hub.hubId}; bots entered: ${bots.map((b, i) => `${b.name} ${entered[i]}`).join(", ")}`);
  await reannounceAvatars(desks, evidence, "so the DESK clients draw each other's avatars; the subject here is the frame rate with eight avatars");
  await connectedCheck(evidence, desks, server, "plan 6.4");
  const ids = await Promise.all([...desks, ...bots].map(idOf));
  await Promise.all(desks.map((d, i) => input.walk(d.page, i % 2 ? "w" : "s", 800)));
  await desks[0].page.waitForTimeout(5000);
  const rates: { name: string; raf: number; rendered: number }[][] = [];
  for (let pass = 0; pass < 2; pass++) {
    rates.push(await Promise.all(desks.map(async d => ({ name: d.name, ...(await measureFrameRate(d.page, 4000)) }))));
    await Promise.all(desks.map((d, i) => input.walk(d.page, i % 2 ? "s" : "w", 600)));
  }
  const held = await Promise.all(desks.map(async d => (await readPeers(d.page)).poses.length));
  const drawn = await Promise.all(desks.map(async d => (await readPeers(d.page)).models.length));
  for (const d of desks) await evidence.screenshot(d, "eight-avatars");
  evidence.saveJson("frame-rates.json", { rates, held, drawn, ids }, "frame rates of the DESK clients, the poses and models each holds");
  await evidence.check("50 fps or more on every DESK client with eight avatars in the room", "plan 6.4", async () => {
    const low = Math.min(...rates.flat().map(r => r.raf));
    return {
      ok: low >= 50,
      summary: rates.map((pass, i) => `pass ${i + 1}: ${pass.map(r => `${r.name} ${r.raf} fps`).join(", ")}`).join("; ") + `; poses held ${held.join(", ")} of 7, models drawn ${drawn.join(", ")}`,
      data: { rates, held, drawn }
    };
  });
  await evidence.check("Every DESK client holds the other seven poses", "plan 6.4", async () => ({ ok: held.every(n => n === 7), summary: `poses of others held: ${desks.map((d, i) => `${d.name} ${held[i]}`).join(", ")}` }));
  await evidence.check("No errors on the bots (known failure 11 of BASELINE.md: the bot's pose sender throws every frame)", "plan 6.4", async () => {
    // The allow-list accepts sends on channels still connecting after entry; a bot whose sender throws on
    // every frame shows them by the thousand, so they are counted apart from the allow-list here
    const counts = bots.map(b => {
      const { unexpected } = collectErrors([b], CONSOLE_ALLOW_LIST);
      const minutes = Math.max(1 / 60, (b.log[b.log.length - 1]?.t ?? 0) / 60_000);
      const notOpen = b.log.filter(e => /readyState is not 'open'/.test(e.text)).length;
      return { name: b.name, unexpected: unexpected.length, first: unexpected[0]?.text.split("\n")[0].slice(0, 160), notOpenPerMinute: Math.round(notOpen / minutes) };
    });
    return {
      ok: counts.every(c => c.unexpected === 0 && c.notOpenPerMinute < 60),
      summary: counts.map(c => `${c.name}: ${c.unexpected} unexpected${c.first ? ` (first: ${c.first})` : ""}, sends on a channel not open ${c.notOpenPerMinute} a minute`).join("; ") + " (judged: none unexpected, under 60 not-open sends a minute)",
      data: counts
    };
  });
  await closingChecks(evidence, desks);
}

// ---------- The tests ----------

test.describe("T4 avatar sync", () => {
  for (const server of SERVERS) {
    const title = blockTitle(server);
    test(`T4.1 what a moving and an idle client send, new build against old, on ${title}`, meta("t4.1", server, "V8 K2"), async ({ evidence }) => {
      runsOn(server);
      await sendCounts(evidence, server);
    });
    test(`T4.2 B's copy follows A's walk, on ${title}`, meta("t4.2", server, "B3"), async ({ evidence }) => {
      runsOn(server);
      await followsPath(evidence, server);
    });
    test(`T4.3 slow hand and head movements of a headset reach the other client, on ${title}`, meta("t4.3", server, "K2 B1b"), async ({ evidence }) => {
      runsOn(server);
      await slowMotion(evidence, server);
    });
    test(`T4.4 leave and re-enter three times, on ${title}`, meta("t4.4", server, "V2 B1a"), async ({ evidence }) => {
      runsOn(server);
      await leaveAndReenter(evidence, server);
    });
    test(`T4.5 a late joiner gets the model and pose, on ${title}`, meta("t4.5", server, "A5"), async ({ evidence }) => {
      runsOn(server);
      await lateJoin(evidence, server);
    });
    test(`T4.6 avatar changed three times, on ${title}`, meta("t4.6", server, "V4 B4"), async ({ evidence }) => {
      runsOn(server);
      await changeAvatar(evidence, server);
    });
    test(`T4.7 each sample avatar, on ${title}`, meta("t4.7", server, "V1 B4 B1f"), async ({ evidence }) => {
      runsOn(server);
      await eachAvatar(evidence, server);
    });
    test(`T4.8 headset in and out of VR and a lost controller, on ${title}`, meta("t4.8", server, "B8"), async ({ evidence }) => {
      runsOn(server);
      await headsetFlags(evidence, server);
    });
    test(`T4.9 interpolation delay 0 against 100 ms, on ${title}`, meta("t4.9", server, "V7 B6"), async ({ evidence }) => {
      runsOn(server);
      await interpolationDelay(evidence, server);
    });
    test(`T4.10 the sender's page frozen for 3 s, on ${title}`, meta("t4.10", server, "B8 B6"), async ({ evidence }) => {
      runsOn(server);
      await frozenSender(evidence, server);
    });
    test(`T4.11 old build and new build in one room, on ${title}`, meta("t4.11", server, "V9 K2"), async ({ evidence }) => {
      runsOn(server);
      await oldBesideNew(evidence, server);
    });
    test(`T4.12 eight avatars, four DESK and four BOT, on ${title}`, meta("t4.12", server, "plan 6.4"), async ({ evidence }) => {
      runsOn(server);
      test.setTimeout(25 * 60_000);
      await eightAvatars(evidence, server);
    });
  }
});
