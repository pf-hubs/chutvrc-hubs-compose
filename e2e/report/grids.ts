// "Who hears whom" and "who sees whom" (plan 3.3): a sender-by-receiver grid per test, measured from every
// receiving client, saved as JSON and drawn as a PNG that the report shows inline. Hearing: a Chromium
// receiver runs the pilot probe (the sender's own frequency); a WebKit receiver (IOS), whose Web Audio
// cannot read a remote WebRTC track, measures the sender's inbound RTP (packets and level). Seeing: the
// receiver holds the sender's pose and its sequence number advances, and draws a model for it.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import type { Evidence } from "./evidence";
import { isWebKitClient, type Client } from "../clients/launch";
import { CONTROL_HZ } from "../assets/media";
import { INBOUND_HEARD_DBFS, PILOT_HEARD, PILOT_SILENT, heardPilot, inboundAudio } from "../probes/audio";
import { drawsAvatar, readSession } from "../probes/session";
import { readPose } from "../probes/poses";

export type CellStatus = "ok" | "ng" | "na";
export type Cell = { status: CellStatus; text: string; data?: unknown };
export type Grid = { title: string; senders: string[]; receivers: string[]; cells: Record<string, Record<string, Cell>>; missing: string[] };

const within = <T,>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p.catch(() => fallback), new Promise<T>(r => setTimeout(() => r(fallback), ms))]);

async function ids(clients: Client[]) {
  return Promise.all(clients.map(c => within(readSession(c.page).then(s => s.clientId), 15_000, "")));
}

/**
 * When a receiver does not hear a sender: what the sender's page says about its own outgoing audio (the
 * client's audio context, the level of the audio it sends according to WebRTC's media-source statistics)
 */
async function senderAudio(sender: Client): Promise<string> {
  return within(
    sender.page.evaluate(async () => {
      const ctx = (window as any).AFRAME?.THREE?.AudioContext?.getContext?.();
      const pcs: RTCPeerConnection[] = ((window as any).__e2eConnections ?? []).map((e: any) => e.pc).filter((pc: RTCPeerConnection) => pc.connectionState !== "closed");
      const levels: string[] = [];
      for (const pc of pcs) (await pc.getStats()).forEach((s: any) => s.type === "media-source" && s.kind === "audio" && levels.push((s.audioLevel ?? 0).toFixed(4)));
      return `sender's audio context ${ctx?.state ?? "?"}, outgoing levels ${levels.join("/") || "none"}`;
    }),
    10_000,
    "sender not readable"
  );
}

/** Who hears whom: every receiver against every other client as sender */
export async function hearingGrid(clients: Client[], title = "Who hears whom", ms = 4000): Promise<Grid> {
  const clientIds = await ids(clients);
  const cells: Grid["cells"] = {};
  await Promise.all(
    clients.map(async (receiver, i) => {
      cells[receiver.name] = {};
      for (const [j, sender] of clients.entries()) {
        if (i === j) continue;
        if (!clientIds[j] || !clientIds[i]) {
          cells[receiver.name][sender.name] = { status: "ng", text: "no session" };
          continue;
        }
        if (isWebKitClient(receiver)) {
          const r = await within(inboundAudio(receiver.page, clientIds[j], ms), ms + 20_000, { tracks: [], receivers: 0, packets: 0, meanDbfs: null, error: "timed out" });
          const ok = r.packets > 0 && r.meanDbfs !== null && r.meanDbfs >= INBOUND_HEARD_DBFS;
          cells[receiver.name][sender.name] = { status: ok ? "ok" : "ng", text: r.error ?? `${r.packets} pkts, ${r.meanDbfs ?? "-"} dBFS`, data: r };
        } else {
          const r = await within(heardPilot(receiver.page, clientIds[j], sender.pilotHz, CONTROL_HZ, ms), ms + 20_000, { ratio: 0, controlRatio: 0, peakDb: -Infinity, tracks: [], error: "timed out" });
          const ok = r.ratio >= PILOT_HEARD && r.controlRatio <= PILOT_SILENT;
          const why = ok || sender.profile === "BOT" ? "" : `; ${await senderAudio(sender)}`;
          cells[receiver.name][sender.name] = { status: ok ? "ok" : "ng", text: (r.error ? r.error : `pilot ${r.ratio}`) + why, data: r };
        }
      }
    })
  );
  return finish(title, clients, cells);
}

/** Who sees whom: the receiver holds the sender's pose, the pose advances, and a model is drawn for it */
export async function seeingGrid(clients: Client[], title = "Who sees whom", opts: { models?: boolean } = {}): Promise<Grid> {
  const clientIds = await ids(clients);
  const cells: Grid["cells"] = {};
  await Promise.all(
    clients.map(async (receiver, i) => {
      cells[receiver.name] = {};
      const first = await Promise.all(clientIds.map(id => (id ? within(readPose(receiver.page, id), 10_000, null) : Promise.resolve(null))));
      await receiver.page.waitForTimeout(1500).catch(() => {});
      for (const [j, sender] of clients.entries()) {
        if (i === j) continue;
        const later = clientIds[j] ? await within(readPose(receiver.page, clientIds[j]), 10_000, null) : null;
        const advanced = !!first[j] && !!later && later.seq !== first[j]!.seq;
        const model = opts.models === false ? null : clientIds[j] ? await within(drawsAvatar(receiver.page, clientIds[j]), 10_000, { model: false, visible: false }) : { model: false, visible: false };
        const drawn = model === null ? null : model.model && model.visible;
        const ok = advanced && drawn !== false;
        const text = `${later ? (advanced ? `pose seq +${later.seq - first[j]!.seq}` : "pose stalled") : "no pose"}${drawn === null ? "" : drawn ? ", model drawn" : model?.model ? ", model hidden" : ", no model"}`;
        cells[receiver.name][sender.name] = { status: ok ? "ok" : "ng", text, data: { first: first[j], later, model } };
      }
    })
  );
  return finish(title, clients, cells);
}

