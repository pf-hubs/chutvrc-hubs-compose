// Connections probe (plan 3.2): every RTCPeerConnection a page makes, wrapped by an init script so it can
// be read from outside: how many are alive, and their getStats() — the selected candidate pair, the data
// channels per label (Dialog opens one per label; LiveKit carries every label on "_reliable" and "_lossy"),
// inbound and outbound RTP, and bitrates between two readings.
import type { Page } from "@playwright/test";

/**
 * Init script: wraps RTCPeerConnection so each instance is listed in window.__e2eConnections with the
 * time it was made and closed. The page's own code is unchanged (it gets the native object).
 */
export const CONNECTION_WATCH = `(() => {
  const Native = window.RTCPeerConnection;
  if (!Native || Native.__e2eWrapped) return;
  const list = (window.__e2eConnections = []);
  let next = 1;
  function RTCPeerConnection(...args) {
    const pc = new Native(...args);
    const entry = { id: next++, pc, createdAt: performance.now(), closedAt: null, policy: (args[0] && args[0].iceTransportPolicy) || "all" };
    list.push(entry);
    const close = pc.close.bind(pc);
    pc.close = () => {
      if (entry.closedAt === null) entry.closedAt = performance.now();
      return close();
    };
    pc.addEventListener("connectionstatechange", () => {
      if ((pc.connectionState === "closed" || pc.connectionState === "failed") && entry.closedAt === null) entry.closedAt = performance.now();
    });
    return pc;
  }
  RTCPeerConnection.prototype = Native.prototype;
  Object.setPrototypeOf(RTCPeerConnection, Native);
  RTCPeerConnection.__e2eWrapped = true;
  window.RTCPeerConnection = RTCPeerConnection;
})();`;

export type Candidate = { type: string; protocol: string; relayProtocol?: string; address?: string; port?: number };

export type ConnectionStats = {
  id: number;
  /** Seconds since the page loaded */
  createdAtS: number;
  closedAtS: number | null;
  connectionState: string;
  policy: string;
  /** performance.now() of the stats, ms */
  at: number;
  selectedPair?: { local: Candidate; remote: Candidate; rttMs: number | null; bytesSent: number; bytesReceived: number; availableOutgoingKbps: number | null };
  dataChannels: { label: string; state: string; messagesSent: number; messagesReceived: number; bytesSent: number; bytesReceived: number }[];
  inbound: { kind: string; ssrc: number; packetsReceived: number; packetsLost: number; bytesReceived: number; framesDecoded?: number; trackIdentifier?: string }[];
  outbound: { kind: string; ssrc: number; packetsSent: number; bytesSent: number; framesEncoded?: number }[];
};

export type ConnectionsReading = {
  /** Connections made since the page loaded */
  created: number;
  /** Connections not closed */
  live: number;
  connections: ConnectionStats[];
};

