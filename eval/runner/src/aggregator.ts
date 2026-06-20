// Receives every event/snapshot stream, applies clock-offset conversion, and
// writes per-run CSV files at run end.

import * as fs from "fs";
import * as path from "path";
import { ProbeEvent } from "./types";
import { ClientRecord } from "./report-server";
import { DialogSnapshot } from "./dialog-poll";
import { HostStatSample } from "./host-stats";

type Row = ProbeEvent & {
  client_id: string;
  label: string;
};

export class Aggregator {
  private _outDir: string;
  private _events: Row[] = [];
  private _dialogSnaps: DialogSnapshot[] = [];
  private _hostSamples: HostStatSample[] = [];

  constructor(outDir: string) {
    this._outDir = outDir;
    fs.mkdirSync(outDir, { recursive: true });
  }

  ingestEvent(row: Row) {
    this._events.push(row);
  }

  // Write a CSV by streaming each row as it's produced, never accumulating
  // the full file content as a single in-memory string. Required at high N
  // where total row count can exceed V8's max string length (~512 MB) and
  // crash the runner with "Invalid string length" / "string too long" before
  // the file is written.
  //
  // The buffer is flushed when it exceeds FLUSH_THRESHOLD; this caps peak
  // memory regardless of total CSV size.
  private _streamCsv(
    filename: string,
    headers: string[],
    generate: (emit: (row: string) => void) => void
  ): void {
    const filepath = path.join(this._outDir, filename);
    const fd = fs.openSync(filepath, "w");
    try {
      const FLUSH_THRESHOLD = 16 * 1024 * 1024; // 16 MB
      let buf = headers.join(",") + "\n";
      const emit = (row: string) => {
        buf += row + "\n";
        if (buf.length >= FLUSH_THRESHOLD) {
          fs.writeSync(fd, buf);
          buf = "";
        }
      };
      generate(emit);
      if (buf.length > 0) fs.writeSync(fd, buf);
    } finally {
      fs.closeSync(fd);
    }
  }

  ingestDialog(snap: DialogSnapshot) {
    this._dialogSnaps.push(snap);
  }

  ingestHost(sample: HostStatSample) {
    this._hostSamples.push(sample);
  }

  // Apply each client's clock-offset trajectory to convert t_client_ms -> t_server_ms.
  // If no offset samples are recorded (clock-sync never completed), the row is
  // emitted with t_server_ms = NaN so it's visible but ignorable downstream.
  finalize(
    clients: ClientRecord[],
    windowStartMs: number | null = null,
    windowEndMs: number | null = null
  ): void {
    const offsetIndex = buildOffsetIndex(clients);

    // Manual-start / windowed runs: drop everything outside the operator-defined
    // test window [windowStartMs, windowEndMs] (server-time ms). In manual mode the
    // bots auto-start chirping the moment they connect — before the operator presses
    // Enter — so without this the warmup chirps and any post-duration teardown packets
    // pollute every CSV. Events whose clock conversion failed (NaN server time) are
    // kept: they carry no usable timestamp, so they belong to neither side of the
    // window, and dropping them would silently erase a client whose clock-sync never
    // completed.
    if (windowStartMs !== null && windowEndMs !== null && windowEndMs > windowStartMs) {
      this._applyWindow(offsetIndex, windowStartMs, windowEndMs);
    }

    this._writeProbeEvents(offsetIndex);
    // speaker->listener only: we only measure the speaker's avatar at the
    // listener(s), so pose-pairs is restricted to pairs whose SENDER is a
    // speaker. (chirp-pairs and audio-avatar-offset are already speaker-sourced
    // because only the speaker emits chirps / HEAD slates.)
    const speakerIds = new Set(
      clients.filter(c => c.mode === "speaker").map(c => c.client_id)
    );
    this._writePosePairs(offsetIndex, speakerIds);
    this._writeChirpPairs(offsetIndex);
    this._writeAudioAvatarOffset(offsetIndex);
    this._writeRtcStats(offsetIndex);
    this._writeDialog();
    this._writeHost();

    console.log("[runner] aggregator wrote CSVs to " + this._outDir);
  }

