// T2.15 (plan 4): 4 DESK and 4 BOT clients in one room for SOAK_MINUTES (40 by default, the plan's length)
// per media server. The DESK clients' JavaScript heap (after a collection), renderer memory and live
// connections are sampled every 30 s; after the warm-up they have to stay flat. At the end the avatars
// still have to move; whether the pose sequence number wrapped (65,536 packets, 24 to 36 minutes at 30 to
// 45 packets a second) is reported, and judged only when the run was long enough to reach it.
// SOAK_BOTS (4 by default) sets how many BOT clients join; SOAK_BOTS=0 runs the 4 DESK clients alone, for
// when the bots keep the room from forming (the bots have destabilised Dialog before).
import { test } from "./harness";
import { room } from "../lib/fixtures";
import type { Client } from "../clients/launch";
import * as input from "../clients/input";
import { launchBot, waitBotEntered } from "../clients/bot";
import { reannounceAvatars } from "../clients/workarounds";
import { readMemory, trend, type MemorySample } from "../probes/memory";
import { movement, readPose, tracePose } from "../probes/poses";
import { blockId, blockTitle, runsOn } from "./blocks";
import { closingChecks, connectedCheck, enterAll, frameRateCheck, idOf, mainRoom, startClients } from "./common";
import { guardServerClock } from "./server-clock";
import type { SlotName } from "../assets/media";

const SOAK_MINUTES = Number(process.env.SOAK_MINUTES ?? 40);
const SOAK_BOTS = Math.max(0, Math.min(4, Number(process.env.SOAK_BOTS ?? 4)));
const PLAN_MINUTES = 40;
const SAMPLE_EVERY_MS = 30_000;
/** Starting values (plan 4: thresholds are fixed after the first baseline run) */
const HEAP_SLOPE_LIMIT_MB_PER_MIN = 1;
const SEQ_WRAP = 65_536;

const SERVERS = ["dialog", "livekit"] as const;

