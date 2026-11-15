# Client tests for the fixes: before and after

What the tests that the fixes must pass did on the code as it was before any fix (the hubs working copy as the stack built it, branch `feature/client-tests`, avatar re-announce workaround off with `AVATAR_REANNOUNCE=0`). The "After the fixes" column is filled in when the fixes have landed and the same runs are repeated.

Evidence is under `D:\chutvrc-e2e\evidence\<run id>\` (`report.html` in each run folder).

## Status of the before-runs (paused, not finished)

The runs were paused by instruction before they were complete. Done, to do, and OBS recording:

| Run id | Block | Test | Planned | Done | OBS recording |
| --- | --- | --- | --- | --- | --- |
| `fixes-before-dialog` | Dialog | T1 smoke | 10 | 7 (repetitions 1 to 7) | all 7 recorded |
| `fixes-before-dialog` | Dialog | T2.2 | 5 | 0, to do | not applicable yet |
| `fixes-before-dialog` | Dialog | T2.2b | 3 | 0, to do | not applicable yet |
| `fixes-before-dialog` | Dialog | T4.5 | 3 | 0, to do | not applicable yet |
| `fixes-before-livekit-local` | LiveKit, local server | T2.2 | 5 | 0, to do | not applicable yet |
| `fixes-before-livekit-local` | LiveKit, local server | T2.2b | 3 | 0, to do | not applicable yet |
| `fixes-before-livekit-local` | LiveKit, local server | T2.6 (LiveKit to LiveKit, Dialog to LiveKit) | 3 each | 0, to do | not applicable yet |
| `t22b-try` | Dialog | T2.2b, one trial run before the baseline | 1 | 1 | recorded |
| `t22b-try-lk` | LiveKit, local server | T2.2b, one trial run before the baseline | 1 | 1 | recorded |

OBS recording was switched off for everything started after the instruction (`E2E_OBS=0` in `.env.local`): that applies to every run still to do. The seven T1 runs and the two T2.2b trial runs were made before that and have `obs.mp4` files. The OBS WebSocket did not answer (connection refused) when checked after the pause, so OBS was not recording. The T1 run that was in progress when the instruction came was left to finish; the next one had started its folder but was stopped within seconds and its empty folder was removed.

Nothing was run that failed for an environmental reason (no browser crash, no socket error), so there are no reruns to count.

## Before the fixes

"Runs" is runs done of runs planned. A failure means the check did not hold.

| Test | Media block | Runs | Failures | Key numbers | Evidence | After the fixes |
| --- | --- | --- | --- | --- | --- | --- |
| T1: the other's avatar is drawn (per run, per client) | Dialog | 7 of 10 | 7 of 7 runs: neither client drew the other's avatar (A drew 0 and B drew 0 other avatars in every run) | both clients held the other's pose (1 and 1) in all 7 runs while no model was loaded; the avatar announcement went out before the data channel was open in most runs | `fixes-before-dialog\t1-smoke-dialog`, `...-repeat2` to `...-repeat7` | |
| T1: two-way audio (one-way audio check) | Dialog | 7 of 10 | 0 of 7 | each side heard the other's pilot in every run (0.12 to 0.31, heard at 0.1 or more); no one-way audio seen yet; the weakest was A hearing B in repetition 6 (0.12) | same | |
| T1: mute and unmute with the Voice button (not part of the fix list, seen on the way) | Dialog | 7 of 10 | 1 of 7 (repetition 1) | in repetition 1 the first click did nothing (button on, `isMicEnabled` true, B still hears A), the second click muted; A logged "Tried to toggle mic but there's no producer." in that run, in the other six it did not and the click worked | `fixes-before-dialog\t1-smoke-dialog` | |
| T1: room move through an in-world link | Dialog | 7 of 10 | 1 of 7 (repetition 7) | in repetition 7 a client did not report the new room within 30 s | `...\t1-smoke-dialog-repeat7` | |
| T2.2: first click mutes; button, state and what is heard agree before muting | Dialog | 0 of 5, to do | | | | |
| T2.2: the same | LiveKit, local server | 0 of 5, to do | | | | |
| T2.2b: muted at entry is not heard (decides whether entering muted is live today) | Dialog | 0 of 3, to do; trial: 1 run | trial: 0 of 1 | trial run: the Voice button showed muted and `isMicEnabled` was false right after entry; over 10 s B detected no pilot and received 0 audio packets from A (0 per second); after unmuting with the button the pilot was back 724 ms after the click | `t22b-try\t2.2b-dialog` | |
| T2.2b: the same | LiveKit, local server | 0 of 3, to do; trial: 1 run | trial: 0 of 1 | trial run: muted button and `isMicEnabled` false right after entry; 0 detections and 0 packets in 10 s; pilot back 321 ms after the click | `t22b-try-lk\t2.2b-livekit-local` | |
| T2.6: audio back after the LiveKit to LiveKit move; microphone state after it | LiveKit, local server | 0 of 3, to do | | | | |
| T2.6: Dialog to LiveKit move | LiveKit, local server | 0 of 3, to do | | | | |
| T4.5: late joiner gets model and pose | Dialog | 0 of 3, to do | | | | |

### What T2.2b showed so far

On both Dialog and LiveKit (local server), one trial run each: entering muted through the Mute toggle of the microphone setup step is not live. The client is silent for the first ten seconds (no pilot detected, no audio packets received by the other client), and unmuting with the toolbar button makes it audible within a second. So on current code a muted entry holds in these runs, in spite of the expectation that Dialog's producer might start sending. The planned three runs per block have not been done; one run each is a trial, not a baseline, and the conclusion stands only once they are in.

## How the muted entry is driven

`clients/enter.ts`, option `enterMuted`: after the microphone setup step is shown, the checkbox with the accessible name "Mute" (`getByRole("checkbox", { name: "Mute", exact: true })`, the `ToggleInput` of `MicSetupModal.js`) is switched through its label, since the checkbox itself is 0 x 0 and transparent. The client stores the choice as the `muteMicOnEntry` preference of the profile, so the test puts it back to `false` when it ends (`setMuteOnEntryPreference`).

## Commands still to run when testing resumes

From `e2e/`, with `AVATAR_REANNOUNCE=0` (OBS off comes from `.env.local`). The T1 repetitions continue as 8 to 10 into the same folders with `E2E_REPEAT_OFFSET=7`.

```bash
export AVATAR_REANNOUNCE=0
E2E_REPEAT_OFFSET=7 E2E_RUN_ID=fixes-before-dialog MEDIA_BLOCK=dialog npx playwright test suites/t1-smoke --repeat-each 3 -g "T1 smoke on Dialog"
E2E_RUN_ID=fixes-before-dialog MEDIA_BLOCK=dialog npx playwright test suites/t2-audio --repeat-each 5 -g "T2\.2 "
E2E_RUN_ID=fixes-before-dialog MEDIA_BLOCK=dialog npx playwright test suites/t2-audio --repeat-each 3 -g "T2\.2b "
E2E_RUN_ID=fixes-before-dialog MEDIA_BLOCK=dialog npx playwright test suites/t4-avatar-sync --repeat-each 3 -g "T4\.5 "
E2E_RUN_ID=fixes-before-livekit-local MEDIA_BLOCK=livekit-local npx playwright test suites/t2-audio --repeat-each 5 -g "T2\.2 "
E2E_RUN_ID=fixes-before-livekit-local MEDIA_BLOCK=livekit-local npx playwright test suites/t2-audio --repeat-each 3 -g "T2\.2b "
E2E_RUN_ID=fixes-before-livekit-local MEDIA_BLOCK=livekit-local npx playwright test suites/t2-rooms --repeat-each 3 -g "T2\.6 room move (LiveKit to LiveKit|Dialog to LiveKit)"
```

Each invocation rebuilds the run's `report.html`; the LiveKit block switches the server setting and puts it back to `unset` at the end of each invocation. Check that C: has more than 5 GB free before starting and stop below 3 GB. A run that fails for an environmental reason (a browser crash, a socket error such as ERR_NO_BUFFER_SPACE) gets one rerun and is counted separately.
