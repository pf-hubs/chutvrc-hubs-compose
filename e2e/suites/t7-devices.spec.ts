// T7 device profiles (plan 4, T7.1 to T7.7): the QUEST, ANDROID and IOS profiles and the slow-device and
// poor-network modifiers, each with a DESK observer, on Dialog in the Dialog block and on LiveKit in a LiveKit
// block (LiveKit Cloud: T7.1 and T7.2 only). Every test draws who hears whom and who sees whom as pictures.
//
// Where the profiles stop (TRIALS.md, trial c; clients/launch.ts): IOS is Linux WebKit in the netclient
// container (software rendering), its microphone the slot's pilot made with Web Audio, and its own hearing
// measured from WebRTC statistics (its Web Audio cannot read a remote track). ANDROID is Edge with the Pixel 7
// descriptor, driven by touch through the DevTools protocol. Neither shows a phone's GPU, Safari or Chrome on
// Android themselves; that stays on the real-device list.
import fs from "node:fs";
import path from "node:path";
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { BASE_URL } from "../lib/env";
import { room, SFU_ID, type MediaServer, type RoomName } from "../lib/fixtures";
import { sql, sqlText } from "../lib/stack";
import { isWebKitClient, throttleCpu, type Client } from "../clients/launch";
import { launchBot, waitBotEntered, botRecordingAvailable } from "../clients/bot";
import * as input from "../clients/input";
import * as touch from "../clients/touch";
import { answerRoomLinks, resolverStatus } from "../clients/local-stack";
import { linkStatistics, shapeLink } from "../clients/network";
import { reannounceAvatars, reenterSilentSenders } from "../clients/workarounds";
import { enterRoom } from "../clients/enter";
import { clientFromDevice, enterVr, exitVr, isPresenting, playTimeline, startTimeline, stopTimeline, takeApplied, type AppliedFrame, type Timeline } from "../clients/motion";
import { convertBotRecording } from "../motions/convert-bot-recording";
import { CONTROL_HZ, type SlotName } from "../assets/media";
import { PAGES_PDF_URL, IMAGE_URL } from "../assets/generate";
import { measureFrameRate, readPeers, readSession } from "../probes/session";
import { PILOT_HEARD, PILOT_SILENT, heardPilot, inboundAudio, INBOUND_HEARD_DBFS, startPilotWatch, stopPilotWatch, audioGap } from "../probes/audio";
import { SELF, align, changeOver, freezes, movement, recordFrames, tracePose, tracesCsv, smoothness, LEFT_HAND, RIGHT_HAND, RIG, HEAD_ANGLES, type FrameSample } from "../probes/poses";
import { readMemory, trend, type MemorySample } from "../probes/memory";
import { recordPackets, summarisePackets } from "../probes/packets";
import { liveConnections } from "../probes/connections";
import { IS_CONNECTED } from "../probes/compat";
import { hearingGrid, seeingGrid, saveGrid, gridLine, type Grid } from "../report/grids";
import { mosaicVideo } from "../report/mosaic";
import { BLOCK, blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, connectedCheck, enterAll, frameRateCheck, idOf, mainRoom, startClients, waitUntil, type Seat } from "./common";
import { CONTAINER_CERTIFICATE, KNOWN_MIC_WISH_LOST } from "./console-allowlist";

const SERVERS = ["dialog", "livekit"] as const;
/** Allowances for known failures these tests are not about, and for the netclient container (suites/console-allowlist.ts) */
const ALLOW = [KNOWN_MIC_WISH_LOST, ...CONTAINER_CERTIFICATE];
const CLOUD = BLOCK === "livekit-cloud";

const meta = (id: string, server: MediaServer, covers: string) => ({
  annotation: [
    { type: "id", description: `${id}-${blockId(server)}` },
    { type: "covers", description: covers }
  ]
});

/** T7.3 to T7.7 do not run on LiveKit Cloud (plan step 8: Cloud for T7.1 and T7.2 only) */
function notOnCloud(server: MediaServer) {
  test.skip(server === "livekit" && CLOUD, "on LiveKit Cloud only T7.1 and T7.2 run (plan step 8)");
}

const heardBy = (r: { ratio: number; controlRatio: number }) => r.ratio >= PILOT_HEARD && r.controlRatio <= PILOT_SILENT;

/**
 * Enters the clients together (plan 2.2), then lets a client whose sending failed at the joint join enter
 * again (logged workaround for known failures 3 and 21; the T7 tests are about the device profiles)
 */
async function enterDevices(evidence: Evidence, clients: Client[], hubId: string) {
  const timings = await enterAll(evidence, clients, hubId);
  await reenterSilentSenders(clients, evidence, "so the test sees the device profile rather than the joint join", c => enterRoom(c, hubId, { displayName: c.name }));
  return timings;
}

/** Does `listener` hear `sender`: the pilot on a Chromium listener, arriving audio with a level on WebKit */
async function hears(listener: Client, sender: Client, ms = 3000): Promise<{ heard: boolean; text: string }> {
  const id = await idOf(sender);
  if (isWebKitClient(listener)) {
    const r = await inboundAudio(listener.page, id, ms);
    return { heard: r.packets > 0 && r.meanDbfs !== null && r.meanDbfs >= INBOUND_HEARD_DBFS, text: r.error ?? `${r.packets} packets at ${r.meanDbfs} dBFS` };
  }
  const r = await heardPilot(listener.page, id, sender.pilotHz, CONTROL_HZ, ms);
  return { heard: heardBy(r), text: `pilot ${r.ratio}${r.error ? ` (${r.error})` : ""}` };
}

/**
 * Both grids of plan 3.3 for the clients, saved as pictures shown in the report; returns them. The avatar
 * announcement is sent again first (logged workaround for known failure 1), unless the test is about it.
 */
async function grids(evidence: Evidence, clients: Client[], stem: string, label: string, opts: { reannounce?: boolean; covers?: string } = {}) {
  if (opts.reannounce !== false) await reannounceAvatars(clients.filter(c => c.profile !== "BOT"), evidence, `before the grids ${label} (the subject is the device profiles)`);
  const hear = await hearingGrid(clients, `Who hears whom ${label}`);
  const see = await seeingGrid(clients, `Who sees whom ${label}`);
  const note = clients.some(isWebKitClient) ? "IOS rows: audio arriving with a level (WebRTC statistics), not the pilot." : "";
  await saveGrid(evidence, `grid-hear-${stem}`, hear, clients, note);
  await saveGrid(evidence, `grid-see-${stem}`, see, clients, "Seeing: the pose arrives and advances, and a model is drawn.");
  return { hear, see };
}

const gridCheck = (evidence: Evidence, g: Grid, covers: string) =>
  evidence.check(`${g.title}: every cell`, covers, async () => ({
    ok: g.missing.length === 0,
    summary: `${g.missing.length ? `missing: ${g.missing.join("; ")}` : "full"}. ${gridLine(g)}`,
    data: g.missing
  }));

/** Window positions: DESK and QUEST windows (1280 x 720) and the phone windows (412 x 839) side by side */
const PHONE_POSITIONS: [number, number][] = [
  [1300, 0],
  [1500, 120]
];

// ---------- T7.1 ----------

