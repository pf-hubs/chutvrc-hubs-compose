// Packet log probe (plan 3.2): the data channel bus's own recording (APP.sfu.bus.startRecording() /
// takeRecording()): the label, direction and time of every message the client sent or received. It is
// the only per-label count on LiveKit, which carries every label on two data channels.
//
// The bus is the one the toolbar's Recording button uses. The probe refuses to start while that
// recording runs, so it never takes a user's recording away.
//
// The bus came with the transport refactor; on the adapter build (develop) the probe throws NotApplicable
// (probes/compat.ts), and a check that needs it is recorded as not applicable on that build.
import type { Page } from "@playwright/test";
import { NotApplicable } from "./compat";

export type PacketEntry = {
  /** Label */
  l: string;
  /** 1 sent, 0 received */
  s: 0 | 1;
  /** Date.now() of the entry */
  t: number;
  /** For #avatar-pose: the sender's client id and sequence number; for text labels: the message (first 120 characters) */
  c?: string;
  seq?: number;
  m?: string;
};

/**
 * Clears the bus's recording and starts it; throws when the Recording button's recording is running, and
 * NotApplicable on a build without the bus
 */
export async function startPacketLog(page: Page) {
  const problem = await page.evaluate(() => {
    const sfu = (window as any).APP?.sfu;
    if (sfu && !("bus" in sfu)) return "not applicable";
    const bus = sfu?.bus;
    if (!bus) return "no data channel bus (not connected to a media server)";
    if (bus.isRecording) return "the bus is already recording (the Recording button is on)";
    bus.takeRecording();
    bus.startRecording();
    return null;
  });
  if (problem === "not applicable") throw new NotApplicable("packet log: this build has no data channel bus (APP.sfu.bus)");
  if (problem) throw new Error(`packet log not started: ${problem}`);
}

/** Stops the bus's recording and returns its entries, made compact */
export function takePacketLog(page: Page, stop = true): Promise<PacketEntry[]> {
  return page.evaluate(stop => {
    const bus = (window as any).APP?.sfu?.bus;
    if (!bus) return [];
    if (stop) bus.stopRecording();
    return bus.takeRecording().map((e: any) => {
      const entry: any = { l: e.l, s: e.s, t: e.t };
      if (e.m && typeof e.m === "object") {
        entry.c = e.m.c;
        if (typeof e.m.seq === "number") entry.seq = e.m.seq;
      } else if (typeof e.m === "string") {
        entry.m = e.m.slice(0, 120);
      }
      return entry;
    });
  }, stop);
}

/** Records the packet log for `ms` (or while `during` runs) and returns the entries */
export async function recordPackets(page: Page, during: number | (() => Promise<unknown>)): Promise<PacketEntry[]> {
  await startPacketLog(page);
  try {
    if (typeof during === "number") await page.waitForTimeout(during);
    else await during();
  } catch (e) {
    // Leave the bus stopped and empty before passing the failure on
    await takePacketLog(page).catch(() => {});
    throw e;
  }
  return takePacketLog(page);
}

export type LabelSummary = {
  sent: number;
  received: number;
  sentPerSecond: number;
  receivedPerSecond: number;
  /** Received entries per sender (pose packets carry the sender's id) */
  receivedBySender?: Record<string, number>;
};

export type PacketSummary = { seconds: number; byLabel: Record<string, LabelSummary> };

/** Counts per label and direction, and rates over the time the log covers (or `seconds`) */
export function summarisePackets(entries: PacketEntry[], seconds?: number): PacketSummary {
  const times = entries.map(e => e.t);
  const span = seconds ?? (times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : 0);
  const byLabel: Record<string, LabelSummary> = {};
  for (const e of entries) {
    const s = (byLabel[e.l] ??= { sent: 0, received: 0, sentPerSecond: 0, receivedPerSecond: 0 });
    if (e.s === 1) s.sent++;
    else {
      s.received++;
      if (e.c) {
        s.receivedBySender ??= {};
        s.receivedBySender[e.c] = (s.receivedBySender[e.c] ?? 0) + 1;
      }
    }
  }
  for (const s of Object.values(byLabel)) {
    s.sentPerSecond = span > 0 ? +(s.sent / span).toFixed(1) : 0;
    s.receivedPerSecond = span > 0 ? +(s.received / span).toFixed(1) : 0;
  }
  return { seconds: +span.toFixed(1), byLabel };
}

/** Entries of one label and direction whose message matches */
export function messagesOf(entries: PacketEntry[], label: string, direction: "sent" | "received", match?: RegExp): PacketEntry[] {
  return entries.filter(e => e.l === label && e.s === (direction === "sent" ? 1 : 0) && (!match || match.test(e.m ?? "")));
}
