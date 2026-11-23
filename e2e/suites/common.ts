// What several suites share: starting and entering clients, the checks most tests end with (frame rate,
// console errors, reticulum.io), two-way audio, and polling.
import type { Evidence } from "../report/evidence";
import { room, SFU_ID, type AccountName, type MediaServer, type RoomName } from "../lib/fixtures";
import { launchClients, type Client, type LaunchOptions } from "../clients/launch";
import { ensureSignedIn, forgetTestAvatar } from "../clients/signin";
import { ASSETS_URL } from "../lib/env";
import { enterRoom, type EnterOptions } from "../clients/enter";
import { CONTROL_HZ, type SlotName } from "../assets/media";
import { MIN_FRAME_RATE, measureFrameRate, readSession, type Session } from "../probes/session";
import { PILOT_HEARD, PILOT_SILENT, heardPilot, type PilotResult } from "../probes/audio";
import { SEND_WATCH, collectErrors, countByReason, reticulumIoHosts, type AllowEntry } from "../probes/errors";
import { capabilities } from "../probes/compat";
import { readConnections } from "../probes/connections";
import { CONSOLE_ALLOW_LIST } from "./console-allowlist";

export const heard = (r: PilotResult) => r.ratio >= PILOT_HEARD && r.controlRatio <= PILOT_SILENT;
export const silent = (r: PilotResult) => r.ratio <= PILOT_SILENT;
export const pilotText = (r: PilotResult) => `pilot ${r.ratio}${r.error ? ` (${r.error})` : ""}`;

/** The room most tests use on a media server */
export const mainRoom = (server: MediaServer): RoomName => (server === "dialog" ? "dialog-main" : "livekit-main");

/** Window positions for up to six visible clients on the 1920 x 1080 display */
export const POSITIONS: [number, number][] = [
  [0, 0],
  [640, 0],
  [1280, 0],
  [0, 360],
  [640, 360],
  [1280, 360]
];

export async function idOf(c: Client): Promise<string> {
  return (await readSession(c.page)).clientId;
}

export type Seat = Omit<LaunchOptions, "profile" | "evidence"> & {
  /** Signed in as this account before entering; anonymous when left out */
  account?: AccountName;
  profile?: LaunchOptions["profile"];
};

/** Starts the clients together, signs in those with an account, and enters them into the room together */
export async function startClients(evidence: Evidence, seats: Seat[]): Promise<Client[]> {
  const clients = await launchClients(
    seats.map((s, i) => ({
      profile: "DESK" as const,
      position: POSITIONS[i % POSITIONS.length],
      ...s,
      evidence,
      initScripts: [SEND_WATCH, ...(s.initScripts ?? [])]
    }))
  );
  await Promise.all(clients.map((c, i) => (seats[i].account ? ensureSignedIn(c, seats[i].account!) : Promise.resolve())));
  // A sample avatar a test chose stays in the signed-in profile; each test starts from the default avatar
  const forgotten = await Promise.all(clients.map(c => forgetTestAvatar(c, ASSETS_URL).catch(() => null)));
  const notes = clients.map((c, i) => (forgotten[i] ? `${c.name} ${forgotten[i]!.split("/").pop()}` : "")).filter(Boolean);
  if (notes.length) evidence.note(`avatar left in the profile by an earlier test removed (the client's default is used): ${notes.join(", ")}`);
  return clients;
}

/** Enters the clients into the room together; saves the timings */
export async function enterAll(evidence: Evidence, clients: Client[], hubId: string, opts: Omit<EnterOptions, "displayName"> = {}, file = "entry.json") {
  const timings = await Promise.all(clients.map(c => enterRoom(c, hubId, { ...opts, displayName: c.name })));
  evidence.saveJson(file, Object.fromEntries(clients.map((c, i) => [c.name, timings[i]])), "entry timings (ms from opening the page)");
  if (clients[0]) await noteClientApi(evidence, clients[0]);
  return timings;
}

const noted = new WeakSet<Evidence>();

/** Notes once per test which client API the build has (probes/compat.ts): what is not applicable follows from it */
export async function noteClientApi(evidence: Evidence, client: Client) {
  if (noted.has(evidence)) return;
  const caps = await capabilities(client.page).catch(() => null);
  if (!caps) return;
  noted.add(evidence);
  evidence.note(
    `client API: ${caps.kind === "session" ? "APP.sfu is a session" : "APP.sfu is the media server adapter"}; ` +
      `packet log (APP.sfu.bus) ${caps.packetLog ? "yes" : "no"}, pose store (APP.avatarPoses) ${caps.poseStore ? "yes" : "no, poses read from the #avatar-RIG and #avatar-HEAD transforms"}`
  );
}