/** The colour at the top left of the placed PDF's canvas on a client: which page it has actually drawn */
function pdfCanvasColour(c: Client, src: string): Promise<[number, number, number] | null> {
  return c.page.evaluate(
    ({ finder, src }) => {
      const el = new Function("arg", finder)({ src });
      const pdf = el?.components?.["media-pdf"];
      if (!pdf?.canvas?.width) return null;
      const d = pdf.canvasContext.getImageData(Math.floor(pdf.canvas.width * 0.05), Math.floor(pdf.canvas.height * 0.08), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    { finder: input.FIND_MEDIA_CODE, src }
  );
}

/** The page colours of pages.pdf (assets/generate.ts) */
const PAGE_COLOURS: [number, number, number][] = [
  [200, 40, 40],
  [40, 160, 60],
  [40, 80, 200],
  [220, 150, 30],
  [130, 50, 160]
];
const pageOfColour = (rgb: [number, number, number] | null) => {
  if (!rgb) return null;
  const d = PAGE_COLOURS.map(c => Math.hypot(c[0] - rgb[0], c[1] - rgb[1], c[2] - rgb[2]));
  const best = d.indexOf(Math.min(...d));
  return d[best] < 60 ? best : null;
};

/** The emulated devices' frames as the client's own pose should follow them (TRIALS.md step 7 offsets), as frame samples */
function appliedAsFrames(applied: AppliedFrame[]): FrameSample[] {
  return applied.map(f => {
    const left = clientFromDevice("left", f.left).pos;
    const right = clientFromDevice("right", f.right).pos;
    const head = clientFromDevice("head", f.head).pos;
    return { t: f.t, rig: [0, 0, 0], yaw: 0, head, pitch: 0, headYaw: 0, roll: 0, left, right, seq: null, tracked: null, isVR: true };
  });
}

async function questAndDesk(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [d, q] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-desk" },
    { identity: "quest1", slot: "b", name: "B-quest", profile: "QUEST" }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); B-quest is Edge with IWER emulating a Quest 3 and the Quest Browser's user agent; A-desk (the room's owner) observes and places the PDF`);
  await enterDevices(evidence, [d, q], hub.hubId);
  await frameRateCheck(evidence, [d, q]);
  await connectedCheck(evidence, [d, q], server, "V1");
  const idq = await idOf(q);

  await evidence.check("The headset enters VR on Enter Room", "V1", async () => {
    const presenting = await isPresenting(q.page);
    const own = await q.page.evaluate(id => (window as any).__e2eApi.pose(id), idq);
    await evidence.screenshot(q, "in-vr");
    return { ok: presenting && own?.isVR === true, summary: `presenting ${presenting}; own pose isVR ${own?.isVR}, tracked ${own?.tracked}`, data: own };
  });

  const { hear, see } = await grids(evidence, [d, q], "entry", "after entry", { covers: "V1" });
  await evidence.check("Audio both ways", "V1", async () => ({ ok: hear.missing.length === 0, summary: gridLine(hear), data: hear.cells }));

  const h1 = convertBotRecording();
  await input.faceTowards(d.page, { clientId: idq });
  await takeApplied(q.page);
  const [own, copy] = await recordFrames(
    [
      { page: q.page, ids: [SELF] },
      { page: d.page, ids: [idq] }
    ],
    async () => {
      await startTimeline(q.page, h1.timeline);
      await d.page.waitForTimeout(h1.timeline.keyframes[h1.timeline.keyframes.length - 1].t / 2);
      await evidence.screenshot(d, "observer-sees-H1");
      await evidence.screenshot(q, "headset-plays-H1");
      // Polled on a timer: in VR the window's frame callbacks are held, as on the headset
      await q.page.waitForFunction(() => !(window as any).__e2eMotion.playing, undefined, { timeout: 60_000, polling: 250 });
    }
  );
  const applied = await takeApplied(q.page);
  const ownTrace = own[SELF] ?? [];
  const copyTrace = copy[idq] ?? [];
  evidence.saveText("h1-traces.csv", tracesCsv({ "B own": ownTrace, "B at A": copyTrace }), "per-frame traces while the headset played H1: its own pose and the observer's copy", "data");

  await evidence.check("The observer sees isVR and moving hands (H1)", "V1 V3", async () => {
    const late = copyTrace.slice(Math.floor(copyTrace.length / 3));
    const isVR = [...new Set(late.map(s => s.isVR))];
    const hands = (["left", "right"] as const).map(side => {
      const ch = side === "left" ? LEFT_HAND : RIGHT_HAND;
      const range = (t: FrameSample[]) => (t.length ? Math.max(...[0, 1, 2].map(k => Math.max(...t.map(s => ch(s)[k])) - Math.min(...t.map(s => ch(s)[k])))) : 0);
      return { side, own: +range(ownTrace).toFixed(3), copy: +range(copyTrace).toFixed(3), fit: align(ownTrace, copyTrace, ch, { maxLagMs: 800 }) };
    });
    const ok = copyTrace.length > 200 && isVR.length === 1 && isVR[0] === true && hands.every(h => h.own > 0.1 && h.copy >= 0.8 * h.own && !!h.fit && h.fit.p95 < 0.05);
    return {
      ok,
      summary:
        `the observer's copy: isVR ${isVR.join("/")}; ` +
        hands.map(h => `${h.side} hand moved ${(h.copy * 100).toFixed(0)} cm (own ${(h.own * 100).toFixed(0)} cm), p95 error ${h.fit ? (h.fit.p95 * 100).toFixed(1) : "?"} cm at lag ${h.fit?.lagMs ?? "?"} ms`).join("; ") +
        ` (${copyTrace.length} frames)`,
      data: { isVR, hands }
    };
  });

  await evidence.check("The own hands follow the controllers within one frame", "V3", async () => {
    const truth = appliedAsFrames(applied);
    const rows = (["left", "right"] as const).map(side => ({ side, fit: align(truth, ownTrace, side === "left" ? LEFT_HAND : RIGHT_HAND, { maxLagMs: 100, stepMs: 1 }) }));
    const fps = await measureFrameRate(q.page, 2000);
    const frameMs = 1000 / Math.max(1, fps.raf);
    const ok = rows.every(r => !!r.fit && r.fit.lagMs <= frameMs + 1 && r.fit.rms < 0.01);
    return {
      ok,
      summary: rows.map(r => `${r.side}: the own hand trails the controller by ${r.fit?.lagMs ?? "?"} ms, rms ${r.fit ? (r.fit.rms * 1000).toFixed(1) : "?"} mm after alignment`).join("; ") + ` (one frame: ${frameMs.toFixed(1)} ms at ${fps.raf} fps; ${applied.length} device frames)`,
      data: rows
    };
  });

  await evidence.check("A PDF paged while the headset is in VR: the headset follows and draws the new page", "F3", async () => {
    await input.placeFromUrl(d.page, PAGES_PDF_URL);
    const placed = await waitUntil(async () => (await input.pdfPageOf(d.page, PAGES_PDF_URL)) !== null && (await input.pdfPageOf(q.page, PAGES_PDF_URL)) !== null, 30_000);
    if (!placed.value) return { ok: false, summary: "the PDF did not appear on both clients within 30 s" };
    await d.page.waitForTimeout(3000);
    await input.faceTowards(d.page, { mediaSrc: PAGES_PDF_URL });
    const rows: string[] = [];
    let ok = true;
    for (let step = 1; step <= 2; step++) {
      await input.pagePdf(d.page, PAGES_PDF_URL, "next");
      const followed = await waitUntil(async () => {
        const [pd, pq] = [await input.pdfPageOf(d.page, PAGES_PDF_URL), await input.pdfPageOf(q.page, PAGES_PDF_URL)];
        const drawn = pageOfColour(await pdfCanvasColour(q, PAGES_PDF_URL));
        return pd === step && pq === step && drawn === step ? { pd, pq, drawn } : null;
      }, 15_000);
      const drawn = pageOfColour(await pdfCanvasColour(q, PAGES_PDF_URL));
      const pq = await input.pdfPageOf(q.page, PAGES_PDF_URL);
      if (!followed.value) ok = false;
      rows.push(`page ${step + 1}: headset index ${pq !== null ? pq + 1 : "-"}, headset's canvas shows page ${drawn !== null ? drawn + 1 : "?"}${followed.value ? ` after ${followed.ms} ms` : ""}`);
    }
    await evidence.screenshot(q, "pdf-paged-in-vr");
    return { ok: ok && (await isPresenting(q.page)), summary: `paged by A-desk with the hover menu while B-quest presents: ${rows.join("; ")}; still presenting ${await isPresenting(q.page)}`, data: rows };
  });

  await evidence.check("Leave VR and enter again: the observer follows, the own hands still follow", "V1 V3", async () => {
    await exitVr(q.page);
    const out = await waitUntil(async () => (await d.page.evaluate(id => (window as any).__e2eApi.pose(id)?.isVR, idq)) === false, 10_000);
    await evidence.screenshot(q, "left-vr");
    await enterVr(q.page);
    const back = await waitUntil(async () => (await d.page.evaluate(id => (window as any).__e2eApi.pose(id)?.isVR, idq)) === true, 10_000);
    await takeApplied(q.page);
    const short: Timeline = { name: "H1, the first 4 s", keyframes: h1.timeline.keyframes.filter(k => k.t <= 4000) };
    const [own2] = await recordFrames([{ page: q.page, ids: [SELF] }], () => playTimeline(q.page, short));
    const fit = align(appliedAsFrames(await takeApplied(q.page)), own2[SELF] ?? [], RIGHT_HAND, { maxLagMs: 100, stepMs: 1 });
    const presenting = await isPresenting(q.page);
    const fps = await measureFrameRate(q.page, 2000);
    await evidence.screenshot(q, "in-vr-again");
    const ok = !out.timedOut && !back.timedOut && presenting && !!fit && fit.lagMs <= 18 && fit.rms < 0.01;
    return {
      ok,
      summary:
        `observer saw isVR false ${out.timedOut ? "never" : `after ${out.ms} ms`}, true again ${back.timedOut ? "never" : `after ${back.ms} ms`}; presenting ${presenting} at ${fps.raf} fps; ` +
        `right hand after re-entry trails by ${fit?.lagMs ?? "?"} ms, rms ${fit ? (fit.rms * 1000).toFixed(1) : "?"} mm`,
      data: { fit, fps }
    };
  });
  await gridCheck(evidence, see, "V1");
  await closingChecks(evidence, [d, q], ALLOW);
}

