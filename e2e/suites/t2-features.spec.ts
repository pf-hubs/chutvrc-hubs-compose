// T2 transport and media, features on the data channels (plan 4): T2.11 PDF page sync, the laser pointer,
// an N-impro round in the nimpro room and the animation state it sets, and the #iot round trip with the
// device simulator; T2.12 the RTC panel. On Dialog in the Dialog block and on LiveKit in a LiveKit block.
import { test } from "./harness";
import type { Evidence } from "../report/evidence";
import { room } from "../lib/fixtures";
import { sql, sqlText } from "../lib/stack";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { launchDeviceSimulator } from "../clients/iot";
import { QUESTION_PDF_URL } from "../assets/generate";
import { readPose } from "../probes/poses";
import { messagesOf, startPacketLog, summarisePackets, takePacketLog, type PacketEntry } from "../probes/packets";
import { readConnections } from "../probes/connections";
import { capabilities } from "../probes/compat";
import { blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, connectedCheck, enterAll, exceptionsSince, frameRateCheck, idOf, logMarks, mainRoom, startClients, waitUntil } from "./common";

const SERVERS = ["dialog", "livekit"] as const;

// ---------- T2.11 ----------

const SEAT = (n: number) => `#environment-root .N-impro .N-impro-seat-${String(n).padStart(2, "0")}`;

/** Page code finding the waypoint icon nearest to seat n (while frozen the icons float 1.6 m above their waypoints) */
const FIND_SEAT_ICON = `
  const seat = document.querySelector(arg.seat);
  if (!seat) return null;
  const V = AFRAME.THREE.Vector3;
  const at = new V().setFromMatrixPosition(seat.object3D.matrixWorld);
  let best = null, bestD = Infinity;
  for (const icon of document.querySelectorAll(".occupiable-waypoint-icon")) {
    if (!icon.object3D.visible) continue;
    const d = new V().setFromMatrixPosition(icon.object3D.matrixWorld).distanceTo(at);
    if (d < bestD) { best = icon; bestD = d; }
  }
  return bestD < 2.5 ? best : null;`;

/** Where a client stands, against a seat: horizontal distance in metres */
async function distanceToSeat(c: Client, n: number): Promise<number | null> {
  const id = await idOf(c);
  const pose = await readPose(c.page, id);
  const seat = await c.page.evaluate(sel => {
    const el = document.querySelector(sel) as any;
    if (!el) return null;
    const v = new (window as any).AFRAME.THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld);
    return [v.x, v.z];
  }, SEAT(n));
  if (!pose || !seat) return null;
  return +Math.hypot(pose.rig[0] - seat[0], pose.rig[2] - seat[1]).toFixed(2);
}

/**
 * A member takes seat n as a person does: faces it, freezes the scene with Tab (the waypoint icons show
 * only while frozen), clicks the seat's icon and thaws. Returns how it went.
 */
async function takeSeat(c: Client, n: number): Promise<{ clicked: boolean; error?: string }> {
  await input.faceTowards(c.page, { selector: SEAT(n) });
  await input.holdKey(c.page, "Tab", 120);
  try {
    await c.page.waitForFunction(() => (window as any).AFRAME.scenes[0].is("frozen"), undefined, { timeout: 5000 });
    await c.page.waitForTimeout(500);
    await input.clickInWorld(c.page, FIND_SEAT_ICON, { seat: SEAT(n) }, `the icon of seat ${n}`);
    return { clicked: true };
  } catch (e) {
    return { clicked: false, error: (e as Error).message.split("\n")[0] };
  } finally {
    await c.page.waitForTimeout(800);
    if (await c.page.evaluate(() => (window as any).AFRAME.scenes[0].is("frozen"))) await input.holdKey(c.page, "Tab", 120);
  }
}

/** Every #nimpro message of a packet log, as "sent:stat|00|1" or "received:ans|01|1" */
const nimproMessages = (log: PacketEntry[]) => log.filter(e => e.l === "#nimpro").map(e => `${e.s ? "sent" : "received"}:${e.m}`);