/** The usual pair: A the admin (slot a), B member 1 (slot b), entered into `roomName` */
export async function startPair(evidence: Evidence, roomName: RoomName, extra: Partial<Seat>[] = []): Promise<[Client, Client]> {
  const [a, b] = await startClients(evidence, [
    { identity: "admin", account: "admin", slot: "a", ...extra[0] },
    { identity: "member1", account: "member1", slot: "b", ...extra[1] }
  ]);
  const hub = room(roomName);
  evidence.note(`room ${roomName} ${hub.hubId} (${hub.mediaServer})`);
  await enterAll(evidence, [a, b], hub.hubId);
  return [a, b];
}

/** Both directions: does each client hear the other's pilot? */
export async function twoWayAudio(a: Client, b: Client, ms = 5000) {
  const [ida, idb] = [await idOf(a), await idOf(b)];
  const [bHearsA, aHearsB] = await Promise.all([heardPilot(b.page, ida, a.pilotHz, CONTROL_HZ, ms), heardPilot(a.page, idb, b.pilotHz, CONTROL_HZ, ms)]);
  return { bHearsA, aHearsB, ok: heard(bHearsA) && heard(aHearsB) };
}

/** Who hears whom: every listener against every sender in the list (a sender-by-receiver grid) */
export async function hearingGrid(clients: Client[], ms = 4000) {
  const ids = await Promise.all(clients.map(idOf));
  const grid: Record<string, Record<string, PilotResult>> = {};
  await Promise.all(
    clients.map(async (listener, i) => {
      grid[listener.name] = {};
      for (let j = 0; j < clients.length; j++) {
        if (i === j) continue;
        grid[listener.name][clients[j].name] = await heardPilot(listener.page, ids[j], clients[j].pilotHz, CONTROL_HZ, ms);
      }
    })
  );
  const missing = Object.entries(grid).flatMap(([l, row]) => Object.entries(row).filter(([, r]) => !heard(r)).map(([s, r]) => `${l} does not hear ${s} (${r.ratio})`));
  return { grid, missing, ok: missing.length === 0 };
}

export const gridText = (grid: Record<string, Record<string, PilotResult>>) =>
  Object.entries(grid)
    .map(([l, row]) => `${l} hears ${Object.entries(row).map(([s, r]) => `${s} ${r.ratio}`).join(", ")}`)
    .join("; ");

/** Polls `fn` until it returns a truthy value or the time is up; returns the last value and the time taken */
export async function waitUntil<T>(fn: () => Promise<T>, timeoutMs: number, everyMs = 500): Promise<{ value: T; ms: number; timedOut: boolean }> {
  const t0 = Date.now();
  let value = await fn();
  while (!value && Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, everyMs));
    value = await fn();
  }
  return { value, ms: Date.now() - t0, timedOut: !value };
}

/** Plan 2.2: every visible client measures its frame rate; below the floor the test is invalid, not failed */
export async function frameRateCheck(evidence: Evidence, clients: Client[]) {
  // DESK and QUEST (plan 2.2), and OLD, which is DESK on the previous build
  const visible = clients.filter(c => ["DESK", "QUEST", "OLD", "OLD_QUEST"].includes(c.profile) && !c.modifiers.includes("poor-network"));
  return evidence.check("Frame rate of the clients", "2.2", async () => {
    const rates = await Promise.all(visible.map(c => measureFrameRate(c.page)));
    const low = Math.min(...rates.map(r => r.raf));
    return {
      ok: low >= MIN_FRAME_RATE ? true : ("invalid" as const),
      summary: visible.map((c, i) => `${c.name} ${rates[i].raf} fps`).join(", ") + ` (floor ${MIN_FRAME_RATE})`,
      data: Object.fromEntries(visible.map((c, i) => [c.name, rates[i]]))
    };
  });
}

/** Every client connected to `server` with a live, enabled microphone */
export async function connectedCheck(evidence: Evidence, clients: Client[], server: MediaServer, covers: string) {
  return evidence.check(`All connected to ${server === "dialog" ? "Dialog" : "LiveKit"} with a live microphone`, covers, async () => {
    const sessions: Session[] = await Promise.all(clients.map(c => readSession(c.page)));
    const good = (s: Session) => s.sfuId === SFU_ID[server] && s.isConnected && s.micTrack === "live" && s.micEnabled === true;
    return {
      ok: sessions.every(good),
      summary: clients.map((c, i) => `${c.name}: sfuId ${sessions[i].sfuId}, connected ${sessions[i].isConnected}, mic ${sessions[i].micTrack}${sessions[i].micEnabled ? "" : " (disabled)"}`).join("; "),
      data: Object.fromEntries(clients.map((c, i) => [c.name, sessions[i]]))
    };
  });
}

