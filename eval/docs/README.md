# chutvrc Evaluation Harness — Operator Guide

A measurement module for chutvrc that records end-to-end audio latency,
avatar-pose latency, audio↔avatar offset, jitter, and per-stream RTCP-derived
metrics across hosting environment × SFU backend combinations.

The harness is **off by default**. A standard `docker compose up` ships no eval
code and no eval containers; the in-page probe is gated by the URL flag
`?eval=1` and is loaded into its own Webpack chunk.

This guide walks through running one measurement cell. See `figures-to-commands.md`
for tracking which CLI command produced each published figure or table.

## What you choose, what the harness chooses

| Decision | Where it lives | Operator picks |
|---|---|---|
| Hosting environment (laptop / on-prem / cloud) | Where you deploy chutvrc | **You**, manually |
| SFU backend (Dialog / Sora / LiveKit / Cloudflare) | Per-room field in reticulum (`Hub.sfu`) | **You**, via admin panel |
| Bot count | `EVAL_*` env vars when launching `run-bot.js` | **You** |
| Real-device count | How many devices you point at the room | **You** |
| Speaker (one per run) | One bot with `EVAL_SPEAKER=1` or one device with `&mode=speaker` | **You** |
| Everything else (clocks, pairing, CSV output) | The runner + probe | The harness |

The runner does **not** iterate the matrix. Each run is one cell. Label it; run
again after manually reconfiguring; aggregate offline.

## Prerequisites

- chutvrc deployed and reachable (compose or k8s).
- For bot speakers: generate the carrier WAV once: `node eval/assets/generate-chirp.js`.
- For LAN device participation: the runner's WebSocket port must be reachable
  from the devices (set `EVAL_REPORT_HOST` in `.env` to the runner host's
  LAN-reachable hostname/IP).

## One run, end to end

### 1. Pick your cell (manual reconfig)

Stand up chutvrc on the hosting env you want to measure (laptop, on-prem
server, cloud VM, etc.). Create or pick a room. In the hubs-admin panel
(`https://<admin-host>:8989/admin.html`) set the room's SFU to the backend
under test:

| `sfu` value | Backend |
|---|---|
| 0 | Dialog (mediasoup, bundled) |
| 1 | Sora |
| 2 | LiveKit |
| 3 | Cloudflare Realtime |

If the SFU is gated, flip `webrtc-settings|allow_switch_sfu = true` in
ServerConfig once for the duration of the eval. No source change required.

### 2. Start the runner

```bash
docker compose --profile eval -f docker-compose.yml -f docker-compose.eval.yml \
  run --rm --service-ports eval-runner start \
    --label "laptop+dialog+real-devices-only" \
    --room https://hubs.local/<room-sid> \
    --duration 5m \
    --dialog-url http://dialog:7001 \
    --host-stats docker \
    --public-url wss://${EVAL_REPORT_HOST:-hubs.local}:9099
```

The runner prints a real-device join URL on startup; copy or generate a QR
from it. The room and the runner's WebSocket must be reachable from each
participant's network.

### 3. Send participants in

**Real devices**: open the printed URL on each device. Replace `<device>` with
a unique label per tab (e.g., `&label=quest3-haru`, `&label=ipad-tabA`).