async function nimproRound(evidence: Evidence, admin: Client, members: Client[]) {
  const all = [admin, ...members];
  // The packet log needs the data channel bus; on the adapter build the round still runs, without it
  const logged = (await capabilities(admin.page)).packetLog;
  if (logged) await Promise.all(all.map(c => startPacketLog(c.page)));
  // Seats 1, 3 and 5: neighbouring seats' icons overlap on the screen from where members stand
  const seatOf = new Map(members.map((m, i) => [m, 2 * i + 1]));

  await evidence.check("The admin starts N-impro from the menu (Features > Nimpro > Init Nimpro)", "F9", async () => {
    const initLogged = () => Promise.resolve(admin.log.some(e => /Nimpro initialized as admin/.test(e.text)));
    await input.featuresAction(admin.page, "Nimpro", "Init Nimpro", initLogged).catch(() => {});
    await admin.page.waitForTimeout(1000);
    await evidence.screenshot(admin, "nimpro-init");
    const ok = await initLogged();
    return { ok, summary: `console: ${ok ? "Nimpro initialized as admin" : "no initialisation logged"}` };
  });

  await evidence.check("Members take seats at the waypoints N-impro-seat-01, -03 and -05", "F9", async () => {
    const rows: string[] = [];
    let ok = true;
    for (const m of members) {
      const n = seatOf.get(m)!;
      const r = await takeSeat(m, n);
      // Seated means the member joined the game for that seat (NimproSystem.joinGame logs it)
      const joined = async () => m.log.some(e => e.text.includes(`Nimpro initialized as player ${String(n).padStart(2, "0")}`));
      let seated = await waitUntil(joined, 8000, 500);
      let how = r.clicked ? "clicked its icon" : `could not click its icon (${r.error})`;
      if (!seated.value) {
        // Fallback: the admin assigns the seat in the member's profile (People > member > Assign to N-impro seat)
        await input.openPerson(admin.page, m.name);
        await admin.page.getByRole("button", { name: String(n), exact: true }).click();
        await input.closeSidebar(admin.page);
        seated = await waitUntil(joined, 8000, 500);
        how += seated.value ? "; seated by the admin's assignment (People > Assign to N-impro seat)" : "; the admin's assignment did not seat it either";
      }
      await evidence.screenshot(m, `seat-${n}`);
      if (!seated.value) ok = false;
      rows.push(`${m.name} seat ${n}: ${how}; joined the game ${seated.value}; ${(await distanceToSeat(m, n)) ?? "?"} m from the seat`);
    }
    return { ok, summary: rows.join("; "), data: rows };
  });

  await admin.page.waitForTimeout(1000);
  const pagesBefore = await Promise.all(all.map(c => input.pdfPageOf(c.page, QUESTION_PDF_URL)));
  await evidence.check("The admin starts a round (New Round): the question slide pages on every client", "F9 F3", async () => {
    await input.featuresAction(admin.page, "Nimpro", "New Round", async () => admin.log.some(e => /New round started|Question slide pager not found/.test(e.text))).catch(() => {});
    const turned = await waitUntil(async () => {
      const pages = await Promise.all(all.map(c => input.pdfPageOf(c.page, QUESTION_PDF_URL)));
      return pages.every(p => p !== null && p === (pagesBefore[0] ?? 0) + 1) ? pages : null;
    }, 10_000);
    const pages = turned.value ?? (await Promise.all(all.map(c => input.pdfPageOf(c.page, QUESTION_PDF_URL))));
    return {
      ok: !!turned.value,
      summary: `slide page before ${pagesBefore.join("/")}, after ${pages.join("/")} (${all.map(c => c.name).join("/")})`,
      data: { pagesBefore, pages }
    };
  });

  const answers = members.map((_, i) => i < members.length - 1);
  await evidence.check("Members answer (Yes with the left arrow, No with the right arrow)", "F9", async () => {
    await admin.page.waitForTimeout(1500);
    for (const [i, m] of members.entries()) {
      await m.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      await m.page.keyboard.press(answers[i] ? "ArrowLeft" : "ArrowRight");
      await m.page.waitForTimeout(300);
    }
    await admin.page.waitForTimeout(1500);
    const sentAnswers = members.map(m => m.log.filter(e => /^Send answer: /.test(e.text)).map(e => e.text));
    const ok = sentAnswers.every(s => s.length > 0);
    return { ok, summary: members.map((m, i) => `${m.name}: ${sentAnswers[i].join(", ") || "no answer sent"}`).join("; "), data: sentAnswers };
  });

  await evidence.check("The admin shows the result (Result): points go out", "F9", async () => {
    await input.featuresAction(admin.page, "Nimpro", "Result", async () => admin.log.some(e => /Point in this round|Even number of participants/.test(e.text))).catch(() => {});
    await admin.page.waitForTimeout(2500);
    await evidence.screenshot(admin, "nimpro-result");
    const got = members.map(m => m.log.filter(e => /got \d+ points in this round/.test(e.text)).map(e => e.text));
    return { ok: got.every(g => g.length > 0), summary: members.map((m, i) => `${m.name}: ${got[i].join(", ") || "no points received"}`).join("; "), data: got };
  });

  await evidence.check("Seated members carry the animation state N-impro sets (2), as the admin sees them", "F9 B8", async () => {
    const ids = await Promise.all(members.map(idOf));
    const states = await admin.page.evaluate(ids => ids.map(id => (window as any).__e2eApi.pose(id)?.animState ?? null), ids);
    return { ok: states.every(s => s === 2), summary: members.map((m, i) => `${m.name} animState ${states[i]}`).join(", "), data: states };
  });

  // The question slide paged by hand with its hover menu
  await evidence.check("The admin pages the question slide with its hover menu: every client follows", "F3", async () => {
    await input.faceTowards(admin.page, { mediaSrc: QUESTION_PDF_URL });
    const before = await input.pdfPageOf(admin.page, QUESTION_PDF_URL);
    await input.pagePdf(admin.page, QUESTION_PDF_URL, "next");
    const followed = await waitUntil(async () => {
      const pages = await Promise.all(all.map(c => input.pdfPageOf(c.page, QUESTION_PDF_URL)));
      return pages.every(p => p === (before ?? 0) + 1) ? pages : null;
    }, 10_000);
    await evidence.screenshot(admin, "slide-paged");
    const pages = followed.value ?? (await Promise.all(all.map(c => input.pdfPageOf(c.page, QUESTION_PDF_URL))));
    return { ok: !!followed.value, summary: `page ${before} -> ${pages.join("/")} (${all.map(c => c.name).join("/")})`, data: pages };
  });

  if (!logged) {
    evidence.notApplicable("Every #nimpro message arrives (packet logs)", "F9", "the packet log needs the data channel bus (APP.sfu.bus)");
    await input.featuresAction(admin.page, "Nimpro", "Quit Nimpro").catch(() => {});
    await admin.page.keyboard.press("Escape").catch(() => {});
    return;
  }
  const logs = await Promise.all(all.map(c => takePacketLog(c.page)));
  all.forEach((c, i) => evidence.saveJson(`packets-nimpro-${c.name}.json`, { summary: summarisePackets(logs[i]), nimpro: nimproMessages(logs[i]) }, `${c.name}'s packet log during the N-impro round`));

  await evidence.check("Every #nimpro message arrives (packet logs)", "F9", async () => {
    const adminSent = nimproMessages(logs[0]).filter(m => m.startsWith("sent:")).map(m => m.slice(5));
    const rows: string[] = [];
    let ok = adminSent.length > 0;
    for (const [i, m] of members.entries()) {
      const received = new Set(nimproMessages(logs[i + 1]).filter(x => x.startsWith("received:")).map(x => x.slice(9)));
      const missing = adminSent.filter(x => !received.has(x));
      const sent = nimproMessages(logs[i + 1]).filter(x => x.startsWith("sent:")).map(x => x.slice(5));
      const adminGot = new Set(nimproMessages(logs[0]).filter(x => x.startsWith("received:")).map(x => x.slice(9)));
      const notAtAdmin = sent.filter(x => !adminGot.has(x));
      if (missing.length || notAtAdmin.length || !sent.length) ok = false;
      rows.push(`${m.name} received ${adminSent.length - missing.length}/${adminSent.length} of the admin's${missing.length ? ` (missing ${missing.join(", ")})` : ""}; sent ${sent.join(", ") || "nothing"}${notAtAdmin.length ? ` (not at the admin: ${notAtAdmin.join(", ")})` : ""}`);
    }
    return { ok, summary: `admin sent ${adminSent.join(", ")}; ${rows.join("; ")}`, data: { adminSent, rows } };
  });

  await input.featuresAction(admin.page, "Nimpro", "Quit Nimpro").catch(() => {});
  await admin.page.keyboard.press("Escape").catch(() => {});
}

