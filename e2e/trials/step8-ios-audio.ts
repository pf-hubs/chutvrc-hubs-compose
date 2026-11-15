// Step 8 trial: why the IOS client's pilot is not heard, and why it hears nobody. Reads the audio contexts,
// the outgoing track's audio level on the IOS client (WebRTC stats) and the incoming level at a DESK client.
//   npx tsx trials/step8-ios-audio.ts
import fs from "node:fs";
import path from "node:path";
import { EVIDENCE_DIR } from "../lib/env";
import { room } from "../lib/fixtures";
import { launchClient } from "../clients/launch";
import { ensureSignedIn } from "../clients/signin";
import { enterRoom } from "../clients/enter";
import { readSession } from "../probes/session";
import { heardPilot } from "../probes/audio";
import { CONTROL_HZ } from "../assets/media";

const out = path.join(EVIDENCE_DIR, "trials", "step8");
fs.mkdirSync(out, { recursive: true });
const hub = room("dialog-main");
const desk = await launchClient({ profile: "DESK", identity: "member1", slot: "a", name: "A-desk", position: [0, 0] });
await ensureSignedIn(desk, "member1");
const ios = await launchClient({ profile: (process.argv[2] as "IOS" | "IOS_IPAD") ?? "IOS", identity: "ios1", slot: "c", name: "C-ios" });
const result: Record<string, unknown> = {};
const levels = (page: typeof desk.page) =>
  page.evaluate(async () => {
    const pcs: RTCPeerConnection[] = ((window as any).__e2eConnections ?? []).map((e: any) => e.pc);
    const rows: string[] = [];
    for (const pc of pcs) {
      if (pc.connectionState === "closed") continue;
      const stats = await pc.getStats();
      stats.forEach((s: any) => {
        if (s.type === "media-source" && s.kind === "audio") rows.push(`media-source level ${s.audioLevel} energy ${s.totalAudioEnergy}`);
        if (s.type === "outbound-rtp" && s.kind === "audio") rows.push(`outbound bytes ${s.bytesSent} packets ${s.packetsSent}`);
        if (s.type === "inbound-rtp" && s.kind === "audio") rows.push(`inbound bytes ${s.bytesReceived} level ${s.audioLevel} energy ${s.totalAudioEnergy}`);
      });
    }
    const ctx = (window as any).AFRAME?.THREE?.AudioContext?.getContext?.();
    return { rows, threeContext: ctx?.state ?? null, pilot: (window as any).__e2ePilotContext?.() ?? null, connections: pcs.length };
  });
try {
  await Promise.all([enterRoom(desk, hub.hubId, { displayName: "A-desk" }), enterRoom(ios, hub.hubId, { displayName: "C-ios", timeout: 300_000 })]);
  await desk.page.waitForTimeout(3000);
  const [idd, idi] = [(await readSession(desk.page)).clientId, (await readSession(ios.page)).clientId];

  result.iosLevels1 = await levels(ios.page);
  result.deskLevels1 = await levels(desk.page);
  result.iosTrack = await ios.page.evaluate(() => {
    const t = (window as any).APP.sfu.getLocalMicTrack?.();
    return t ? { id: t.id, label: t.label, readyState: t.readyState, enabled: t.enabled, muted: t.muted } : null;
  });
  // A tap on the page, as a person's first touch would: resumes contexts waiting for a gesture
  await ios.page.touchscreen.tap(200, 300);
  await ios.page.waitForTimeout(1500);
  result.iosLevels2 = await levels(ios.page);
  result.deskHearsIos = await heardPilot(desk.page, idi, ios.pilotHz, CONTROL_HZ, 4000);
  result.iosHearsDesk = await heardPilot(ios.page, idd, desk.pilotHz, CONTROL_HZ, 4000);
  result.iosInbound = await ios.page.evaluate(async idd => {
    const pcs: RTCPeerConnection[] = ((window as any).__e2eConnections ?? []).map((e: any) => e.pc);
    const stream: MediaStream = await (window as any).APP.sfu.getMediaStream(idd, "audio");
    const ids = stream.getAudioTracks().map(t => t.id);
    const rows: any[] = [];
    for (const pc of pcs) {
      if (pc.connectionState === "closed") continue;
      (await pc.getStats()).forEach((s: any) => { if (s.type === "inbound-rtp" && s.kind === "audio") rows.push(s); });
      for (const r of pc.getReceivers()) rows.push({ receiverTrack: r.track?.id, kind: r.track?.kind });
    }
    return { ids, rows };
  }, idd);
  result.iosProbeContext = await ios.page.evaluate(async () => {
    const c = new AudioContext();
    await Promise.race([c.resume(), new Promise(r => setTimeout(r, 1000))]);
    const s = c.state;
    await c.close();
    return s;
  });
  result.deskLevels2 = await levels(desk.page);
} catch (e) {
  result.error = String(e).split("\n")[0];
} finally {
  result.iosErrors = ios.log.filter(e => ["error", "pageerror", "warning"].includes(e.type)).slice(0, 30).map(e => `${e.type}: ${e.text.slice(0, 200)}`);
  fs.writeFileSync(path.join(out, "ios-audio.json"), JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  await ios.close();
  await desk.close();
}