// ---------- T7.2 ----------

/** The phone's own toolbar or menu entry, tapped: on a narrow screen some toolbar buttons live in the More menu */
async function tapToolbar(p: Client, label: string) {
  const button = p.page.getByRole("button", { name: label, exact: true });
  if (await button.isVisible().catch(() => false)) return touch.tap(button);
  await touch.tap(p.page.getByRole("button", { name: "More", exact: true }));
  await p.page.waitForTimeout(500);
  await touch.tapButtonText(p, label);
}

async function androidAndDesk(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const [d, p] = await startClients(evidence, [
    { identity: "member1", account: "member1", slot: "a", name: "A-desk" },
    // The room's owner: placing media needs the permission members do not have in these rooms
    { identity: "admin", account: "admin", slot: "b", name: "B-android", profile: "ANDROID", position: PHONE_POSITIONS[0] }
  ]);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); B-android is Edge with Playwright's Pixel 7 descriptor (touch, 412 x 839, pixel ratio 2.625, Chrome on Android's user agent), signed in as the room's owner so it may place media`);
  const entry = await enterDevices(evidence, [d, p], hub.hubId);
  await frameRateCheck(evidence, [d, p]);
  await connectedCheck(evidence, [d, p], server, "checklist-3");
  const [idd, idp] = [await idOf(d), await idOf(p)];

  await evidence.check("Mobile entry: the phone layout with the on-screen joysticks", "checklist-3", async () => {
    const mobile = await p.page.evaluate(() => (window as any).AFRAME.utils.device.isMobile());
    const sticks = await touch.joysticks(p);
    const fps = await measureFrameRate(p.page);
    const orientation = await touch.orientationOf(p);
    await evidence.screenshot(p, "entered");
    return {
      ok: mobile && !!sticks?.left && !!sticks?.right,
      summary: `isMobile ${mobile}; joysticks ${sticks ? Object.keys(sticks).join(" and ") : "none"}; entered in ${(entry[1].mediaServer / 1000).toFixed(1)} s; ${fps.raf} fps (reported, not judged); ${orientation.inner.join(" x ")} ${orientation.screenOrientation}`,
      data: { mobile, sticks, fps, orientation, entry: entry[1] }
    };
  });

  await reannounceAvatars([d, p], evidence, "so the observer draws the phone's avatar; the subject is the touch input");
  await input.faceTowards(d.page, { clientId: idp });
  await evidence.check("Move with the joysticks: the observer sees the avatar walk and turn", "checklist-3 B3", async () => {
    const trace = await tracePose(d.page, idp, async () => {
      await touch.pushStick(p, "left", 0, -1, 1500);
      await p.page.waitForTimeout(300);
      await touch.pushStick(p, "right", 1, 0, 800);
      await p.page.waitForTimeout(300);
      await touch.pushStick(p, "left", 0.7, 0.7, 800);
      await p.page.waitForTimeout(500);
    });
    const moved = movement(trace);
    await evidence.screenshot(p, "after-joysticks");
    await input.faceTowards(d.page, { clientId: idp });
    await evidence.screenshot(d, "observer-sees-phone");
    return {
      ok: moved.travelled >= 2 && moved.turned >= 20 && moved.seqAdvanced > 0,
      summary: `the observer's copy walked ${moved.travelled} m and turned ${moved.turned}° (${moved.seqAdvanced} packets; longest still ${moved.longestStillMs} ms)`,
      data: moved
    };
  });

  const { hear, see } = await grids(evidence, [d, p], "entry", "", { reannounce: false });
  await evidence.check("Audio both ways", "checklist-3", async () => ({ ok: hear.missing.length === 0, summary: gridLine(hear), data: hear.cells }));
  await gridCheck(evidence, see, "checklist-3");

  await evidence.check("Mute and unmute with a tap on Voice", "checklist-3 B2", async () => {
    const voice = p.page.getByRole("button", { name: "Voice", exact: true });
    const before = { button: await input.micButtonState(p.page), enabled: (await readSession(p.page)).micEnabled };
    await touch.tap(voice);
    await p.page.waitForTimeout(1000);
    const muted = { button: await input.micButtonState(p.page), enabled: (await readSession(p.page)).micEnabled, heard: await heardPilot(d.page, idp, p.pilotHz, CONTROL_HZ, 3000) };
    await evidence.screenshot(p, "muted");
    await touch.tap(voice);
    await p.page.waitForTimeout(1000);
    const on = { button: await input.micButtonState(p.page), enabled: (await readSession(p.page)).micEnabled, heard: await heardPilot(d.page, idp, p.pilotHz, CONTROL_HZ, 3000) };
    if (on.enabled !== true) {
      await touch.tap(voice);
      await p.page.waitForTimeout(1000);
      evidence.note(`the phone's microphone was left off after the mute check; Voice tapped once more: isMicEnabled ${(await readSession(p.page)).micEnabled}`);
    }
    const ok = before.enabled === true && muted.enabled === false && muted.heard.ratio <= PILOT_SILENT && muted.button === "muted" && on.enabled === true && heardBy(on.heard) && on.button === "on";
    return {
      ok,
      summary: `before: button ${before.button}, isMicEnabled ${before.enabled}; muted: button ${muted.button}, isMicEnabled ${muted.enabled}, observer pilot ${muted.heard.ratio}; unmuted: button ${on.button}, isMicEnabled ${on.enabled}, observer pilot ${on.heard.ratio}`,
      data: { before, muted, on }
    };
  });

  await evidence.check("Place media from the touch menu: Place, Upload, a URL, Create Object", "checklist-3 B4", async () => {
    await tapToolbar(p, "Place");
    await p.page.waitForTimeout(500);
    await evidence.screenshot(p, "place-menu");
    await touch.tapButtonText(p, "Upload");
    const field = p.page.getByLabel("Object URL or File");
    await field.waitFor({ state: "visible", timeout: 10_000 });
    await field.fill(IMAGE_URL);
    await touch.tap(p.page.getByRole("button", { name: "Create Object" }));
    const shown = await waitUntil(async () => {
      const count = (c: Client) => c.page.evaluate(src => [...document.querySelectorAll("[media-loader]")].filter((el: any) => el.components["media-loader"]?.data?.src === src).length, IMAGE_URL);
      const [onPhone, onDesk] = [await count(p), await count(d)];
      return onPhone > 0 && onDesk > 0 ? { onPhone, onDesk } : null;
    }, 30_000);
    await p.page.waitForTimeout(2000);
    await evidence.screenshot(p, "placed");
    await input.faceTowards(d.page, { mediaSrc: IMAGE_URL });
    await evidence.screenshot(d, "observer-sees-placed");
    return { ok: !!shown.value, summary: shown.value ? `the image appeared on the phone and the observer after ${shown.ms} ms` : "the image did not appear on both within 30 s", data: shown };
  });

  await evidence.check("Rotate the screen: landscape and back, still in the room and heard", "checklist-3", async () => {
    const landscape = await touch.rotate(p, "landscape");
    const sticks = await touch.joysticks(p);
    await evidence.screenshot(p, "landscape");
    const session = await readSession(p.page);
    const audio = await hears(d, p);
    const trace = await tracePose(d.page, idp, () => touch.pushStick(p, "left", 0, -1, 1000));
    const portrait = await touch.rotate(p, "portrait");
    const after = await readSession(p.page);
    const ok =
      landscape.matchesLandscape && landscape.canvasCss![0] > landscape.canvasCss![1] && !!sticks?.left && !!sticks?.right && sticks.right.x > 600 &&
      session.isConnected && audio.heard && movement(trace).travelled > 1 && !portrait.matchesLandscape && after.isConnected && after.pageLoadedAt === session.pageLoadedAt;
    return {
      ok,
      summary:
        `landscape: ${landscape.inner.join(" x ")} ${landscape.screenOrientation}, canvas ${landscape.canvasCss?.join(" x ")}, right stick at x ${sticks?.right?.x ?? "-"}; connected ${session.isConnected}; observer hears the phone: ${audio.text}; ` +
        `walked ${movement(trace).travelled} m in landscape; back to ${portrait.inner.join(" x ")} ${portrait.screenOrientation}; page loaded again ${after.pageLoadedAt !== session.pageLoadedAt}`,
      data: { landscape, sticks, portrait }
    };
  });
  await closingChecks(evidence, [d, p], ALLOW);
}