/** Each feature label sent by A as a probe through APP.sfu.broadcast: does every other client's packet log show it? */
async function channelProbes(evidence: Evidence, a: Client, others: Client[]) {
  return evidence.check("Every feature channel carries a probe message from A to the others (#nimpro, #iot, #pdfPage, #laserPointer, #emoji)", "F3 F9", async () => {
    await Promise.all(others.map(c => startPacketLog(c.page)));
    await startPacketLog(a.page);
    const page = await input.pdfPageOf(a.page, QUESTION_PDF_URL);
    // Harmless contents: an unknown N-impro type, an #iot envelope no bridge reads, the slide's own page,
    // a hidden laser pointer, an emoji name
    const probes: Record<string, string> = {
      "#nimpro": "e2e|00|probe",
      "#iot": JSON.stringify({ v: 1, l: "e2e-probe", s: null, t: null, p: "probe", pt: "j" }),
      "#pdfPage": String(page ?? 0),
      "#laserPointer": "0|0|0|0",
      "#emoji": "e2e-probe"
    };
    await a.page.evaluate(probes => {
      for (const [label, message] of Object.entries(probes)) (window as any).APP.sfu.broadcast(label, message);
    }, probes);
    await a.page.waitForTimeout(2000);
    const sent = await takePacketLog(a.page);
    const logs = await Promise.all(others.map(c => takePacketLog(c.page)));
    const rows = Object.entries(probes).map(([label, message]) => {
      const wasSent = messagesOf(sent, label, "sent").some(e => e.m === message.slice(0, 120));
      const got = others.map((c, i) => messagesOf(logs[i], label, "received").some(e => e.m === message.slice(0, 120)));
      return { label, wasSent, got: Object.fromEntries(others.map((c, i) => [c.name, got[i]])) };
    });
    // #emoji is known not to arrive (plan T2.11): recorded, not judged
    const judged = rows.filter(r => r.label !== "#emoji");
    return {
      ok: judged.every(r => r.wasSent && Object.values(r.got).every(Boolean)),
      summary: rows
        .map(r => `${r.label}${r.label === "#emoji" ? " (not judged)" : ""}: sent ${r.wasSent}, received by ${Object.entries(r.got).filter(([, v]) => v).map(([k]) => k).join(", ") || "nobody"}`)
        .join("; "),
      data: rows
    };
  });
}