  // Filter all collected data to a server-time window. Mutates the in-memory
  // arrays so every downstream _write* method (they all iterate these arrays)
  // sees the windowed set consistently — pose/chirp pairing included. Logs the
  // before/after counts so a mis-set window that empties the CSVs is obvious
  // rather than silent.
  private _applyWindow(idx: OffsetIndex, lo: number, hi: number): void {
    const evBefore = this._events.length;
    this._events = this._events.filter(e => {
      const t = idx.toServerMs(e.client_id, e.t_client_ms);
      return !isFinite(t) || (t >= lo && t <= hi);
    });
    const hostBefore = this._hostSamples.length;
    this._hostSamples = this._hostSamples.filter(s => s.ts_ms >= lo && s.ts_ms <= hi);
    const dlgBefore = this._dialogSnaps.length;
    this._dialogSnaps = this._dialogSnaps.filter(s => s.ts_ms >= lo && s.ts_ms <= hi);
    console.log(
      "[runner] windowed to [" +
        lo +
        ", " +
        hi +
        "] (" +
        Math.round((hi - lo) / 1000) +
        "s): events " +
        evBefore +
        "->" +
        this._events.length +
        ", host " +
        hostBefore +
        "->" +
        this._hostSamples.length +
        ", dialog " +
        dlgBefore +
        "->" +
        this._dialogSnaps.length
    );
  }

  private _writeProbeEvents(idx: OffsetIndex) {
    const headers = [
      "t_server_ms",
      "t_client_ms",
      "client_id",
      "label",
      "kind",
      "channel",
      "source_client_id",
      "seq",
      "peer_kind",
      "magnitude"
    ];
    this._streamCsv("probe-events.csv", headers, (emit) => {
      for (const e of this._events) {
        const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
        emit(
          [
            numCell(t_server),
            numCell(e.t_client_ms),
            csvCell(e.client_id),
            csvCell(e.label),
            csvCell(e.kind),
            csvCell((e as any).channel),
            csvCell((e as any).source_client_id || (e as any).peer_client_id),
            numCell((e as any).seq),
            csvCell((e as any).peer_kind),
            numCell((e as any).magnitude)
          ].join(",")
        );
      }
    });
  }

  private _writePosePairs(idx: OffsetIndex, speakerIds: Set<string>) {
    // For each (sender, channel) we keep a map of seq -> send timestamp.
    // For each (sender, receiver, channel) tuple we keep a list of received
    // events. Pairing then matches each recv to its sender's send by exact
    // seq number, not by list index.
    //
    // The original implementation sorted both lists by seq and paired by
    // index, which produces correct results only if no seqs are missing on
    // either side. Any random-interspersed loss would shift every subsequent
    // pair by one in seq, accumulating ~30 ms inflation per loss (at 30 Hz)
    // on top of the real per-pair latency. In practice losses on this stack
    // tend to cluster at the tail of the cell (still-in-flight messages at
    // exit), where index pairing happens to coincide with seq matching;
    // but interspersed loss would silently corrupt the report.
    type SendKey = string;
    type RecvKey = string;
    const sends = new Map<SendKey, Map<number, number>>(); // (sender|channel) -> (seq -> t_server)
    const recvs = new Map<RecvKey, { seq: number; t_server: number }[]>();

    for (const e of this._events) {
      if (e.kind === "avatar-send") {
        const k = e.client_id + "|" + e.channel;
        const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
        let m = sends.get(k);
        if (!m) {
          m = new Map<number, number>();
          sends.set(k, m);
        }
        m.set(e.seq, t_server);
      } else if (e.kind === "avatar-recv") {
        const k = e.source_client_id + "|" + e.client_id + "|" + e.channel;
        const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
        const arr = recvs.get(k) || [];
        arr.push({ seq: e.seq, t_server });
        recvs.set(k, arr);
      }
    }

    const headers = [
      "from_client_id",
      "recv_client_id",
      "channel",
      "seq",
      "t_send_server_ms",
      "t_recv_server_ms",
      "latency_ms"
    ];

    this._streamCsv("pose-pairs.csv", headers, (emit) => {
      for (const [rkey, recvList] of recvs.entries()) {
        const [source, recv, channel] = rkey.split("|");
        // speaker->listener only: skip pairs whose sender isn't a speaker.
        if (!speakerIds.has(source)) continue;
        const sendMap = sends.get(source + "|" + channel);
        if (!sendMap) continue;
        // Sort output by seq so rows are in send order. The pairing is by
        // seq lookup, not by index — sorting here is purely cosmetic for the
        // CSV row order.
        recvList.sort((a, b) => a.seq - b.seq);
        for (const r of recvList) {
          const t_send = sendMap.get(r.seq);
          if (t_send === undefined) {
            // recv with no matching send — should not occur in normal operation
            // (would imply a phantom seq on the receiver). Skip silently.
            continue;
          }
          const latency = r.t_server - t_send;
          emit(
            [
              csvCell(source),
              csvCell(recv),
              csvCell(channel),
              String(r.seq),
              numCell(t_send),
              numCell(r.t_server),
              numCell(latency)
            ].join(",")
          );
        }
      }
    });
  }