for (const server of SERVERS) {
  test(
    `T2.15 soak, ${SOAK_MINUTES} minutes with 4 DESK${SOAK_BOTS ? ` and ${SOAK_BOTS} BOT` : " and no BOT"}, on ${blockTitle(server)}`,
    { annotation: [{ type: "id", description: `t2.15-${blockId(server)}` }, { type: "covers", description: "F10 A1c A1f" }] },
    async ({ evidence }) => {
      runsOn(server);
      test.setTimeout((SOAK_MINUTES + 20) * 60_000);
      if (SOAK_MINUTES < PLAN_MINUTES) {
        evidence.note(`shortened run: SOAK_MINUTES=${SOAK_MINUTES}; the plan's soak is ${PLAN_MINUTES} minutes per media server, so the sequence number wrap is not reached`);
      }
      if (SOAK_BOTS < 4) evidence.note(`SOAK_BOTS=${SOAK_BOTS}: ${SOAK_BOTS ? `${SOAK_BOTS} BOT clients` : "no BOT clients"} instead of the plan's 4`);
      // The soak outlasts a clock that is already a little behind: start it from a fresh measurement
      const clock = await guardServerClock({ force: true, maxLagSeconds: 20 });
      if (clock) evidence.note(clock);
      const hub = room(mainRoom(server));
      const desks = await startClients(evidence, [
        { identity: "admin", account: "admin", slot: "a" },
        { identity: "member1", account: "member1", slot: "b" },
        { identity: "member2", account: "member2", slot: "c" },
        { identity: "guest", slot: "d", name: "D-guest" }
      ]);
      await enterAll(evidence, desks, hub.hubId);
      const botSlots: SlotName[] = (["e", "f", "g", "h"] as SlotName[]).slice(0, SOAK_BOTS);
      const bots: Client[] = [];
      for (const slot of botSlots) bots.push(await launchBot({ hubId: hub.hubId, slot, evidence }));
      const entered = await Promise.all(bots.map(b => waitBotEntered(b).then(() => true).catch(() => false)));
      evidence.note(`room ${hub.hubId}; bots entered: ${bots.map((b, i) => `${b.name} ${entered[i]}`).join(", ")}`);
      await reannounceAvatars(desks, evidence, "so the DESK clients draw each other's avatars during the soak; the subject here is memory and movement");
      await frameRateCheck(evidence, desks);
      await connectedCheck(evidence, desks, server, "F10");
      const ids = await Promise.all([...desks, ...bots].map(idOf));
      const [a, b] = desks;
      const idb = ids[1];

      // Samples every 30 s; each DESK client walks a little every minute so poses keep changing
      const t0 = Date.now();
      const series: Record<string, MemorySample[]> = Object.fromEntries(desks.map(d => [d.name, []]));
      const seqs: { t: number; seq: number | null }[] = [];
      let wrappedAt: number | null = null;
      let lastSeq: number | null = null;
      let minute = -1;
      const stalls: string[] = [];
      while (Date.now() - t0 < SOAK_MINUTES * 60_000) {
        const t = (Date.now() - t0) / 1000;
        // A page that stops answering must not stop the sampling: each reading has 20 s
        const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<null>(r => setTimeout(() => r(null), 20_000))]).catch(() => null);
        for (const d of desks) {
          const s = await within(readMemory(d));
          if (s) series[d.name].push({ ...s, t: +t.toFixed(0) });
          else stalls.push(`${d.name} at ${t.toFixed(0)} s`);
        }
        const seq = (await within(readPose(a.page, idb)))?.seq ?? null;
        seqs.push({ t: +t.toFixed(0), seq });
        if (seq !== null && lastSeq !== null && seq < lastSeq - SEQ_WRAP / 2 && wrappedAt === null) wrappedAt = t;
        if (seq !== null) lastSeq = seq;
        if (Math.floor(t / 60) !== minute) {
          minute = Math.floor(t / 60);
          await within(Promise.all(desks.map((d, i) => input.walk(d.page, i % 2 ? "w" : "s", 600).catch(() => {}))));
          await within(Promise.all(desks.map((d, i) => input.walk(d.page, i % 2 ? "s" : "w", 600).catch(() => {}))));
        }
        await a.page.waitForTimeout(Math.max(1000, SAMPLE_EVERY_MS - ((Date.now() - t0) % SAMPLE_EVERY_MS)));
      }
      if (stalls.length) evidence.note(`memory readings that did not come back within 20 s: ${stalls.join(", ")}`);
      evidence.saveJson("memory-series.json", { sampleEveryMs: SAMPLE_EVERY_MS, series, seqs, wrappedAt, stalls }, "memory, renderer and connection samples of every DESK client, and B's pose sequence as A sees it");
      await Promise.all(desks.map(d => evidence.screenshot(d, "end")));

      const warmUpS = Math.max(60, Math.round(SOAK_MINUTES * 60 * 0.2));
      // Plan T2.15 judges the heap and the connection count; the renderer's counts are reported with it. They grow
      // in steps whenever something comes into view for the first time (a model is uploaded when first drawn)
      await evidence.check(`Heap flat after ${warmUpS / 60} min of warm-up (renderer memory reported)`, "F10 A1c", async () => {
        const rows = desks.map(d => {
          const tr = trend(series[d.name].filter(s => s.t >= warmUpS));
          return { name: d.name, tr, ok: !!tr && tr.heapMbPerMinute <= HEAP_SLOPE_LIMIT_MB_PER_MIN };
        });
        return {
          ok: rows.every(r => r.ok),
          summary: rows
            .map(r =>
              r.tr
                ? `${r.name}: heap ${r.tr.first.heapUsedMb} -> ${r.tr.last.heapUsedMb} MB (${r.tr.heapMbPerMinute} MB/min), geometries ${r.tr.first.geometries} -> ${r.tr.last.geometries}, textures ${r.tr.first.textures} -> ${r.tr.last.textures}`
                : `${r.name}: too few samples`
            )
            .join("; ") + ` (limit ${HEAP_SLOPE_LIMIT_MB_PER_MIN} MB/min)`,
          data: rows.map(r => ({ name: r.name, ...r.tr }))
        };
      });

      await evidence.check("Live connections flat after the warm-up", "F10 A1c", async () => {
        const rows = desks.map(d => {
          const after = series[d.name].filter(s => s.t >= warmUpS).map(s => s.liveConnections);
          return { name: d.name, min: Math.min(...after), max: Math.max(...after) };
        });
        return { ok: rows.every(r => r.min === r.max), summary: rows.map(r => `${r.name} ${r.min}${r.max !== r.min ? ` to ${r.max}` : ""}`).join(", "), data: rows };
      });

      const moving = await evidence.check("Avatars still move at the end", "A1f F10", async () => {
        const trace = await tracePose(a.page, idb, () => input.walk(b.page, "w", 1500));
        const moved = movement(trace);
        const botsSeen = [];
        for (const id of ids.slice(desks.length)) {
          const p0 = await readPose(a.page, id);
          await a.page.waitForTimeout(500);
          const p1 = await readPose(a.page, id);
          botsSeen.push(!!p0 && !!p1 && p1.seq !== p0.seq);
        }
        return {
          ok: moved.travelled >= 1 && botsSeen.filter(Boolean).length === bots.length,
          summary: `A sees B walk ${moved.travelled} m (${moved.seqAdvanced} packets); bots whose poses advance on A: ${botsSeen.filter(Boolean).length} of ${bots.length}`,
          data: { moved, botsSeen }
        };
      });

      const maxSeq = Math.max(...seqs.map(s => s.seq ?? 0));
      if (wrappedAt !== null) {
        await evidence.check("Avatars move after the pose sequence number wrapped", "A1f", async () => ({
          ok: !!moving?.ok,
          summary: `B's sequence number wrapped after ${(wrappedAt! / 60).toFixed(1)} min (highest seen ${maxSeq}); ${moving?.ok ? "A still saw B move at the end" : "A did not see B move at the end"} (check above)`
        }));
      } else {
        evidence.note(
          `sequence number wrap not reached: B's highest sequence number on A was ${maxSeq} after ${SOAK_MINUTES} min (wraps at ${SEQ_WRAP}); not judged in this run`
        );
      }
      const botErrors = bots.map(bt => `${bt.name} ${bt.log.filter(e => e.type === "error" || e.type === "pageerror").length}`);
      evidence.note(`console errors of the bots (not judged; the bot path stubs the renderer): ${botErrors.join(", ")}`);
      await closingChecks(evidence, desks);
    }
  );
}