/** Every connection of the page with its statistics (closed ones without statistics) */
export function readConnections(page: Page, withStats = true): Promise<ConnectionsReading> {
  return page.evaluate(async withStats => {
    const list: any[] = (window as any).__e2eConnections ?? [];
    const connections: any[] = [];
    for (const e of list) {
      const pc: RTCPeerConnection = e.pc;
      const closed = e.closedAt !== null || pc.connectionState === "closed";
      const out: any = {
        id: e.id,
        createdAtS: +(e.createdAt / 1000).toFixed(1),
        closedAtS: e.closedAt === null ? (pc.connectionState === "closed" ? -1 : null) : +(e.closedAt / 1000).toFixed(1),
        connectionState: pc.connectionState,
        policy: e.policy,
        at: performance.now(),
        dataChannels: [],
        inbound: [],
        outbound: []
      };
      if (!closed && withStats) {
        const stats = await pc.getStats().catch(() => null);
        if (stats) {
          const byId = new Map<string, any>();
          stats.forEach((s: any) => byId.set(s.id, s));
          let pairId: string | undefined;
          stats.forEach((s: any) => {
            if (s.type === "transport" && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
          });
          if (!pairId) stats.forEach((s: any) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded" && (pairId = s.id));
          const pair = pairId ? byId.get(pairId) : undefined;
          const cand = (c: any) =>
            c ? { type: c.candidateType, protocol: c.protocol, relayProtocol: c.relayProtocol, address: c.address, port: c.port } : { type: "?", protocol: "?" };
          if (pair) {
            out.selectedPair = {
              local: cand(byId.get(pair.localCandidateId)),
              remote: cand(byId.get(pair.remoteCandidateId)),
              rttMs: pair.currentRoundTripTime === undefined ? null : Math.round(pair.currentRoundTripTime * 1000),
              bytesSent: pair.bytesSent ?? 0,
              bytesReceived: pair.bytesReceived ?? 0,
              availableOutgoingKbps: pair.availableOutgoingBitrate ? Math.round(pair.availableOutgoingBitrate / 1000) : null
            };
          }
          stats.forEach((s: any) => {
            if (s.type === "data-channel") {
              out.dataChannels.push({
                label: s.label,
                state: s.state,
                messagesSent: s.messagesSent ?? 0,
                messagesReceived: s.messagesReceived ?? 0,
                bytesSent: s.bytesSent ?? 0,
                bytesReceived: s.bytesReceived ?? 0
              });
            } else if (s.type === "inbound-rtp") {
              out.inbound.push({
                kind: s.kind,
                ssrc: s.ssrc,
                packetsReceived: s.packetsReceived ?? 0,
                packetsLost: s.packetsLost ?? 0,
                bytesReceived: s.bytesReceived ?? 0,
                framesDecoded: s.framesDecoded,
                trackIdentifier: s.trackIdentifier
              });
            } else if (s.type === "outbound-rtp") {
              out.outbound.push({ kind: s.kind, ssrc: s.ssrc, packetsSent: s.packetsSent ?? 0, bytesSent: s.bytesSent ?? 0, framesEncoded: s.framesEncoded });
            }
          });
        }
      }
      connections.push(out);
    }
    return { created: list.length, live: connections.filter(c => c.closedAtS === null && c.connectionState !== "closed").length, connections };
  }, withStats);
}

/** The number of connections not closed */
export async function liveConnections(page: Page): Promise<number> {
  return (await readConnections(page, false)).live;
}

export type Rates = {
  seconds: number;
  /** Per connection id: kbit/s on the selected pair */
  pairs: Record<number, { sendKbps: number; receiveKbps: number }>;
  /** Summed over the connections: inbound kbit/s and packets/s per media kind, outbound kbit/s per kind */
  inbound: Record<string, { kbps: number; packetsPerSecond: number }>;
  outbound: Record<string, { kbps: number }>;
  /** Per data channel label: messages per second each way (summed over connections) */
  dataChannels: Record<string, { sentPerSecond: number; receivedPerSecond: number }>;
};

/** Bitrates and message rates between two readings of the same page */
export function rates(before: ConnectionsReading, after: ConnectionsReading): Rates {
  const result: Rates = { seconds: 0, pairs: {}, inbound: {}, outbound: {}, dataChannels: {} };
  let seconds = 0;
  for (const b of after.connections) {
    const a = before.connections.find(c => c.id === b.id);
    if (!a || b.closedAtS !== null) continue;
    const dt = (b.at - a.at) / 1000;
    if (dt <= 0) continue;
    seconds = Math.max(seconds, dt);
    if (a.selectedPair && b.selectedPair) {
      result.pairs[b.id] = {
        sendKbps: Math.round(((b.selectedPair.bytesSent - a.selectedPair.bytesSent) * 8) / dt / 1000),
        receiveKbps: Math.round(((b.selectedPair.bytesReceived - a.selectedPair.bytesReceived) * 8) / dt / 1000)
      };
    }
    for (const s of b.inbound) {
      const p = a.inbound.find(x => x.ssrc === s.ssrc);
      if (!p) continue;
      const r = (result.inbound[s.kind] ??= { kbps: 0, packetsPerSecond: 0 });
      r.kbps += Math.round(((s.bytesReceived - p.bytesReceived) * 8) / dt / 1000);
      r.packetsPerSecond += Math.round((s.packetsReceived - p.packetsReceived) / dt);
    }
    for (const s of b.outbound) {
      const p = a.outbound.find(x => x.ssrc === s.ssrc);
      if (!p) continue;
      const r = (result.outbound[s.kind] ??= { kbps: 0 });
      r.kbps += Math.round(((s.bytesSent - p.bytesSent) * 8) / dt / 1000);
    }
    for (const d of b.dataChannels) {
      const p = a.dataChannels.find(x => x.label === d.label);
      if (!p) continue;
      const r = (result.dataChannels[d.label] ??= { sentPerSecond: 0, receivedPerSecond: 0 });
      r.sentPerSecond += +((d.messagesSent - p.messagesSent) / dt).toFixed(1);
      r.receivedPerSecond += +((d.messagesReceived - p.messagesReceived) / dt).toFixed(1);
    }
  }
  result.seconds = +seconds.toFixed(1);
  return result;
}

/** Readings `ms` apart and the rates between them */
export async function measureRates(page: Page, ms = 3000): Promise<{ before: ConnectionsReading; after: ConnectionsReading; rates: Rates }> {
  const before = await readConnections(page);
  await page.waitForTimeout(ms);
  const after = await readConnections(page);
  return { before, after, rates: rates(before, after) };
}

/** The selected candidate pairs of the live connections, in short: "udp host -> udp host" */
export function describePairs(reading: ConnectionsReading): string[] {
  return reading.connections
    .filter(c => c.selectedPair)
    .map(c => {
      const p = c.selectedPair!;
      const side = (x: Candidate) => `${x.protocol}${x.relayProtocol ? `/${x.relayProtocol}` : ""} ${x.type}`;
      return `#${c.id} ${side(p.local)} -> ${side(p.remote)}${p.rttMs !== null ? ` (${p.rttMs} ms)` : ""}`;
    });
}

/**
 * Audio packets received from one sender: the inbound-rtp entries whose track is one of the tracks the page
 * keeps for that client. Counting by track keeps out the client's own loopback connections (Hubs routes its
 * audio output through a local pair of connections for Chrome's echo cancellation), whose inbound audio
 * would otherwise look like a stream that never stops.
 */
export async function packetsFrom(page: Page, senderId: string): Promise<{ packets: number; at: number; tracks: number }> {
  return page.evaluate(async senderId => {
    const tracks: MediaStreamTrack[] = (window as any).__e2eApi.remoteTracks(senderId);
    const ids = new Set(tracks.filter(t => t.kind === "audio").map(t => t.id));
    let packets = 0;
    for (const e of ((window as any).__e2eConnections ?? []) as any[]) {
      if (e.closedAt !== null || e.pc.connectionState === "closed") continue;
      const stats = await e.pc.getStats().catch(() => null);
      stats?.forEach((s: any) => {
        if (s.type === "inbound-rtp" && s.kind === "audio" && ids.has(s.trackIdentifier)) packets += s.packetsReceived ?? 0;
      });
    }
    return { packets, at: performance.now(), tracks: ids.size };
  }, senderId);
}

/** Audio packets a second from one sender over `ms` */
export async function packetRateFrom(page: Page, senderId: string, ms = 2000): Promise<number> {
  const a = await packetsFrom(page, senderId);
  await page.waitForTimeout(ms);
  const b = await packetsFrom(page, senderId);
  return b.at > a.at ? Math.round(((b.packets - a.packets) * 1000) / (b.at - a.at)) : 0;
}