  private _writeChirpPairs(idx: OffsetIndex) {
    // Speaker chirp-emit events keyed by client_id (one speaker per run).
    const emits = new Map<string, { seq: number; t_server: number }[]>();
    // Listener chirp-detect events keyed by (source, listener).
    const detects = new Map<string, { t_server: number; magnitude: number }[]>();

    for (const e of this._events) {
      if (e.kind === "chirp-emit") {
        const arr = emits.get(e.client_id) || [];
        arr.push({ seq: e.seq, t_server: idx.toServerMs(e.client_id, e.t_client_ms) });
        emits.set(e.client_id, arr);
      } else if (e.kind === "chirp-detect" && e.source_client_id) {
        const k = e.source_client_id + "|" + e.client_id;
        const arr = detects.get(k) || [];
        arr.push({
          t_server: idx.toServerMs(e.client_id, e.t_client_ms),
          magnitude: e.magnitude
        });
        detects.set(k, arr);
      }
    }

    const headers = [
      "speaker_client_id",
      "listener_client_id",
      "seq",
      "t_emit_server_ms",
      "t_detect_server_ms",
      "latency_ms",
      "magnitude"
    ];

    // Pair each emit with the first plausibly-corresponding detect using a
    // time-window two-pointer walk. Robust to false-positive detections at
    // the start/middle of a run and to missed detections — naive index
    // pairing would propagate any single off-by-one through the rest of the
    // listener's run, producing systematic negative latencies.
    //
    // CLOCK_TOLERANCE_MS: tolerate small negative apparent latency from
    //   cross-client clock skew (typical clock_ci_ms is 1–5 ms; this is well
    //   above that).
    // PAIRING_WINDOW_MS: a detect arriving more than this far after an emit
    //   is treated as "the emit was missed by this listener". Must stay
    //   strictly less than the chirp interval in audio-chirp.ts (currently
    //   5000 ms) so we never cross-pair emit[N] with detect[N+1]. The
    //   1000 ms safety margin tolerates pathological cloud / N=80 / jitter
    //   scenarios.
    const CLOCK_TOLERANCE_MS = 50;
    const PAIRING_WINDOW_MS = 4000;

    this._streamCsv("chirp-pairs.csv", headers, (emit) => {
      for (const [dkey, detList] of detects.entries()) {
        const [speaker, listener] = dkey.split("|");
        const emitList = emits.get(speaker) || [];
        emitList.sort((a, b) => a.t_server - b.t_server);
        detList.sort((a, b) => a.t_server - b.t_server);

        let i = 0;
        let j = 0;
        while (i < emitList.length && j < detList.length) {
          const em = emitList[i];
          const det = detList[j];
          const dt = det.t_server - em.t_server;

          if (dt < -CLOCK_TOLERANCE_MS) {
            // Detect arrived materially before this emit — it's a false
            // positive (or matches an earlier emit already paired).
            j++;
          } else if (dt > PAIRING_WINDOW_MS) {
            // No detect within the window after this emit — the emit was
            // missed by this listener.
            i++;
          } else {
            emit(
              [
                csvCell(speaker),
                csvCell(listener),
                String(em.seq),
                numCell(em.t_server),
                numCell(det.t_server),
                numCell(dt),
                numCell(det.magnitude)
              ].join(",")
            );
            i++;
            j++;
          }
        }
      }
    });
  }