function finish(title: string, clients: Client[], cells: Grid["cells"]): Grid {
  const names = clients.map(c => c.name);
  const missing = names.flatMap(r => names.filter(s => s !== r && cells[r]?.[s]?.status === "ng").map(s => `${r} <- ${s} (${cells[r][s].text})`));
  return { title, senders: names, receivers: names, cells, missing };
}

/** One line per receiver, for check summaries */
export const gridLine = (g: Grid) =>
  g.receivers.map(r => `${r}: ${g.senders.filter(s => s !== r).map(s => `${s} ${g.cells[r]?.[s]?.status === "ok" ? "yes" : "NO"}`).join(", ")}`).join("; ");

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The grid as an HTML page (light and dark colours fixed, since it becomes a picture) */
export function gridHtml(g: Grid, profiles: Record<string, string>, note = ""): string {
  const head = g.senders.map(s => `<th class="sender"><div>${esc(s)}</div><small>${esc(profiles[s] ?? "")}</small></th>`).join("");
  const rows = g.receivers
    .map(
      r =>
        `<tr><th class="receiver">${esc(r)}<small>${esc(profiles[r] ?? "")}</small></th>${g.senders
          .map(s => {
            if (s === r) return `<td class="self">–</td>`;
            const c = g.cells[r]?.[s];
            if (!c) return `<td class="na">not measured</td>`;
            return `<td class="${c.status}"><b>${c.status === "ok" ? "✓" : c.status === "na" ? "n/a" : "✗"}</b><span>${esc(c.text)}</span></td>`;
          })
          .join("")}</tr>`
    )
    .join("");
  const ok = g.receivers.reduce((n, r) => n + g.senders.filter(s => s !== r && g.cells[r]?.[s]?.status === "ok").length, 0);
  const all = g.receivers.length * (g.senders.length - 1);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #ffffff; color: #1d2330; font: 14px/1.35 "Segoe UI", system-ui, sans-serif; }
    h1 { font-size: 18px; margin: 0 0 4px; } p { margin: 0 0 12px; color: #5d6677; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid #dde1e8; padding: 6px 8px; text-align: center; vertical-align: middle; }
    th small { display: block; font-weight: 400; color: #5d6677; font-size: 11px; }
    th.receiver { text-align: left; white-space: nowrap; } th.sender div { white-space: nowrap; }
    td { min-width: 92px; } td b { display: block; font-size: 18px; } td span { font-size: 11px; color: #3d4452; }
    td.ok { background: #e3f4ea; } td.ok b { color: #1e7f4f; }
    td.ng { background: #fbe5e8; } td.ng b { color: #b42335; }
    td.na { background: #eceef2; color: #5d6677; } td.self { background: #f6f7f9; color: #9aa3b2; }
    .corner { text-align: left; font-weight: 400; color: #5d6677; font-size: 12px; }
    main { display: inline-block; padding: 20px; background: #ffffff; } body { padding: 0; }
  </style></head><body><main>
    <h1>${esc(g.title)}: ${ok} of ${all}</h1><p>Rows: receiving client. Columns: sending client.${note ? ` ${esc(note)}` : ""}</p>
    <table><thead><tr><th class="corner">receiver ↓ / sender →</th>${head}</tr></thead><tbody>${rows}</tbody></table>
  </main></body></html>`;
}


/** Renders the grid page's content (its <main>) to a PNG of exactly its size */
async function renderGrid(htmlFile: string, pngFile: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 2400, height: 400 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "load" });
    await page.locator("main").screenshot({ path: pngFile });
  } finally {
    await browser.close();
  }
}
/** Saves a grid as JSON and as a PNG shown inline in the report; returns the PNG's file name */
export async function saveGrid(evidence: Evidence, stem: string, g: Grid, clients: Client[], note = ""): Promise<string> {
  const profiles = Object.fromEntries(clients.map(c => [c.name, `${c.profile}${c.modifiers.length ? ` (${c.modifiers.join(", ")})` : ""}`]));
  evidence.saveJson(`${stem}.json`, g, `${g.title} (data)`);
  const html = evidence.file(`${stem}.html`);
  fs.writeFileSync(html, gridHtml(g, profiles, note));
  try {
    await renderGrid(html, evidence.file(`${stem}.png`));
    evidence.addFile(`${stem}.png`, "grid", g.title);
  } catch (e) {
    evidence.note(`${g.title}: the picture was not rendered (${(e as Error).message.split("\n")[0]}); see ${stem}.html`);
    evidence.addFile(`${stem}.html`, "data", `${g.title} (page)`);
  }
  return `${stem}.png`;
}