/**
 * Every client's connections at the end of a test, with the state of each data channel; a channel still
 * "connecting" long after entry is named in a note (seen on Dialog: a session whose data channels never open)
 */
export async function connectionsAtEnd(evidence: Evidence, clients: Client[]) {
  const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), 10_000))]).catch(() => null);
  const readings = await Promise.all(clients.map(c => within(readConnections(c.page))));
  const rows = clients.map((c, i) => ({
    client: c.name,
    connections: (readings[i]?.connections ?? []).map(x => ({ id: x.id, state: x.connectionState, closed: x.closedAtS !== null, dataChannels: x.dataChannels.map(d => `${d.label} ${d.state} sent ${d.messagesSent} received ${d.messagesReceived}`) }))
  }));
  evidence.saveJson("connections-at-end.json", rows, "every client's connections and data channels at the end of the test");
  const stuck = rows.flatMap(r => r.connections.filter(x => !x.closed).flatMap(x => x.dataChannels.filter(d => / connecting /.test(d)).map(d => `${r.client} connection ${x.id} (${x.state}): ${d.split(" sent")[0]}`)));
  if (stuck.length) evidence.note(`data channels still connecting at the end: ${stuck.join("; ")}`);
  return stuck;
}

/** T6.10 and T6.8, at the end of every test: console errors against the allow-list, and no reticulum.io request */
export async function closingChecks(evidence: Evidence, clients: Client[], extraAllow: AllowEntry[] = []) {
  await connectionsAtEnd(evidence, clients.filter(c => c.profile !== "BOT")).catch(() => []);
  await evidence.check("No console errors outside the allow-list", "T6.10", async () => {
    const { unexpected, allowed } = collectErrors(clients, [...extraAllow, ...CONSOLE_ALLOW_LIST]);
    // Distinct messages with their counts; a reconnect loop can log thousands of the same error
    const distinct: Record<string, number> = {};
    for (const e of unexpected) {
      const key = `${e.type}: ${e.text.split("\n")[0].slice(0, 200)}`;
      distinct[key] = (distinct[key] ?? 0) + 1;
    }
    evidence.saveJson(
      "errors.json",
      { unexpectedDistinct: distinct, unexpected: unexpected.slice(0, 300), allowedByReason: countByReason(allowed), allowed: allowed.slice(0, 300) },
      "console errors, sorted by the allow-list (first 300 of each)"
    );
    return {
      ok: unexpected.length === 0,
      summary:
        `${unexpected.length} unexpected, ${allowed.length} allowed` +
        (unexpected.length ? `; first: ${unexpected[0].client} ${unexpected[0].type}: ${unexpected[0].text.split("\n")[0].slice(0, 160)}` : ""),
      data: {
        unexpected: unexpected.slice(0, 40).map(e => `${e.client} ${e.type}: ${e.text.split("\n")[0].slice(0, 300)} ${e.url ?? ""}`),
        allowedByReason: countByReason(allowed)
      }
    };
  });
  await evidence.check("No request to a reticulum.io host", "T6.8", async () => {
    const hosts = reticulumIoHosts(clients);
    return { ok: hosts.length === 0, summary: hosts.length ? `requests to ${hosts.join(", ")}` : "none", data: { hosts } };
  });
}

/** Page errors (uncaught exceptions) of the clients since a point in their logs */
export function exceptionsSince(clients: Client[], marks: Map<Client, number>) {
  return clients.flatMap(c => c.log.filter(e => e.type === "pageerror" && e.t >= (marks.get(c) ?? 0)).map(e => `${c.name}: ${e.text.split("\n")[0].slice(0, 200)}`));
}

/** The current position in each client's log, for exceptionsSince */
export function logMarks(clients: Client[]): Map<Client, number> {
  return new Map(clients.map(c => [c, c.log.length ? c.log[c.log.length - 1].t + 1 : 0]));
}

export type SlotSeat = { identity: string; account?: AccountName; slot: SlotName };

/**
 * Whether a client logged Dialog's "Tried to toggle mic but there's no producer." at entry: its microphone
 * was asked on before the producer existed, so its media session never recorded the wish (T2.2 explains);
 * after a media server switch or move such a client arrives muted on LiveKit.
 */
export const micWishLost = (c: Client) => c.log.some(e => /Tried to toggle mic but there's no producer/.test(e.text));

/** For summaries: which clients lost their microphone wish at entry */
export function micWishNote(clients: Client[]): string {
  const lost = clients.filter(micWishLost).map(c => c.name);
  return lost.length ? `; ${lost.join(", ")} logged "Tried to toggle mic but there's no producer." at entry (microphone wish not recorded, see T2.2)` : "";
}