  private _writeAudioAvatarOffset(idx: OffsetIndex) {
    // Audio↔avatar synchronization via a coincident HEAD "slate": the speaker emits one
    // discrete #avatar-HEAD packet at each audio-chirp instant (see eval-probe
    // sendHeadSlate). The bot's head is otherwise static, so every #avatar-HEAD packet is
    // exactly one slate. We pair, per listener, the chirp detection with the HEAD packet
    // from the same slate and report offset_ms = t_chirp_detect - t_head_recv. Both
    // arrivals are timestamped on the SAME listener, so the offset is a within-client
    // difference and is immune to cross-machine clock-sync error (unlike the per-leg
    // one-way latencies, which span sender→listener).
    const HEAD_CHANNEL = "#avatar-HEAD";

    type Slate = { head_send_seq: number; t_head_send: number };
    const slatesBySpeaker = new Map<string, Map<number, Slate>>(); // speaker -> (chirp_seq -> slate)
    const chirpEmits = new Map<string, Map<number, number>>(); // speaker -> (chirp_seq -> t_emit)
    const chirpDetects = new Map<string, number[]>(); // speaker|listener -> detect t_server[]
    const headRecvs = new Map<string, Map<number, number>>(); // speaker|listener -> (head_send_seq -> t_recv)

    const getInner = <V>(m: Map<string, Map<number, V>>, k: string) => {
      let inner = m.get(k);
      if (!inner) {
        inner = new Map<number, V>();
        m.set(k, inner);
      }
      return inner;
    };

    for (const e of this._events) {
      if (e.kind === "head-slate-emit") {
        getInner(slatesBySpeaker, e.client_id).set(e.chirp_seq, {
          head_send_seq: e.head_send_seq,
          t_head_send: idx.toServerMs(e.client_id, e.t_client_ms)
        });
      } else if (e.kind === "chirp-emit") {
        getInner(chirpEmits, e.client_id).set(e.seq, idx.toServerMs(e.client_id, e.t_client_ms));
      } else if (e.kind === "chirp-detect" && e.source_client_id) {
        const k = e.source_client_id + "|" + e.client_id;
        const arr = chirpDetects.get(k) || [];
        arr.push(idx.toServerMs(e.client_id, e.t_client_ms));
        chirpDetects.set(k, arr);
      } else if (e.kind === "avatar-recv" && e.channel === HEAD_CHANNEL) {
        getInner(headRecvs, e.source_client_id + "|" + e.client_id).set(
          e.seq,
          idx.toServerMs(e.client_id, e.t_client_ms)
        );
      }
    }

    // Match a listener's chirp-detect to the speaker's chirp-emit by time-window, same
    // constants/rationale as _writeChirpPairs (window strictly < the 5 s chirp interval).
    const CLOCK_TOLERANCE_MS = 50;
    const PAIRING_WINDOW_MS = 4000;

    const headers = [
      "speaker_client_id",
      "listener_client_id",
      "chirp_seq",
      "head_send_seq",
      "t_chirp_emit_ms",
      "t_head_send_ms",
      "t_chirp_detect_ms",
      "t_head_recv_ms",
      "offset_ms"
    ];

    this._streamCsv("audio-avatar-offset.csv", headers, (emit) => {
      for (const [dkey, detimes] of chirpDetects.entries()) {
        const [speaker, listener] = dkey.split("|");
        const slates = slatesBySpeaker.get(speaker);
        const emitMap = chirpEmits.get(speaker);
        const recvMap = headRecvs.get(dkey);
        if (!slates || !emitMap || !recvMap) continue;

        // Slate chirps that actually have a recorded chirp-emit time, sorted for the walk.
        const emitList = Array.from(slates.keys())
          .map(c => ({ chirp_seq: c, t_emit: emitMap.get(c) }))
          .filter((x): x is { chirp_seq: number; t_emit: number } => x.t_emit !== undefined)
          .sort((a, b) => a.t_emit - b.t_emit);
        const detList = detimes.slice().sort((a, b) => a - b);

        let i = 0;
        let j = 0;
        while (i < emitList.length && j < detList.length) {
          const em = emitList[i];
          const tDetect = detList[j];
          const dt = tDetect - em.t_emit;
          if (dt < -CLOCK_TOLERANCE_MS) {
            j++;
          } else if (dt > PAIRING_WINDOW_MS) {
            i++;
          } else {
            const slate = slates.get(em.chirp_seq)!;
            const tHeadRecv = recvMap.get(slate.head_send_seq);
            if (tHeadRecv !== undefined) {
              emit(
                [
                  csvCell(speaker),
                  csvCell(listener),
                  String(em.chirp_seq),
                  String(slate.head_send_seq),
                  numCell(em.t_emit),
                  numCell(slate.t_head_send),
                  numCell(tDetect),
                  numCell(tHeadRecv),
                  numCell(tDetect - tHeadRecv)
                ].join(",")
              );
            }
            i++;
            j++;
          }
        }
      }
    });
  }

