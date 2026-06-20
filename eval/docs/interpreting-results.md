# Interpreting Results

Each run lands at `eval/results/<run_id>/` and contains:

| File | What it is |
|---|---|
| `run.json` | Manifest: label, duration, git rev, per-client metadata, clock CIs, warnings. |
| `probe-events.csv` | All probe events (avatar-send/recv, chirp-emit/detect, rtc-stats), one row per event. |
| `pose-pairs.csv` | Joined avatar send↔recv pairs. **Primary RQ1/RQ2 latency table.** |
| `chirp-pairs.csv` | Joined audio chirp emit↔detect pairs. **Primary audio-latency table.** |
| `audio-avatar-offset.csv` | Audio-to-avatar synchronization offset per (speaker, listener) at every chirp. |
| `rtc-stats.csv` | Per-stream RTCPeerConnection.getStats samples (jitter, RTT, loss, bitrate). |
| `dialog.csv` | Dialog `/report` snapshots (capacity, hostname) — empty if `--dialog-url` not set. |
| `host.csv` | Container CPU/memory/network samples from Docker socket or k8s cAdvisor. |

## Time conventions

All time columns are **server-time milliseconds** (Unix epoch ms) unless
otherwise noted. The aggregator converts each event's local `t_client_ms`
to server time using the client's clock-offset trajectory (linear interpolation
across re-validations). `run.json` records each client's median clock-CI.

Two columns retain raw client time for debugging:
- `probe-events.csv`: `t_client_ms` (probe-local `performance.now()`).

## `pose-pairs.csv`

| Column | Meaning |
|---|---|
| `from_client_id` | The sender's chutvrc client_id. |
| `recv_client_id` | The receiver's chutvrc client_id. |
| `channel` | DataChannel label: one of `#avatar-RIG`, `#avatar-HEAD`, `#avatar-LEFT`, `#avatar-RIGHT`. |
| `seq` | Per-(sender, channel) ordinal index. |
| `t_send_server_ms` | Server-time of the send event. |
| `t_recv_server_ms` | Server-time of the recv event at this receiver. |
| `latency_ms` | `t_recv - t_send`. |

**RQ1 jitter**: per (from, recv, channel), take the `latency_ms` column and
compute `std` and `quantile(0.95)`.

**RQ2 scalability**: plot median `latency_ms` (across all sender-receiver
pairs in a run) vs the number of connected clients.

**Note on Web Audio injection bias**: speaker's MediaStreamAudioDestinationNode
adds 5–20 ms (constant per browser). This bias inflates absolute audio
latency, but is constant across SFUs and therefore does not affect SFU-to-SFU
comparisons.

## `chirp-pairs.csv`

| Column | Meaning |
|---|---|
| `speaker_client_id` | Always the one client with `mode=speaker` in this run. |
| `listener_client_id` | The detecting listener. |
| `seq` | Speaker's chirp sequence index. |
| `t_emit_server_ms` | Speaker emit time. |
| `t_detect_server_ms` | Listener detection time. |
| `latency_ms` | End-to-end audio latency (with the documented Web Audio bias). |
| `magnitude` | Goertzel filter magnitude at detection — sanity-check field. |

**Quality filter**: drop rows with `magnitude < 0.01` (silence-floor false
positives are rare but possible). The probe enforces `magnitude > 0.01` and
a refractory window before logging.

## `audio-avatar-offset.csv`

Audio↔avatar synchronization measured with a **coincident HEAD "slate"**: at each audio
chirp the speaker also broadcasts exactly one discrete `#avatar-HEAD` pose packet (the bot's
head is otherwise static, so every `#avatar-HEAD` packet is one slate). For each chirp the
runner pairs, at a given listener, the chirp detection with the HEAD packet from the **same
slate** (linked sender-side by `head-slate-emit`). This compares the audio and avatar paths
against a *shared sender instant*, rather than against a free-running pose stream.

