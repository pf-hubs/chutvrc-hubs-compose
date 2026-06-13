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

  ingestDialog(snap: DialogSnapshot) {
    this._dialogSnaps.push(snap);
  }

  ingestHost(sample: HostStatSample) {
    this._hostSamples.push(sample);
  }

  // Apply each client's clock-offset trajectory to convert t_client_ms -> t_server_ms.
  // If no offset samples are recorded (clock-sync never completed), the row is
  // emitted with t_server_ms = NaN so it's visible but ignorable downstream.
  finalize(clients: ClientRecord[]): void {
    const offsetIndex = buildOffsetIndex(clients);

    this._writeProbeEvents(offsetIndex);
    this._writePosePairs(offsetIndex);
    this._writeChirpPairs(offsetIndex);
    this._writeAudioAvatarOffset(offsetIndex);
    this._writeRtcStats(offsetIndex);
    this._writeDialog();
    this._writeHost();

    console.log("[runner] aggregator wrote CSVs to " + this._outDir);
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
    const rows: string[] = [headers.join(",")];
    for (const e of this._events) {
      const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
      rows.push(
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
    fs.writeFileSync(path.join(this._outDir, "probe-events.csv"), rows.join("\n") + "\n");
  }

  private _writePosePairs(idx: OffsetIndex) {
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
    const rows: string[] = [headers.join(",")];

    for (const [rkey, recvList] of recvs.entries()) {
      const [source, recv, channel] = rkey.split("|");
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
        rows.push(
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
    fs.writeFileSync(path.join(this._outDir, "pose-pairs.csv"), rows.join("\n") + "\n");
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
    const rows: string[] = [headers.join(",")];

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
          rows.push(
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
    fs.writeFileSync(path.join(this._outDir, "chirp-pairs.csv"), rows.join("\n") + "\n");
  }

  private _writeAudioAvatarOffset(idx: OffsetIndex) {
    // For each chirp-detect (speaker, listener, t_chirp_recv), find the
    // latest avatar-recv from same speaker at same listener with t<=t_chirp_recv.
    // Use the RIG channel as the pose reference: avatar-sync-helper only
    // broadcasts HEAD/LEFT/RIGHT when their transform changes, while RIG is
    // sent every tick — so RIG is the only channel that gives a continuous
    // "where is the avatar now" signal regardless of whether the user moves.
    const POSE_CHANNEL = "#avatar-RIG";

    type Recv = { t_server: number };
    const poseByPair = new Map<string, Recv[]>(); // source|listener -> sorted recvs
    for (const e of this._events) {
      if (e.kind !== "avatar-recv") continue;
      if (e.channel !== POSE_CHANNEL) continue;
      const k = e.source_client_id + "|" + e.client_id;
      const arr = poseByPair.get(k) || [];
      arr.push({ t_server: idx.toServerMs(e.client_id, e.t_client_ms) });
      poseByPair.set(k, arr);
    }
    for (const arr of poseByPair.values()) arr.sort((a, b) => a.t_server - b.t_server);

    const headers = [
      "speaker_client_id",
      "listener_client_id",
      "t_chirp_recv_ms",
      "t_pose_recv_ms",
      "offset_ms"
    ];
    const rows: string[] = [headers.join(",")];
    for (const e of this._events) {
      if (e.kind !== "chirp-detect") continue;
      if (!e.source_client_id) continue;
      const t_chirp = idx.toServerMs(e.client_id, e.t_client_ms);
      const k = e.source_client_id + "|" + e.client_id;
      const poses = poseByPair.get(k) || [];
      // Latest pose <= t_chirp via binary search.
      let lo = 0;
      let hi = poses.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (poses[mid].t_server <= t_chirp) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (best < 0) continue;
      const t_pose = poses[best].t_server;
      rows.push(
        [
          csvCell(e.source_client_id),
          csvCell(e.client_id),
          numCell(t_chirp),
          numCell(t_pose),
          numCell(t_chirp - t_pose)
        ].join(",")
      );
    }
    fs.writeFileSync(path.join(this._outDir, "audio-avatar-offset.csv"), rows.join("\n") + "\n");
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
    const rows: string[] = [headers.join(",")];
    for (const e of this._events) {
      if (e.kind !== "rtc-stats") continue;
      const t_server = idx.toServerMs(e.client_id, e.t_client_ms);
      const report = e.report || {};
      for (const [statId, statRaw] of Object.entries(report)) {
        const stat = statRaw as Record<string, unknown>;
        rows.push(
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
    fs.writeFileSync(path.join(this._outDir, "rtc-stats.csv"), rows.join("\n") + "\n");
  }

  private _writeDialog() {
    const headers = ["ts_server_ms", "hostname", "capacity"];
    const rows: string[] = [headers.join(",")];
    for (const s of this._dialogSnaps) {
      rows.push([numCell(s.ts_ms), csvCell(s.hostname), numCell(s.capacity)].join(","));
    }
    fs.writeFileSync(path.join(this._outDir, "dialog.csv"), rows.join("\n") + "\n");
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
    const rows: string[] = [headers.join(",")];
    for (const s of this._hostSamples) {
      rows.push(
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
    fs.writeFileSync(path.join(this._outDir, "host.csv"), rows.join("\n") + "\n");
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