  private _writeRtcStats(idx: OffsetIndex) {
    const headers = [
      "t_server_ms",
      "client_id",
      "label",
      "peer_kind",
      "stat_id",
      "stat_type",
      "kind",
      "jitter",
      "currentRoundTripTime",
      "bytesSent",
      "bytesReceived",
      "packetsLost",
      "packetsSent",
      "packetsReceived",
      "availableOutgoingBitrate",
      "availableIncomingBitrate"
    ];
    this._streamCsv("rtc-stats.csv", headers, (emit) => {
      for (const e of this._events) {
        if (e.kind !== "rtc-stats") continue;
        const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
        const report = e.report || {};
        for (const [statId, statRaw] of Object.entries(report)) {
          const stat = statRaw as Record<string, unknown>;
          emit(
            [
              numCell(t_server),
              csvCell(e.client_id),
              csvCell(e.label),
              csvCell(e.peer_kind),
              csvCell(statId),
              csvCell(stat.type),
              csvCell(stat.kind),
              numCell(stat.jitter),
              numCell(stat.currentRoundTripTime),
              numCell(stat.bytesSent),
              numCell(stat.bytesReceived),
              numCell(stat.packetsLost),
              numCell(stat.packetsSent),
              numCell(stat.packetsReceived),
              numCell(stat.availableOutgoingBitrate),
              numCell(stat.availableIncomingBitrate)
            ].join(",")
          );
        }
      }
    });
  }

  private _writeDialog() {
    const headers = ["ts_server_ms", "hostname", "capacity"];
    this._streamCsv("dialog.csv", headers, (emit) => {
      for (const s of this._dialogSnaps) {
        emit([numCell(s.ts_ms), csvCell(s.hostname), numCell(s.capacity)].join(","));
      }
    });
  }

  private _writeHost() {
    const headers = [
      "ts_server_ms",
      "source",
      "container",
      "cpu_pct",
      "mem_bytes",
      "net_rx_bytes",
      "net_tx_bytes"
    ];
    this._streamCsv("host.csv", headers, (emit) => {
      for (const s of this._hostSamples) {
        emit(
          [
            numCell(s.ts_ms),
            csvCell(s.source),
            csvCell(s.container),
            numCell(s.cpu_pct),
            numCell(s.mem_bytes),
            numCell(s.net_rx_bytes),
            numCell(s.net_tx_bytes)
          ].join(",")
        );
      }
    });
  }
}

// Helpers
function csvCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return "\"" + s.replace(/\"/g, '""') + "\"";
  }
  return s;
}

function numCell(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") {
    if (!isFinite(v)) return "";
    return String(v);
  }
  const n = Number(v);
  if (!isFinite(n)) return "";
  return String(n);
}

type OffsetIndex = {
  toServerMs: (client_id: string, t_client_ms: number) => number;
};

function buildOffsetIndex(clients: ClientRecord[]): OffsetIndex {
  // For each client, store sorted offset samples; for each event, pick the
  // closest-in-time sample (or extrapolate from nearest if before/after range).
  type Sample = { at: number; offset: number };
  const perClient = new Map<string, Sample[]>();
  for (const c of clients) {
    const sorted = c.clock_offsets
      .map(s => ({ at: s.at_t_client_ms, offset: s.offset_ms }))
      .sort((a, b) => a.at - b.at);
    perClient.set(c.client_id, sorted);
  }
  return {
    toServerMs(client_id: string, t_client_ms: number): number {
      const samples = perClient.get(client_id);
      if (!samples || samples.length === 0) return NaN;
      if (t_client_ms <= samples[0].at) return t_client_ms + samples[0].offset;
      if (t_client_ms >= samples[samples.length - 1].at) {
        return t_client_ms + samples[samples.length - 1].offset;
      }
      // Binary search for the interval.
      let lo = 0;
      let hi = samples.length - 1;
      while (lo + 1 < hi) {
        const mid = (lo + hi) >>> 1;
        if (samples[mid].at <= t_client_ms) lo = mid;
        else hi = mid;
      }
      // Linear interpolate between samples[lo] and samples[lo+1].
      const a = samples[lo];
      const b = samples[lo + 1];
      const u = (t_client_ms - a.at) / (b.at - a.at);
      const offset = a.offset + u * (b.offset - a.offset);
      return t_client_ms + offset;
    }
  };
}
