# Figures &amp; Tables → Runner Commands

A tracking sheet for reproducibility. Every figure or summary table you produce
from this evaluation should be traceable back to the exact CLI invocation that
generated its source CSVs, plus the chutvrc git rev at the time. Fill in rows
as runs complete.

## How to add an entry

After running a cell, paste the CLI command verbatim and record:
- `chutvrc_rev`: output of `git rev-parse HEAD` inside `chutvrc-hubs-compose`
- `runner_image_tag`: output of `docker images chutvrc-eval-runner --format '{{.ID}}'`
- `result_dir`: the produced `eval/results/<run_id>/`

## Per-SFU latency at fixed N

(Template — fill values when the run is executed.)

| ID | Hosting | SFU | N | Duration | Command | Result dir |
|---|---|---|---|---|---|---|
| A1 | laptop | Dialog | 20 | 5m | `…runner start --label "A1-laptop-dialog-N20" --room … --duration 5m --dialog-url http://dialog:7001 --host-stats docker` | `eval/results/<run_id>/` |
| A2 | laptop | LiveKit | 20 | 5m | … | … |
| A3 | laptop | Sora | 20 | 5m | … | … |
| A4 | laptop | Cloudflare | 20 | 5m | … | … |

## Scalability sweep (latency vs N)

| ID | Hosting | SFU | N | Duration | Command | Result dir |
|---|---|---|---|---|---|---|
| B1 | server | Dialog | 5 | 5m | … | … |
| B2 | server | Dialog | 10 | 5m | … | … |
| B3 | server | Dialog | 20 | 5m | … | … |
| B4 | server | Dialog | 40 | 5m | … | … |
| B5 | server | Dialog | 80 | 5m | … | … |

(Add additional rows for cross-SFU scaling if your matrix expands.)

## Audio↔avatar offset

Source: `audio-avatar-offset.csv` from the per-SFU runs above (no extra data
collection needed).

## Server resource utilization

Source: `host.csv` and `dialog.csv` from the scalability runs above.

---

When all rows are filled, commit this file alongside the CSV directories so the
data trail behind your reported numbers is auditable.