/**
 * Messages received on the #laserPointer data channel, from the connections probe: Dialog opens one channel
 * per label, so this counts laser pointer messages on a build without the packet log; null when no client
 * connection has such a channel (LiveKit carries every label on two channels)
 */
async function laserChannelMessages(c: Client): Promise<number | null> {
  const channels = (await readConnections(c.page)).connections.flatMap(x => x.dataChannels).filter(d => d.label === "#laserPointer");
  return channels.length ? channels.reduce((n, d) => n + d.messagesReceived, 0) : null;
}

async function laserPointer(evidence: Evidence, a: Client, others: Client[]) {
  return evidence.check("Laser pointer: A speaks publicly (Broadcast > Start Speaking) and points at the scene; the others receive its position", "F3", async () => {
    // With the packet log the messages with a position are counted; without it (adapter build) the
    // messages on Dialog's #laserPointer channel, which on that build carries positions only
    const logged = (await capabilities(a.page)).packetLog;
    const channelBefore = logged ? [] : await Promise.all(others.map(laserChannelMessages));
    if (logged) await Promise.all(others.map(c => startPacketLog(c.page)));
    const marks = logMarks([a]);
    await input.featuresAction(a.page, "Broadcast", "Start Speaking");
    await a.page.keyboard.press("Escape").catch(() => {});
    await a.page.waitForTimeout(3000);
    const speaking = await a.page.evaluate(() => !!(window as any).APP.publicSpeakingSfu);
    // Point around the middle of the view for 4 s
    const { width, height } = a.page.viewportSize() ?? { width: 1280, height: 720 };
    for (let i = 0; i < 40; i++) {
      await a.page.mouse.move(width / 2 + 200 * Math.sin(i / 5), height / 2 + 80 * Math.cos(i / 5));
      await a.page.waitForTimeout(100);
    }
    await evidence.screenshot(a, "pointing");
    const logs = logged ? await Promise.all(others.map(c => takePacketLog(c.page))) : [];
    const channelAfter = logged ? [] : await Promise.all(others.map(laserChannelMessages));
    await input.featuresAction(a.page, "Broadcast", "Stop Speaking").catch(() => {});
    await a.page.keyboard.press("Escape").catch(() => {});
    if (!logged && channelAfter.every(n => n === null)) {
      return {
        ok: "not applicable" as const,
        summary: `A speaking publicly: ${speaking}; no packet log on this build and no #laserPointer data channel to count (LiveKit carries every label on two channels)`,
        data: { speaking }
      };
    }
    const positions = logged
      ? logs.map(l => messagesOf(l, "#laserPointer", "received", /^1\|/).length)
      : channelAfter.map((n, i) => (n ?? 0) - (channelBefore[i] ?? 0));
    const any = logged ? logs.map(l => messagesOf(l, "#laserPointer", "received").length) : positions;
    return {
      ok: speaking && positions.every(n => n > 0),
      summary:
        `A speaking publicly: ${speaking}; #laserPointer messages with a position received${logged ? "" : " (messages on the #laserPointer data channel, connections probe)"}: ${others.map((c, i) => `${c.name} ${positions[i]} (of ${any[i]})`).join(", ")}; exceptions on A ${exceptionsSince([a], marks).length}` +
        (positions.every(n => n === 0)
          ? ". The cursor controller sends the position only when this.isHoverTargetMainScreen is truthy, a property nothing sets (src/components/cursor-controller.js:142 reads it; line 213 sets isHoveringMainScreen), so no position is ever sent; the same on develop"
          : ""),
      data: { speaking, positions, any }
    };
  });
}