**Bot speaker** (exactly one per run; you may choose a real device for this
instead — set `&mode=speaker` in that device's URL):

```bash
EVAL_MODE=1 \
EVAL_REPORT_WS_URL=wss://${EVAL_REPORT_HOST:-hubs.local}:9099 \
EVAL_LABEL=bot-speaker \
EVAL_SPEAKER=1 \
node services/hubs/scripts/bot/run-bot.js \
  -o ${HUBS_HOST:-hubs.local} \
  -r <room-sid> \
  -a eval/assets/chirp-loop.wav
```

**Bot listeners** (load fillers — skip these if you have enough real devices):

```bash
for i in $(seq 1 39); do
  EVAL_MODE=1 \
  EVAL_REPORT_WS_URL=wss://${EVAL_REPORT_HOST:-hubs.local}:9099 \
  EVAL_LABEL=bot-listener-$i \
  node services/hubs/scripts/bot/run-bot.js \
    -o ${HUBS_HOST:-hubs.local} \
    -r <room-sid> \
    -a eval/assets/chirp-loop.wav &
done
```

(Bot listeners still need an audio file — the bot path in hubs blocks waiting
for one. Their chirp injector is OFF because they're in passive mode.)

### 4. Wait, then collect

The runner exits when `--duration` elapses (or on `SIGINT`/`SIGTERM`). CSVs and
`run.json` land in `eval/results/<run_id>/`. See `interpreting-results.md` for
the column legend.

## Mixed real-device + bot pattern (the user's example)

10 devices × 2 tabs (20 passive listeners) + 1 bot speaker + 19 bot listeners
= 40 clients in one room.

```bash
# Speaker
EVAL_MODE=1 EVAL_LABEL=bot-speaker EVAL_SPEAKER=1 \
EVAL_REPORT_WS_URL=wss://<runner-host>:9099 \
node services/hubs/scripts/bot/run-bot.js -o <hubs-host> -r <sid> -a eval/assets/chirp-loop.wav &

# Listener bots
for i in $(seq 1 19); do
  EVAL_MODE=1 EVAL_LABEL=bot-listener-$i \
  EVAL_REPORT_WS_URL=wss://<runner-host>:9099 \
  node services/hubs/scripts/bot/run-bot.js -o <hubs-host> -r <sid> -a eval/assets/chirp-loop.wav &
done

# Real devices: scan the QR / open the URL the runner printed,
# tweaking &label= per device-tab.
```

The aggregator slices by `label` so post-hoc analysis can compare
device classes (`grep ^quest3` vs `grep ^ipad` vs `grep ^bot-`).

## Scaling beyond one machine

A single host running 40 Puppeteer bots uses ~10 GB RAM. For N=80, split bots
across two or more hosts. The bot script is stateless — just SSH the same
for-loop to each host. The runner sees them as ordinary clients keyed by
`label`.

## Per-SFU credentials (LiveKit / Sora / Cloudflare)

Place credentials in `eval/.env.local` (gitignored). Reticulum's existing
`webrtc-settings` consumes them — no extra config in the runner.

For server-side stats availability per SFU, see `interpreting-results.md`.
Client-side `pc.getStats()` is the common-denominator metric source and runs
on every SFU without extra setup.

## Kubernetes deployment

Apply the manifests in `eval/k8s/` after editing the `REPLACE_ME_*` placeholders:

```bash
kubectl apply -f eval/k8s/rbac.yaml
kubectl apply -f eval/k8s/service.yaml
kubectl apply -f eval/k8s/ingress.yaml   # if real devices on the public internet
kubectl create -f eval/k8s/job.yaml      # one-shot run
```

The runner uses `--host-stats k8s` and reads `/metrics/cadvisor` from each
node via the ServiceAccount in `rbac.yaml`. Real devices reach the runner via
`wss://eval.<your-domain>/` (set up by `ingress.yaml`).

## Troubleshooting

**No probe events arrive.** Confirm the room URL contains `?eval=1`. Open the
browser console — the probe logs `[eval] probe enabled mode=…`. If the
`[eval] clock synced` line never appears, the WebSocket is not reaching the
runner — check `EVAL_REPORT_HOST` and firewall.

**Speaker bot doesn't emit chirps.** Confirm `EVAL_SPEAKER=1` is set and that
`chirp-loop.wav` was passed via `-a`. The probe logs `[eval] probe enabled
mode=speaker` if speaker mode is active.

**Multiple speakers warning.** The runner warns at startup if more than one
client connects with `mode=speaker`. Stop the extras; chirp pairing requires
one source.

**Label collision warning.** Two clients connected with the same `&label=`
value. The aggregator will still pair on `client_id`, but result slicing by
label will be ambiguous. Rename one of them.

**Clock-CI exceeds 5 ms.** Network jitter to the runner was too high to nail
down the offset. Re-run on a quieter network or move the runner closer to
the probes (LAN).

**RTC stats fields missing for LiveKit/Sora.** The probe accesses adapter
internals via known field names; if either adapter has been refactored, the
PC list comes back empty. Fix by editing `services/hubs/src/eval/rtc-stats.ts`
`extractPeerConnections()` to match the new field path. All other metrics
still work.

## Confirming the probe is off by default

```bash
# Build hubs.
cd services/hubs && npm run build

# The eval-probe chunk should appear separately:
ls dist/assets/*.js | grep eval-probe

# Open any room URL without `?eval=1` and confirm normal behavior. The probe
# code is never downloaded unless the flag is present.
```