// ---------- T7.3 ----------

async function iosAndDesk(evidence: Evidence, server: MediaServer, profile: "IOS" | "IOS_IPAD") {
  const hub = room(mainRoom(server));
  const [d, i] = await startClients(evidence, [
    { identity: "member1", account: "member1", slot: "a", name: "A-desk" },
    { identity: profile === "IOS" ? "iphone1" : "ipad1", slot: "c", name: profile === "IOS" ? "C-iphone" : "C-ipad", profile }
  ]);
  const ua = await i.page.evaluate(() => navigator.userAgent);
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); ${i.name} is Playwright's Linux WebKit in the netclient container with the ${profile === "IOS" ? "iPhone 15" : "iPad (gen 7)"} descriptor (${ua}); its microphone is the slot's pilot made with Web Audio`);
  const entered = await enterDevices(evidence, [d, i], hub.hubId).catch((e: Error) => e);
  await evidence.check("Loads and enters the room", "checklist-3", async () => {
    if (entered instanceof Error) return { ok: false, summary: `did not enter: ${entered.message.split("\n")[0]}` };
    const s = await readSession(i.page);
    return { ok: s.isConnected && s.sfuId === SFU_ID[server], summary: `entered in ${(entered[1].mediaServer / 1000).toFixed(1)} s; sfuId ${s.sfuId}, connected ${s.isConnected}, microphone ${s.micTrack}${s.micEnabled ? "" : " (disabled)"}`, data: { entry: entered[1], session: s } };
  });
  if (entered instanceof Error) return closingChecks(evidence, [d, i], ALLOW);
  await frameRateCheck(evidence, [d]);
  const [idd, idi] = [await idOf(d), await idOf(i)];

  await evidence.check("Renders: frames drawn, the scene on screen", "checklist-3", async () => {
    const fps = await measureFrameRate(i.page, 3000);
    const mobile = await i.page.evaluate(() => (window as any).AFRAME.utils.device.isMobile());
    const gl = await i.page.evaluate(() => {
      const r = (window as any).AFRAME.scenes[0].renderer;
      const ext = r.getContext().getExtension("WEBGL_debug_renderer_info");
      return { webgl2: r.capabilities.isWebGL2, renderer: ext ? r.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL) : "?" };
    });
    await evidence.screenshot(i, "entered");
    return { ok: fps.rendered > 5, summary: `${fps.rendered} frames a second drawn (software rendering, not judged against 55); isMobile ${mobile}; WebGL 2 ${gl.webgl2}, renderer ${gl.renderer}`, data: { fps, mobile, gl } };
  });

  await reannounceAvatars([d, i], evidence, "so the observer draws the WebKit client's avatar; the subject is the engine");
  const { hear, see } = await grids(evidence, [d, i], "entry", "", { reannounce: false });
  await evidence.check("Audio both ways (the observer hears the pilot; the WebKit client receives audio with a level)", "checklist-3", async () => ({ ok: hear.missing.length === 0, summary: gridLine(hear), data: hear.cells }));

  await evidence.check("Sync both ways: the observer sees it walk (touch on the joysticks), it sees the observer walk", "checklist-3 B3", async () => {
    await input.faceTowards(d.page, { clientId: idi });
    const seen = movement(
      await tracePose(d.page, idi, async () => {
        await touch.pushStick(i, "left", 0, -1, 1500);
        await i.page.waitForTimeout(300);
        await touch.pushStick(i, "right", 1, 0, 800);
        await i.page.waitForTimeout(400);
      })
    );
    const seenByIos = movement(await tracePose(i.page, idd, () => input.walk(d.page, "w", 1500)));
    await evidence.screenshot(i, "after-walks");
    await evidence.screenshot(d, "observer");
    return {
      ok: seen.travelled >= 2 && seen.turned >= 10 && seenByIos.travelled >= 2,
      summary: `the observer's copy of ${i.name} walked ${seen.travelled} m and turned ${seen.turned}°; ${i.name}'s copy of the observer walked ${seenByIos.travelled} m`,
      data: { seen, seenByIos }
    };
  });
  await gridCheck(evidence, see, "checklist-3");

  await evidence.check("Mute and unmute with a tap on Voice", "checklist-3 B2", async () => {
    const voice = i.page.getByRole("button", { name: "Voice", exact: true });
    await touch.tap(voice);
    await i.page.waitForTimeout(1500);
    const muted = { enabled: (await readSession(i.page)).micEnabled, heard: await heardPilot(d.page, idi, i.pilotHz, CONTROL_HZ, 3000) };
    await touch.tap(voice);
    await i.page.waitForTimeout(1500);
    const on = { enabled: (await readSession(i.page)).micEnabled, heard: await heardPilot(d.page, idi, i.pilotHz, CONTROL_HZ, 3000) };
    return {
      ok: muted.enabled === false && muted.heard.ratio <= PILOT_SILENT && on.enabled === true && heardBy(on.heard),
      summary: `muted: isMicEnabled ${muted.enabled}, observer pilot ${muted.heard.ratio}; unmuted: isMicEnabled ${on.enabled}, observer pilot ${on.heard.ratio}`,
      data: { muted, on }
    };
  });
  evidence.note(
    "not testable in this engine (real-device list): Safari's own media, autoplay and audio session rules, iOS WebRTC and its codecs, the GPU and frame rate of a phone, " +
      "whether the WebKit client hears the pilot (its Web Audio cannot read a remote WebRTC track here; arrival and level are measured instead), a real microphone"
  );
  await closingChecks(evidence, [d, i], ALLOW);
}

// ---------- T7.4 ----------

async function switchAndMove(evidence: Evidence, server: MediaServer) {
  // In a LiveKit block the owner switches the room from Dialog to LiveKit, then everyone moves by link to a
  // Dialog room (LiveKit to Dialog). In the Dialog block there is no LiveKit server to switch to: the move
  // alone, Dialog to Dialog.
  const switching = server === "livekit";
  const startName: RoomName = switching ? "switch" : "dialog-main";
  const targetName: RoomName = "move-target-dialog";
  const start = room(startName);
  if (switching) sql(`update ret0.hubs set sfu = 0 where hub_sid = ${sqlText(start.hubId)}`);
  const target = room(targetName);
  const linkUrl = `${BASE_URL}/${target.hubId}`;
  const clients = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", name: "A-desk" },
    { identity: "quest1", slot: "b", name: "B-quest", profile: "QUEST" },
    { identity: "android1", slot: "c", name: "C-android", profile: "ANDROID", position: PHONE_POSITIONS[0] }
  ]);
  const [a, q, p] = clients;
  const resolver = await resolverStatus(a.page, linkUrl);
  for (const c of clients) await answerRoomLinks(c, [linkUrl]);
  evidence.note(
    `${switching ? `room switch ${start.hubId}, set to Dialog before the test; A-desk (owner) switches it to LiveKit, then` : `room ${start.hubId} (Dialog; no LiveKit server in this block to switch to);`} everyone moves by link to ${targetName} ${target.hubId}; ` +
      `reticulum answered ${resolver} for the room link, the harness answers it as a deployed server would (clients/local-stack.ts)`
  );
  await enterDevices(evidence, clients, start.hubId);
  await frameRateCheck(evidence, [a, q]);
  await connectedCheck(evidence, clients, "dialog", "L1 B6");
  const loaded = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, (await readSession(c.page)).pageLoadedAt] as const)));

  if (switching) {
    await evidence.check("The owner switches the room to LiveKit: the headset and the phone follow without reload, like the desktop", "L1", async () => {
      const clickedAt = Date.now();
      await input.setRoomMediaServer(a.page, "LiveKit");
      await input.closeSidebar(a.page);
      const reached = await Promise.all(
        clients.map(c =>
          c.page
            .waitForFunction(id => (window as any).__e2eApi?.sfuId() === id && (window as any).__e2eApi?.isConnected(), SFU_ID.livekit, { timeout: 45_000, polling: 250 })
            .then(() => Date.now() - clickedAt)
            .catch(() => null)
        )
      );
      await a.page.waitForTimeout(4000);
      const sessions = await Promise.all(clients.map(c => readSession(c.page)));
      const g = await hearingGrid(clients, "Who hears whom after the switch");
      await saveGrid(evidence, "grid-hear-after-switch", g, clients);
      const noReload = clients.every((c, k) => sessions[k].pageLoadedAt === loaded[c.name]);
      return {
        ok: reached.every(v => v !== null) && noReload && g.missing.length === 0,
        summary: `on LiveKit: ${clients.map((c, k) => `${c.name} ${reached[k] === null ? "never" : `after ${(reached[k]! / 1000).toFixed(1)} s`}`).join(", ")}; page loaded again: ${!noReload}; ${gridLine(g)}`,
        data: { reached, sessions, missing: g.missing }
      };
    });
  }

  await evidence.check(`Everyone moves by link to ${targetName}: the headset and the phone follow without reload`, "B6 L1", async () => {
    await input.placeFromUrl(a.page, linkUrl);
    await Promise.all(clients.map(c => input.waitForRoomLink(c.page, linkUrl)));
    const moves: Record<string, string> = {};
    const before = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, await readSession(c.page)] as const)));
    // The link is visited the way each device does: the desktop clicks its hover menu button; the headset
    // and the phone have no mouse, so their page opens the link's hover action as their own input would
    const visit = async (c: Client) => {
      const t0 = Date.now();
      if (c.profile === "DESK") {
        await input.faceTowards(c.page, { mediaSrc: linkUrl });
        await input.clickHoverMenuButton(c.page, linkUrl, "visit room");
      } else {
        await c.page.evaluate(
          ({ finder, src }) => {
            const el = new Function("arg", finder)({ src });
            const button = el && [...el.querySelectorAll("[open-media-button]")].find((b: any) => b.querySelector("[text]")?.getAttribute("text")?.value === "visit room");
            if (!button) throw new Error("no visit room button on the link");
            (button as any).object3D.dispatchEvent({ type: "interact" });
          },
          { finder: input.FIND_MEDIA_CODE, src: linkUrl }
        );
      }
      await c.page.waitForFunction(id => (window as any).APP?.hub?.hub_id === id, target.hubId, { timeout: 30_000, polling: 250 });
      await c.page.waitForFunction(IS_CONNECTED, undefined, { timeout: 30_000, polling: 250 });
      moves[c.name] = `${((Date.now() - t0) / 1000).toFixed(1)} s`;
    };
    // One after another, 3 s apart as in T2.6: clients arriving within a second of each other can lose their
    // sending for the session on Dialog (known failure 21; seen here with moves 0.3 s apart)
    for (const c of [p, q, a]) {
      await visit(c).catch(e => (moves[c.name] = `failed: ${(e as Error).message.split("\n")[0]}`));
      await c.page.waitForTimeout(3000);
    }
    await a.page.waitForTimeout(4000);
    const after = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, await readSession(c.page)] as const)));
    const noReload = clients.every(c => after[c.name].pageLoadedAt === loaded[c.name]);
    const inTarget = clients.every(c => after[c.name].hubId === target.hubId && after[c.name].isConnected && after[c.name].sfuId === SFU_ID.dialog);
    const g = await hearingGrid(clients, `Who hears whom in ${targetName}`);
    await saveGrid(evidence, "grid-hear-after-move", g, clients);
    const peers = Object.fromEntries(await Promise.all(clients.map(async c => [c.name, await readPeers(c.page)] as const)));
    for (const c of clients) await evidence.screenshot(c, "moved");
    return {
      ok: noReload && inTarget && g.missing.length === 0,
      summary: `moved: ${Object.entries(moves).map(([n, m]) => `${n} ${m}`).join(", ")}; page loaded again: ${!noReload}; all in ${target.hubId} on Dialog: ${inTarget}; ${gridLine(g)}; poses held ${clients.map(c => `${c.name} ${peers[c.name].poses.length}`).join(", ")}`,
      data: { before, after, moves, peers, missing: g.missing }
    };
  });
  const { see } = await grids(evidence, clients, "end", "after the move");
  await gridCheck(evidence, see, "B6");
  if (switching) sql(`update ret0.hubs set sfu = 0 where hub_sid = ${sqlText(start.hubId)}`);
  await closingChecks(evidence, clients, ALLOW);
}

// ---------- T7.5 ----------

async function poorNetwork(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  shapeLink("normal");
  const clients = await startClients(evidence, [
    { identity: "netclient", slot: "c", name: "C-poor-net", modifiers: ["poor-network"] },
    { identity: "admin", account: "admin", slot: "a", name: "A-desk" },
    { identity: "member1", account: "member1", slot: "b", name: "B-desk" }
  ]);
  const [n, a, b] = clients;
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); C-poor-net is headless Chromium in the netclient container (software rendering; its rates are not judged), its link shaped with tc netem`);
  await enterDevices(evidence, clients, hub.hubId);
  await frameRateCheck(evidence, [a, b]);
  await connectedCheck(evidence, clients, server, "B6");
  const idn = await idOf(n);
  await reannounceAvatars(clients, evidence, "so the observers draw the poor-network client; the subject is its link");
  const { see: seeStart } = await grids(evidence, clients, "clean", "on a clean link", { reannounce: false });
  await gridCheck(evidence, seeStart, "B6");

  // The container's clock is not this PC's: C's own frames are stamped with it, so they are moved onto the PC's
  // clock by the offset measured here (the reading with the shortest round trip of ten)
  const clockOffset = async () => {
    let best = { rtt: Infinity, offset: 0 };
    for (let i = 0; i < 10; i++) {
      const t0 = Date.now();
      const pageNow = await n.page.evaluate(() => performance.timeOrigin + performance.now());
      const t1 = Date.now();
      if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: pageNow - (t0 + t1) / 2 };
    }
    return best;
  };
  const offset = await clockOffset();
  evidence.note(`the netclient container's clock is ${offset.offset.toFixed(0)} ms off this PC's (measured with a ${offset.rtt} ms round trip); C's own frames are moved by that before they are compared`);

  /** A phase: the link shaped, then C walks for 6 s while A and B record their copies and listen */
  const phase = async (name: string, netem: string[] | null, judgeFreezes: boolean) => {
    const shaped = netem ? shapeLink({ netem }) : shapeLink("normal");
    await n.page.waitForTimeout(3000);
    const [own, atA, atB] = await recordFrames(
      [
        { page: n.page, ids: [SELF] },
        { page: a.page, ids: [idn] },
        { page: b.page, ids: [idn] }
      ],
      async () => {
        await input.walk(n.page, "w", 2500);
        await input.snapTurn(n.page, "left", 1);
        await input.walk(n.page, "s", 2500);
      }
    );
    const audio = await Promise.all([a, b].map(o => hears(o, n, 4000)));
    const stats = linkStatistics();
    const ownOnPcClock = (own[SELF] ?? []).map(s => ({ ...s, t: s.t - offset.offset }));
    const rows = [atA[idn] ?? [], atB[idn] ?? []].map((copy, k) => {
      const fit = align(ownOnPcClock, copy, RIG, { maxLagMs: 5000, stepMs: 5 });
      const fr = freezes(ownOnPcClock, copy, fit?.lagMs ?? 150, { minMs: 300, channels: [RIG] });
      return { observer: [a, b][k].name, frames: copy.length, moved: changeOver(copy, RIG).net, fit, longestFreezeMs: fr.longestMs, freezes: fr.stretches.length, heard: audio[k] };
    });
    evidence.saveText(`traces-${name}.csv`, tracesCsv({ "C own (PC clock)": ownOnPcClock, "C at A": atA[idn] ?? [], "C at B": atB[idn] ?? [] }), `per-frame traces in phase ${name}`, "data");
    evidence.saveText(`link-${name}.txt`, stats, `tc statistics of the netclient's link after phase ${name}`);
    await evidence.screenshot(a, `phase-${name}`);
    return { name, shaped, rows, judgeFreezes };
  };

  const loss = await phase("loss", ["delay", "40ms", "30ms", "loss", "5%"], true);
  await evidence.check("5% loss with 30 ms jitter: the others see it move with no freeze over 300 ms and still hear its pilot", "B6 B8", async () => ({
    ok: loss.rows.every(r => r.frames > 100 && r.moved > 1 && r.longestFreezeMs <= 300 && r.heard.heard),
    summary: `netem ${loss.shaped}: ` + loss.rows.map(r => `${r.observer}: moved ${r.moved.toFixed(2)} m net, lag ${r.fit?.lagMs ?? "?"} ms, p95 error ${r.fit ? (r.fit.p95 * 100).toFixed(1) : "?"} cm, longest freeze ${r.longestFreezeMs} ms (${r.freezes} over 300 ms), hears it: ${r.heard.text}`).join("; "),
    data: loss.rows
  }));
  const slow = await phase("1mbit", ["rate", "1mbit"], false);
  await evidence.check("1 Mbit/s: the others still see it move and hear its pilot (freezes reported)", "B6", async () => ({
    ok: slow.rows.every(r => r.frames > 100 && r.moved > 1 && r.heard.heard),
    summary: `netem ${slow.shaped}: ` + slow.rows.map(r => `${r.observer}: moved ${r.moved.toFixed(2)} m net, lag ${r.fit?.lagMs ?? "?"} ms, longest freeze ${r.longestFreezeMs} ms, hears it: ${r.heard.text}`).join("; "),
    data: slow.rows
  }));
  shapeLink("normal");
  await n.page.waitForTimeout(3000);

  await evidence.check("A 10 s blackout: it reconnects and resumes (session, audio, poses)", "B6 A1d", async () => {
    await startPilotWatch(a.page, "blackout", idn, n.pilotHz);
    const noticed = new Set<string>();
    const t0 = Date.now();
    shapeLink("offline");
    const poll = (async () => {
      while (Date.now() - t0 < 10_000) {
        if (!(await readSession(n.page).catch(() => null))?.isConnected) noticed.add("C");
        await new Promise(r => setTimeout(r, 300));
      }
    })();
    await new Promise(r => setTimeout(r, 10_000));
    shapeLink("normal");
    await poll;
    const restoredAt = Date.now();
    const back = await waitUntil(async () => {
      const s = await readSession(n.page).catch(() => null);
      return s?.isConnected && s.sfuId === SFU_ID[server] ? s : null;
    }, 90_000, 1000);
    await a.page.waitForTimeout(8000);
    const watch = await stopPilotWatch(a.page, "blackout");
    const audioBack = audioGap(watch, restoredAt - watch.startedAt);
    const idNow = await idOf(n);
    const p0 = await readPose(a, idNow);
    await input.walk(n.page, "w", 1200);
    const p1 = await readPose(a, idNow);
    const posesResume = !!p0 && !!p1 && p1.seq !== p0.seq;
    const nHearsA = await hears(n, a, 4000);
    const stats = linkStatistics();
    evidence.saveText("link-blackout.txt", stats, "tc statistics after the blackout");
    await evidence.screenshot(n, "after-blackout");
    return {
      ok: !!back.value && audioBack.heardAfterMs !== null && posesResume && nHearsA.heard,
      summary:
        `C noticed the outage: ${noticed.size > 0}; connected again ${back.value ? `${(back.ms / 1000).toFixed(1)} s after the link came back (client id ${idNow === idn ? "unchanged" : "new"})` : "never (90 s)"}; ` +
        `A hears C again ${audioBack.heardAfterMs === null ? "never" : `after ${audioBack.heardAfterMs} ms`}; C's poses at A ${posesResume ? "advance" : "do not advance"}; C hears A: ${nHearsA.text}`,
      data: { back: back.value, watch: { detections: watch.detections.length, trackChanges: watch.trackChanges }, audioBack, p0, p1 }
    };
  });
  const { see } = await grids(evidence, clients, "after-blackout", "after the blackout");
  await gridCheck(evidence, see, "B6");
  shapeLink("normal");
  await closingChecks(evidence, clients, ALLOW);
}