async function iotRoundTrip(evidence: Evidence, clients: Client[], hubId: string) {
  const device = await launchDeviceSimulator(evidence);
  await Promise.all(
    clients.map(c =>
      c.page.evaluate(() => {
        const w = window as any;
        w.__e2eIot = [];
        w.APP.bridgeManager?.on("device_message", (label: string, deviceId: string, payload: unknown) =>
          w.__e2eIot.push({ label, deviceId, payload: typeof payload === "string" ? payload : "(binary)" })
        );
        return !!w.APP.bridgeManager;
      })
    )
  );
  const logged = (await capabilities(clients[0].page)).packetLog;
  if (logged) await Promise.all(clients.map(c => startPacketLog(c.page)));
  const opened = await device.connect(hubId, "e2e-device");
  await device.client.page.waitForTimeout(1500);
  await evidence.screenshot(device.client, "device-connected");

  await evidence.check("The device simulator connects to the room (WebRTC data channel to one client)", "F9", async () => {
    const lines = await device.log();
    return { ok: opened, summary: `data channel ${opened ? "opened" : "did not open within 30 s"}; last log lines: ${lines.slice(-4).join(" | ")}`, data: lines };
  });

  await evidence.check("Device to room: the device's message reaches the other clients over #iot", "F9", async () => {
    await device.send("e2e-sensor", { temperature: 21.5, from: "device" });
    await clients[0].page.waitForTimeout(3000);
    const got = await Promise.all(clients.map(c => c.page.evaluate(() => (window as any).__e2eIot as { label: string; payload: string }[])));
    const bridges = clients.filter((_, i) => !got[i].some(m => m.label === "e2e-sensor"));
    const receivers = clients.filter((_, i) => got[i].some(m => m.label === "e2e-sensor"));
    // The client the device is connected to forwards it and does not receive its own forward
    return {
      ok: receivers.length === clients.length - 1,
      summary: `received by ${receivers.map(c => c.name).join(", ") || "nobody"}; not by ${bridges.map(c => c.name).join(", ")} (the bridging client forwards it)`,
      data: got
    };
  });

  await evidence.check("Room to device: a client's message reaches the device over #iot and the bridging client", "F9", async () => {
    const got = await Promise.all(clients.map(c => c.page.evaluate(() => (window as any).__e2eIot.length as number)));
    // A sender that is not the bridging client (it received the device's message)
    const sender = clients.find((_, i) => got[i] > 0) ?? clients[1];
    const sent = await sender.page.evaluate(() => {
      const bm = (window as any).APP.bridgeManager;
      bm.subscribe("e2e-sensor");
      return bm.sendToDevice("e2e-sensor", null, JSON.stringify({ led: "on", from: "room" }));
    });
    const arrived = await waitUntil(async () => (await device.log()).some(l => /Received: .*from.*room/.test(l)), 10_000);
    const lines = await device.log();
    return {
      ok: sent && !!arrived.value,
      summary: `${sender.name} sent (bridge accepted it: ${sent}); the device ${arrived.value ? "showed it" : "did not show it within 10 s"}: ${lines.filter(l => /Received/.test(l)).slice(-2).join(" | ")}`,
      data: lines
    };
  });
  if (logged) {
    const logs = await Promise.all(clients.map(c => takePacketLog(c.page)));
    clients.forEach((c, i) => evidence.saveJson(`packets-iot-${c.name}.json`, summarisePackets(logs[i]), `${c.name}'s packet log during the #iot round trip`));
  }
  await device.client.close();
}