| Column | Meaning |
|---|---|
| `speaker_client_id` | The `mode=speaker` client. |
| `listener_client_id` | The detecting listener. |
| `chirp_seq` | Speaker's chirp sequence index for this slate. |
| `head_send_seq` | Per-channel send index of the slate's `#avatar-HEAD` packet. |
| `t_chirp_emit_ms` | Speaker emit time of the chirp (server-time). |
| `t_head_send_ms` | Speaker emit time of the coincident HEAD packet (server-time). |
| `t_chirp_detect_ms` | Time the chirp was detected at the listener. |
| `t_head_recv_ms` | Time the slate's HEAD packet arrived at the listener. |
| `offset_ms` | `t_chirp_detect_ms - t_head_recv_ms`. Signed: positive = audio lags the head move. |

A positive value means the listener saw the speaker's avatar head move before hearing the
corresponding sound; negative means the audio arrived first. Because both
`t_chirp_detect_ms` and `t_head_recv_ms` are measured on the **same listener**, `offset_ms`
is a within-client difference and is immune to cross-machine clock-sync error. The
sender-side `t_chirp_emit_ms` / `t_head_send_ms` columns (clock-converted) let you also
derive the one-way audio vs. head latencies and the emit-corrected differential.

The HEAD slate packets also appear in `pose-pairs.csv` under channel `#avatar-HEAD` (one-way
HEAD transport latency), 1:1 with the chirps. Tracks "lip-sync" quality between rooms and SFUs.

## `rtc-stats.csv`

Per-stream WebRTC stats sampled at 1 Hz client-side, filtered to the fields
we care about:

| Column | Meaning |
|---|---|
| `t_server_ms` | When the stats were sampled. |
| `client_id` | Whose pc.getStats() this is. |
| `peer_kind` | `send` (publisher PC) or `recv` (subscriber PC) or `unknown`. |
| `stat_id` | Stat report identifier (one row per stat object). |
| `stat_type` | One of `inbound-rtp`, `outbound-rtp`, `candidate-pair`, etc. |
| `kind` | `audio` / `video` (for RTP stats). |
| `jitter` | Inbound RTP jitter (seconds). |
| `currentRoundTripTime` | candidate-pair RTT (seconds). |
| `bytesSent` / `bytesReceived` | Cumulative byte counts. |
| `packetsLost` | Cumulative packet loss. |
| `availableOutgoingBitrate` / `availableIncomingBitrate` | If reported. |

Compute σ and p95 over the `jitter` column per
(client_id, peer_kind, stat_id) time-series to summarize jitter behavior of
each peer-stream over the run.

## `host.csv` and `dialog.csv`

Server-side resource utilization. CPU is reported per-second-sample (Docker
mode) or as cumulative seconds (k8s/cAdvisor mode — aggregator does not diff
for you; do it in your analysis). Memory and network are absolute byte counts.

For SFUs other than Dialog, the server-side capacity column may be empty —
per-stream metrics come from `rtc-stats.csv` instead.

## Per-SFU stats availability

| SFU | `dialog.csv` | `rtc-stats.csv` |
|---|---|---|
| Dialog | populated (server capacity) | populated (client-side per-stream) |
| Sora | empty (use Sora admin API separately) | populated |
| LiveKit | empty (use LiveKit Server SDK separately) | populated |
| Cloudflare Realtime | empty | populated |

`rtc-stats.csv` is the always-available common denominator. The optional
`livekit-poll`/`sora-poll` enrichments can be added later without changing the
CSV schema (they would extend `dialog.csv` with an `sfu_kind` column).

## Combining many runs

Each cell in your (hosting × SFU) matrix is a separate run with its own
`run.json` and CSVs. To combine:

```python
# example pandas snippet
import pandas as pd, glob, json
rows = []
for runjson in glob.glob("eval/results/*/run.json"):
    m = json.load(open(runjson))
    cell = {"label": m["label"], "run_id": m["run_id"]}
    df = pd.read_csv(runjson.replace("run.json", "pose-pairs.csv"))
    rows.append({**cell, **{
        "median_latency_ms": df["latency_ms"].median(),
        "p95_latency_ms": df["latency_ms"].quantile(0.95),
        "jitter_std_ms": df["latency_ms"].std()
    }})
print(pd.DataFrame(rows))
```

`figures-to-commands.md` is a tracking sheet for recording the exact CLI
invocation + git rev that produced each published figure or table.
