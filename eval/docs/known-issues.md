# Known issues / things to fix before measured cells

Investigation list discovered while bringing up the §2.4 smoke. **None of these
block the smoke from passing** (Step 3 + Step 4 acceptance criteria are met),
but each can bias or invalidate the numbers in a measured cell. Resolve before
running anything from `figures-to-commands.md`.

## 1. Chirp emit↔detect pairing offset (~1.5 s)

**Symptom.** In the 2026-05-19T09-06-19-399Z_smoke run, every row of
`chirp-pairs.csv` has `latency_ms` ≈ 1.8 s (mean 1,831; stdev 47; range
1,768–1,992). Local WebRTC + Goertzel detection latency should sit in the
100–300 ms band, not near 1.8 s.

**Hypothesis.** 1.8 s ≈ `CHIRP_INTERVAL_MS` (1,500 ms) + one Goertzel block
(~21 ms) + small jitter. Most likely the aggregator is matching each
`chirp-emit seq=k` to the listener's `chirp-detect` event from `seq=k+1`,
shifting every pair by one full chirp interval.

**Where to look.** `eval/runner/src/aggregator.ts` — chirp pairing routine.
Check whether matching is by (`seq`, `speaker_client_id`) or by temporal
proximity. If it's purely temporal, the missed first detect of each speaker
session would shift everything by one.

**Verify with.** Add a temporary log of `(emit_seq, detect_seq_implied,
t_detect - t_emit)` in the aggregator; for a well-formed run all rows should
land in the 100–300 ms band.

**Blast radius.** Every audio-latency number derived from `chirp-pairs.csv`
is inflated by ≈ 1.5 s. SFU-to-SFU **deltas** survive (the bias is constant),
but absolute claims do not.

## 2. `audio-avatar-offset.csv` inherits issue #1

**Symptom.** `offset_ms` mean = 35,449; range 213 – 70,640 ms (~35 s mean,
~70 s max). Lip-sync offsets should be in the ±100 ms range.

**Root cause.** Same as #1. The offset column joins `chirp-pairs` with the
nearest preceding `#avatar-HEAD` recv; if chirp times are off by ~1.5 s, the
preceding-pose match cascades into nonsense.

**Action.** No separate fix — falls out of #1 once chirp pairing is correct.
Re-validate with a smoke run after #1 lands.

## 3. Detection magnitudes near the silence floor

**Symptom.** `chirp-pairs.csv.magnitude` clusters around 0.02–0.14, with many
rows at ~0.02 — just above `DETECT_MIN_MAGNITUDE = 0.01` in
`services/hubs/src/eval/audio-chirp.ts`.

**Why it matters.** A consistently weak detection signal means the *first*
chirp of each session probably misses the threshold and the bin alignment
slips — which is one mechanism that could produce issue #1.

**Where to look.** Possibly:

- Goertzel coefficient targets bin 23 at 44.1 kHz (= 990.7 Hz). Off-center by
  ~9 Hz — within bin width (~43 Hz) but spectral leakage halves the peak
  magnitude. Consider window-aligning the chirp burst to integer bin
  frequency at typical browser sample rates (48 kHz → exact bin at 1 kHz;
  44.1 kHz → use 990.7 Hz instead of 1,000 Hz, or use Hann-windowed Goertzel).
- `CHIRP_GAIN = 0.3` injected post-mic. WebRTC's auto-gain/echo-cancel can
  attenuate this further before it reaches the listener. Consider injecting
  BEFORE going through the audio constraints, or disabling AGC on the speaker
  bot via `getUserMedia` constraints.
- `DETECT_THRESHOLD_FACTOR = 4` may be too high when the broadband noise floor
  is itself low; consider also requiring an absolute peak above a tuned
  constant.

## 4. `pose-pairs.csv` channel coverage

**Symptom.** `#avatar-RIG` n=9,817 (healthy). `#avatar-HEAD`,
`#avatar-LEFT`, `#avatar-RIGHT` each n=5 — extremely sparse.

**Hypothesis.** These channels only fire when the avatar's head/hands
*change* (e.g., XR pose updates), and the laptop+headless-bot smoke has no
real head/hand motion. Expected behaviour for the smoke; needs re-confirmation
once a measured cell with real devices is run.

**Action.** Note only. No code fix.

**Verification.** First measured cell that includes a real headset device
should produce HEAD/LEFT/RIGHT row counts comparable to the device's pose
update rate × duration.

## 5. Listener clock-CI occasionally > 5 ms

**Symptom.** Across smoke runs the laptop probe has shown `clock_ci_ms`
oscillating between 1 and 9.45 ms. The 9.45 reading came from a run where
`clock_offset_samples = 2` (one fewer round than usual).

**Hypothesis.** The clock-sync warm-up does N rounds at startup; if the
runner is busy mid-handshake (or the WS jitter spikes once), one round can
be missed and the median-of-N is computed from a thinner sample.

**Where to look.** `services/hubs/src/eval/clock-sync.ts`. Consider:

- More sync rounds at startup (currently 3-ish?), or
- Re-validate every N seconds rather than once-and-done so a single bad round
  doesn't dominate, or
- Reject runs at aggregation time where `clock_offset_samples < 3` rather
  than just including them with high CI.

**Blast radius.** A 9 ms CI means ±9 ms uncertainty added to every latency
row from that client. For pose-pairs (mean 56 ms, stdev 45 ms) this dilutes
SFU-to-SFU deltas. For chirp-pairs (currently dominated by issue #1) it's
noise in the noise.

---

## Cross-references

- Smoke run that exposed all of the above: `eval/results/results/2026-05-19T09-06-19-399Z_smoke/`
- Source files most likely involved: `eval/runner/src/aggregator.ts`,
  `services/hubs/src/eval/audio-chirp.ts`, `services/hubs/src/eval/clock-sync.ts`.
- Manual sections to consult: §2.4 (smoke acceptance), §5 (troubleshooting), `interpreting-results.md` (chirp/pose schemas).