async function readPose(c: Client, id: string) {
  return c.page.evaluate(id => {
    const p = (window as any).__e2eApi.pose(id);
    return p ? { seq: p.seq, rig: [p.rig.pos.x, p.rig.pos.z] } : null;
  }, id);
}

// ---------- T7.6 ----------

async function slowDevices(evidence: Evidence, server: MediaServer) {
  const hub = room(mainRoom(server));
  const clients = await startClients(evidence, [
    { identity: "member1", account: "member1", slot: "a", name: "A-desk" },
    { identity: "quest1", slot: "b", name: "B-quest", profile: "QUEST" },
    { identity: "android1", slot: "c", name: "C-android", profile: "ANDROID", position: PHONE_POSITIONS[0] }
  ]);
  const [d, q, p] = clients;
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); the headset and the phone are throttled ${4} times (Emulation.setCPUThrottlingRate) after a measurement at full speed`);
  await enterDevices(evidence, clients, hub.hubId);
  await frameRateCheck(evidence, [d, q]);
  await connectedCheck(evidence, clients, server, "B3");
  const [idq, idp] = [await idOf(q), await idOf(p)];
  await reannounceAvatars(clients, evidence, "so the observer draws both devices; the subject is the slow CPU");

  /** Frame rate and pose send rate of the two devices while they move; the observer's copies of them */
  const measure = async (label: string) => {
    const fps = { quest: await measureFrameRate(q.page, 3000), android: await measureFrameRate(p.page, 3000) };
    const gestures: Timeline = convertBotRecording().timeline;
    let sentQ: ReturnType<typeof summarisePackets> | null = null;
    let sentP: ReturnType<typeof summarisePackets> | null = null;
    const [atD, ownQ, ownP] = await recordFrames(
      [
        { page: d.page, ids: [idq, idp] },
        { page: q.page, ids: [SELF] },
        { page: p.page, ids: [SELF] }
      ],
      async () => {
        await Promise.all([
          recordPackets(q.page, async () => {
            await startTimeline(q.page, { name: "H1 for 8 s", keyframes: gestures.keyframes.filter(k => k.t <= 8000) });
            await q.page.waitForTimeout(8200);
          }).then(e => (sentQ = summarisePackets(e))),
          recordPackets(p.page, async () => {
            await touch.pushStick(p, "left", 0, -1, 2500);
            await touch.pushStick(p, "right", 1, 0, 1500);
            await touch.pushStick(p, "left", 0, 1, 2500);
            await p.page.waitForTimeout(1500);
          }).then(e => (sentP = summarisePackets(e)))
        ]);
      }
    );
    const rate = (s: ReturnType<typeof summarisePackets> | null) => s?.byLabel["#avatar-pose"]?.sentPerSecond ?? 0;
    const copies = [
      { name: q.name, own: ownQ[SELF] ?? [], copy: atD[idq] ?? [], ch: RIGHT_HAND },
      { name: p.name, own: ownP[SELF] ?? [], copy: atD[idp] ?? [], ch: RIG }
    ].map(x => {
      const fit = align(x.own, x.copy, x.ch, { maxLagMs: 1500 });
      const fr = freezes(x.own, x.copy, fit?.lagMs ?? 150, { minMs: 300, channels: [x.ch] });
      return { name: x.name, frames: x.copy.length, fit, longestFreezeMs: fr.longestMs, smooth: smoothness(x.copy, x.ch) };
    });
    evidence.saveText(`traces-${label}.csv`, tracesCsv({ "B own": ownQ[SELF] ?? [], "C own": ownP[SELF] ?? [], "B at A": atD[idq] ?? [], "C at A": atD[idp] ?? [] }), `per-frame traces ${label}`, "data");
    return { label, fps, sendRate: { quest: rate(sentQ), android: rate(sentP) }, copies };
  };

  const full = await measure("full-speed");
  const memory: Record<string, MemorySample[]> = { [q.name]: [], [p.name]: [] };
  const sample = async () => {
    for (const c of [q, p]) memory[c.name].push(await readMemory(c));
  };
  await Promise.all([throttleCpu(q, 4), throttleCpu(p, 4)]);
  await d.page.waitForTimeout(3000);
  await sample();
  const slowed: Awaited<ReturnType<typeof measure>>[] = [];
  const t0 = Date.now();
  // About three minutes throttled: the motion measured three times, memory sampled throughout
  for (let round = 1; round <= 3; round++) {
    slowed.push(await measure(`slow-${round}`));
    await sample();
    await evidence.screenshot(d, `observer-slow-${round}`);
    while (Date.now() - t0 < round * 60_000) {
      await touch.pushStick(p, "left", 0.5, -0.5, 1000).catch(() => {});
      await d.page.waitForTimeout(4000);
    }
    await sample();
  }
  evidence.saveJson("slow-device.json", { full, slowed, memory }, "frame rates, send rates and the observer's copies at full speed and throttled; memory samples");

  await evidence.check("The send rate falls with the frame rate (reported)", "B3", async () => {
    const s = slowed[slowed.length - 1];
    return {
      ok: true,
      summary:
        `full speed: headset ${full.fps.quest.raf} fps sending ${full.sendRate.quest}/s, phone ${full.fps.android.raf} fps sending ${full.sendRate.android}/s; ` +
        `throttled 4x: headset ${s.fps.quest.raf} fps sending ${s.sendRate.quest}/s, phone ${s.fps.android.raf} fps sending ${s.sendRate.android}/s (the client sends at most one pose per frame, gated at 22 ms)`,
      data: { full, slowed: slowed.map(x => ({ label: x.label, fps: x.fps, sendRate: x.sendRate })) }
    };
  });
  await evidence.check("The observer still sees smooth motion of both (no freeze over 300 ms)", "B3 B6", async () => {
    const rows = slowed.flatMap(s => s.copies.map(c => ({ round: s.label, ...c })));
    return {
      ok: rows.every(r => r.frames > 100 && r.longestFreezeMs <= 300),
      summary: rows.map(r => `${r.round} ${r.name}: ${r.frames} frames, lag ${r.fit?.lagMs ?? "?"} ms, longest freeze ${r.longestFreezeMs} ms, step p99 ${(r.smooth.stepP99 * 100).toFixed(2)} cm`).join("; "),
      data: rows
    };
  });
  await evidence.check("No memory growth on the slowed devices (about 3 minutes)", "F10", async () => {
    const rows = Object.entries(memory).map(([name, samples]) => ({ name, t: trend(samples) }));
    return {
      ok: rows.every(r => !!r.t && r.t.heapMbPerMinute < 2 && r.t.geometriesGrowth <= 5 && r.t.texturesGrowth <= 5),
      summary: rows.map(r => (r.t ? `${r.name}: heap ${r.t.first.heapUsedMb} -> ${r.t.last.heapUsedMb} MB (${r.t.heapMbPerMinute} MB/min), geometries ${r.t.geometriesGrowth >= 0 ? "+" : ""}${r.t.geometriesGrowth}, textures ${r.t.texturesGrowth >= 0 ? "+" : ""}${r.t.texturesGrowth}` : `${r.name}: too few samples`)).join("; ") + " (judged: under 2 MB/min, at most 5 more geometries or textures)",
      data: rows
    };
  });
  const { see } = await grids(evidence, clients, "slow", "with the devices throttled", { reannounce: false });
  await gridCheck(evidence, see, "B3");
  await closingChecks(evidence, clients, ALLOW);
}

// ---------- T7.7 ----------

const MIXED_MINUTES = Number(process.env.T7_MIXED_MINUTES ?? 10);

async function mixedRoom(evidence: Evidence, server: MediaServer, withBots: boolean) {
  test.setTimeout((MIXED_MINUTES + 25) * 60_000);
  const hub = room(mainRoom(server));
  const bots: Client[] = [];
  if (withBots) {
    if (!botRecordingAvailable()) throw new Error("the bot recording is missing from services/hubs/scripts/bot");
    // The bots load first (T4.12: a bot's page started after several clients were in a Dialog room did not take its files)
    for (const slot of ["h", "i"] as SlotName[]) bots.push(await launchBot({ hubId: hub.hubId, slot, evidence }));
  }
  // The six Edge clients run headless here (Edge's headless mode renders on the GPU, TRIALS.md trial a): with six
  // visible windows and the bots, Edge processes did not finish starting on this PC (their network service
  // crashing over and over; two runs), while four windows alone start in about a second
  const seats: Seat[] = [
    { identity: "admin", account: "admin", slot: "a", name: "A-desk", headless: true },
    { identity: "member1", account: "member1", slot: "b", name: "B-desk", headless: true },
    { identity: "quest1", slot: "d", name: "D-quest", profile: "QUEST", headless: true },
    { identity: "quest2", slot: "e", name: "E-quest", profile: "QUEST", headless: true },
    { identity: "android1", slot: "f", name: "F-android", profile: "ANDROID", headless: true },
    { identity: "android2", slot: "g", name: "G-android", profile: "ANDROID", headless: true },
    // The IOS client's pilot is made in the page at its slot's frequency (1500 Hz for c)
    { identity: "iphone1", slot: "c", name: "C-iphone", profile: "IOS" }
  ];
  // The WebKit client first: its browser starts slowly in the container while the six windows start here
  const [iosClient] = await startClients(evidence, seats.slice(6));
  const desksAndHeadsets = await startClients(evidence, seats.slice(0, 4));
  const people = [...desksAndHeadsets, ...(await startClients(evidence, seats.slice(4, 6))), iosClient];
  const [a, b, q1, q2, p1, p2, i] = people;
  evidence.note(`room ${hub.hubId} (${hub.mediaServer}); ${MIXED_MINUTES} minutes; ${withBots ? "with" : "without"} two BOT clients (bot path, headless); the six Edge clients headless on the GPU (six visible windows with the bots did not start on this PC)`);
  await enterDevices(evidence, people, hub.hubId);
  const botEntry = await Promise.all(bots.map(x => waitBotEntered(x, 180_000).then(() => "entered").catch(e => `not entered: ${(e as Error).message.split("\n")[0]}`)));
  if (bots.length) evidence.note(`bots: ${bots.map((x, k) => `${x.name} ${botEntry[k]}`).join(", ")}`);
  const all = [...people, ...bots];
  await frameRateCheck(evidence, [a, b, q1, q2]);
  await connectedCheck(evidence, people, server, "all");

  const start = await grids(evidence, all, "start", "at the start");
  for (const c of people) await evidence.screenshot(c, "start");

  // Ten minutes of a room in use: the headsets loop H1 and gestures, the phones walk and turn with the
  // joysticks, the desktops walk and look; a few clients speak (all microphones stay on)
  const h1 = convertBotRecording().timeline;
  const memory: Record<string, MemorySample[]> = Object.fromEntries([a, b, q1, q2, p1, p2].map(c => [c.name, [] as MemorySample[]]));
  const fps: { minute: number; rates: Record<string, number> }[] = [];
  const t0 = Date.now();
  let minute = 0;
  while (Date.now() - t0 < MIXED_MINUTES * 60_000) {
    await Promise.all([startTimeline(q1.page, h1), startTimeline(q2.page, { name: "H1 later", keyframes: h1.keyframes })]).catch(() => {});
    await Promise.all([
      input.walk(a.page, minute % 2 ? "w" : "s", 1200).catch(() => {}),
      input.look(b.page, minute % 2 ? 120 : -120, 0).catch(() => {}),
      touch.pushStick(p1, "left", 0, minute % 2 ? -1 : 1, 1200).catch(() => {}),
      touch.pushStick(p2, "right", minute % 2 ? 1 : -1, 0, 700).catch(() => {}),
      touch.pushStick(i, "left", 0.6, -0.6, 900).catch(() => {})
    ]);
    if (Date.now() - t0 >= minute * 60_000) {
      const rates: Record<string, number> = {};
      for (const c of [a, b, q1, q2, p1, p2, i]) rates[c.name] = (await measureFrameRate(c.page, 1500).catch(() => ({ raf: 0 }))).raf;
      fps.push({ minute, rates });
      for (const c of [a, b, q1, q2, p1, p2]) memory[c.name].push(await readMemory(c).catch(() => null as unknown as MemorySample));
      if (minute === Math.floor(MIXED_MINUTES / 2)) for (const c of people) await evidence.screenshot(c, `minute-${minute}`);
      minute++;
    }
    await a.page.waitForTimeout(8000);
  }
  await Promise.all([q1, q2].map(q => stopTimeline(q.page).catch(() => {})));
  evidence.saveJson("frame-rates.json", fps, "each client's frame rate once a minute");
  evidence.saveJson("memory.json", memory, "memory samples once a minute");

  const end = await grids(evidence, all, "end", `after ${MIXED_MINUTES} minutes`);
  for (const c of people) await evidence.screenshot(c, "end");
  await gridCheck(evidence, start.hear, "all");
  await gridCheck(evidence, start.see, "all");
  await gridCheck(evidence, end.hear, "all");
  await gridCheck(evidence, end.see, "all");
  await evidence.check("Frame rates through the run (DESK and QUEST judged against 55; the others reported)", "2.2", async () => {
    const low = (n: string) => Math.min(...fps.map(f => f.rates[n] ?? 0));
    const judged = [a, b, q1, q2].map(c => c.name);
    return {
      ok: judged.every(n => low(n) >= 55) ? true : ("invalid" as const),
      summary: [a, b, q1, q2, p1, p2, i].map(c => `${c.name} lowest ${low(c.name)} fps`).join(", "),
      data: fps
    };
  });
  await evidence.check("No memory growth over the run", "F10", async () => {
    const rows = Object.entries(memory).map(([name, s]) => ({ name, t: trend(s.filter(Boolean).slice(1)) }));
    return {
      ok: rows.every(r => !r.t || r.t.heapMbPerMinute < 2),
      summary: rows.map(r => (r.t ? `${r.name} ${r.t.heapMbPerMinute} MB/min` : `${r.name} too few samples`)).join(", ") + " (judged: under 2 MB/min after the first minute)",
      data: rows
    };
  });
  await closingChecks(evidence, all, ALLOW);
  // The mosaic of every client's video is made after the clients close (their videos are saved then)
  for (const c of all) await c.close();
  await evidence.check("Mosaic video of every client", "all", async () => {
    const tiles = all.map(c => ({ label: `${c.name} (${c.profile})`, file: fs.existsSync(evidence.file(`${c.name}.webm`)) ? evidence.file(`${c.name}.webm`) : undefined, startedAt: c.startedAt ?? Date.now() }));
    const work = evidence.file(".mosaic");
    const made = mosaicVideo(tiles, evidence.file("mosaic.mp4"), work, { title: "T7.7 mixed room" });
    fs.rmSync(work, { recursive: true, force: true });
    evidence.addFile("mosaic.mp4", "video", "every client's video side by side on one time line (no sound)");
    return { ok: true, summary: `${made.seconds} s, ${made.cols} x ${made.rows} tiles; ${made.tiles.filter(t => !t.video).map(t => t.label).join(", ") || "every tile"} without video`, data: made };
  }, 30 * 60_000);
}

// ---------- The tests ----------

test.describe("T7 device profiles", () => {
  for (const server of SERVERS) {
    const title = blockTitle(server);
    test(`T7.1 headset: VR, talk, H1, a PDF paged in VR, out of VR and in again, on ${title}`, meta("t7.1", server, "V1 V3 F3"), async ({ evidence }) => {
      runsOn(server);
      await questAndDesk(evidence, server);
    });
    test(`T7.2 phone: mobile entry, joysticks, talk, mute, place media, rotate, on ${title}`, meta("t7.2", server, "checklist-3 B2 B3 B4"), async ({ evidence }) => {
      runsOn(server);
      await androidAndDesk(evidence, server);
    });
    test(`T7.3 iPhone in WebKit: as far as the engine goes, on ${title}`, meta("t7.3", server, "checklist-3"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      await iosAndDesk(evidence, server, "IOS");
    });
    test(`T7.3 iPad in WebKit: as far as the engine goes, on ${title}`, meta("t7.3-ipad", server, "checklist-3"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      await iosAndDesk(evidence, server, "IOS_IPAD");
    });
    test(`T7.4 headset and phone follow a media server switch and a room move, on ${title}`, meta("t7.4", server, "L1 B6"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      await switchAndMove(evidence, server);
    });
    test(`T7.5 poor network: loss and jitter, 1 Mbit/s, a 10 s blackout, on ${title}`, meta("t7.5", server, "B6 B8"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      test.setTimeout(20 * 60_000);
      await poorNetwork(evidence, server);
    });
    test(`T7.6 slow headset and slow phone (CPU 4x), on ${title}`, meta("t7.6", server, "B3 B6 F10"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      test.setTimeout(20 * 60_000);
      await slowDevices(evidence, server);
    });
    test(`T7.7 mixed room: 2 DESK, 2 QUEST, 2 ANDROID, 1 IOS, 2 BOT, on ${title}`, meta("t7.7", server, "all"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      await mixedRoom(evidence, server, true);
    });
    test(`T7.7 mixed room without the bots, on ${title}`, meta("t7.7-no-bots", server, "all"), async ({ evidence }) => {
      runsOn(server);
      notOnCloud(server);
      await mixedRoom(evidence, server, false);
    });
  }
});