for (const server of SERVERS) {
  test(
    `T2.11 PDF, laser pointer, N-impro and #iot on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.11-${blockId(server)}` }, { type: "covers", description: "F3 F9" }] },
    async ({ evidence }) => {
      runsOn(server);
      test.setTimeout(25 * 60_000);
      await evidence.recordWithObs();
      const hub = room("nimpro");
      // The nimpro room is on Dialog; on LiveKit it is moved for this test and put back
      sql(`update ret0.hubs set sfu = ${server === "dialog" ? 0 : 2} where hub_sid = ${sqlText(hub.hubId)}`);
      try {
        const clients = await startClients(evidence, [
          { identity: "admin", account: "admin", slot: "a" },
          { identity: "member1", account: "member1", slot: "b" },
          { identity: "member2", account: "member2", slot: "c" },
          { identity: "guest", slot: "d", name: "D-guest" }
        ]);
        evidence.note(`room nimpro ${hub.hubId} (scene with the N-impro set), media server ${server}; D is not signed in`);
        await enterAll(evidence, clients, hub.hubId);
        const [a, ...members] = clients;
        await frameRateCheck(evidence, clients);
        await connectedCheck(evidence, clients, server, "F9");
        await nimproRound(evidence, a, members);
        await channelProbes(evidence, a, members);
        await iotRoundTrip(evidence, clients, hub.hubId);
        await laserPointer(evidence, a, members);
        await closingChecks(evidence, clients);
      } finally {
        sql(`update ret0.hubs set sfu = 0 where hub_sid = ${sqlText(hub.hubId)}`);
      }
    }
  );
}

// ---------- T2.12 ----------

for (const server of SERVERS) {
  test(
    `T2.12 RTC panel on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.12-${blockId(server)}` }, { type: "covers", description: "F5 A1i" }] },
    async ({ evidence }) => {
      runsOn(server);
      const [a] = await startClients(evidence, [{ identity: "admin", account: "admin", slot: "a" }]);
      await enterAll(evidence, [a], room(mainRoom(server)).hubId);
      await connectedCheck(evidence, [a], server, "F5");
      const marks = logMarks([a]);
      try {
        await evidence.check(`More > Preferences > Misc > "Show RTC Panel" on: ${server === "dialog" ? "statistics" : "the explanation, no exception"}`, "F5 A1i", async () => {
          const on = await input.setPreference(a.page, "Misc", "Show RTC Panel", true);
          await a.page.waitForTimeout(7000);
          const panel = await a.page.evaluate(() => {
            const root = document.querySelector('[class*="rtc-debug-panel-root"]');
            const text = root?.textContent ?? "";
            return {
              shown: !!root,
              text: text.slice(0, 2000),
              notDialog: /The room is not using Dialog/.test(text),
              hasDevice: /Device/.test(text),
              hasNumbers: /\d{3,}/.test(text)
            };
          });
          await evidence.screenshot(a, "rtc-panel");
          const exceptions = exceptionsSince([a], marks);
          const ok =
            on &&
            panel.shown &&
            exceptions.length === 0 &&
            (server === "dialog" ? panel.hasDevice && panel.hasNumbers && !panel.notDialog : panel.notDialog);
          return {
            ok,
            summary:
              `preference on: ${on}; panel shown: ${panel.shown}; ` +
              (server === "dialog" ? `Device section ${panel.hasDevice}, figures shown ${panel.hasNumbers}` : `explanation shown: ${panel.notDialog}`) +
              `; exceptions ${exceptions.length}${exceptions.length ? ` (${exceptions[0]})` : ""}`,
            data: { panel, exceptions }
          };
        });
      } finally {
        // The preference is kept in the profile; later tests run with the panel off
        await input.setPreference(a.page, "Misc", "Show RTC Panel", false).catch(e => evidence.note(`could not turn the RTC panel off again: ${(e as Error).message.split("\n")[0]}`));
      }
      await closingChecks(evidence, [a]);
    }
  );
}
