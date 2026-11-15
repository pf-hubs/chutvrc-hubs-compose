# Client tests for the fixes: before and after

What the tests that the fixes must pass did on the code as it was before any fix (the hubs working copy as the stack built it, branch `feature/client-tests`, avatar re-announce workaround off with `AVATAR_REANNOUNCE=0`). The "After the fixes" column is filled in when the fixes have landed and the same runs are repeated.

Evidence is under `D:\chutvrc-e2e\evidence\<run id>\` (`report.html` in each run folder).

## The runs

| Run id | Code | Block | Tests |
| --- | --- | --- | --- |
| `fixes-before-dialog` | hubs `290b6aa86`, before any fix (bundle `hub-53c32530...`) | Dialog | T1 x10, T2.2 x5, T2.2b x3, T4.5 x3 |
| `fixes-before-livekit-local` | the same | LiveKit, local server | T2.2 x5, T2.2b x3, T2.6 LiveKit to LiveKit x3, T2.6 Dialog to LiveKit x3 |
| `t22b-try`, `t22b-try-lk` | the same | Dialog; LiveKit, local server | T2.2b, one trial run each before the baseline |
| `fixes-after-dialog` | hubs `904416c86`, the fixes merged (bundle `hub-3f124130...`) | Dialog | T1 x10, T2.2 x5, T2.2b x3, T4.5 x3, T4.6, T2.10, T4.11, T2.15 with bots (10 minutes), T4.12 |
| `fixes-after-livekit-local` | the same | LiveKit, local server | T1 x3, T2.2 x5, T2.2b x3, T2.6 both moves x3, T2.7, T2.8, T4.5 x3 |

All with the avatar re-announce workaround off (`AVATAR_REANNOUNCE=0`). OBS recorded T1 repetitions 1 to 7 of the before-run and the two trials only; everything else ran with `E2E_OBS=0`. The LiveKit setting was `unset` during the Dialog runs and is put back to `unset` after the LiveKit runs.

Failures for an environmental reason in the before-runs, not rerun because the code under test has changed since: T2.6 Dialog to LiveKit repetition 3 (the Playwright worker exited with code 3221225794 before the test started), and T2.2 on LiveKit repetitions 3 and 5 (B could not enter: the local LiveKit server answered 500 to the signal WebSocket, "Unable to connect to this room").

## Before the fixes

"Runs" is runs done of runs planned. A failure means the check did not hold.

| Test | Media block | Runs | Failures | Key numbers | Evidence | After the fixes |
| --- | --- | --- | --- | --- | --- | --- |
| T1: the other's avatar is drawn (per run, per client) | Dialog | 10 of 10 | 10 of 10 | A drew B's model in 0 of 10 runs, B drew A's in 1 of 10 (repetition 10). Both held the other's pose in repetitions 1 to 8 (no model loaded); in 9 B held none of A's, in 10 A none of B's (see one-way below). A send before the channel was open in every run: `#avatarId` in 7 of 10 runs, poses in 9 of 10 (A sent 1160 poses on a channel that never opened in repetition 9) | `fixes-before-dialog\t1-smoke-dialog`, `...-repeat2` to `...-repeat10` | AFTER-T1-AVATAR |
| T1: two-way audio (one-way audio check) | Dialog | 10 of 10 | 2 of 10 | one-way in repetition 9 (B heard A at 0, A heard B at 0.28; A's data channel never opened either) and repetition 10 (A heard B at 0, B heard A at 0.34; A received no pose from B); the others 0.12 to 0.34 both ways. One-way media on Dialog is a known finding outside the fixes (3, 21) | `...\t1-smoke-dialog-repeat9`, `...-repeat10` | AFTER-T1-AUDIO |
| T1: mute and unmute with the Voice button | Dialog | 10 of 10 | 2 of 10; 1 a mute failure | repetition 1: the first click did nothing (button on, `isMicEnabled` true, B still heard A at 0.26), A logged "Tried to toggle mic but there's no producer."; repetition 9 failed only because B never heard A (one-way) | `...\t1-smoke-dialog` | AFTER-T1-MUTE |
| T1: room move through an in-world link | Dialog | 10 of 10 | 1 of 10 (repetition 7), harness | B's click on "visit room" did not start a move: B saw the link edge-on from far away (a thin line under the cursor in `shot-09-B-member1-at-end.png`), and B's console has no room load after the click (in the other runs `Loading model .../v8jQygd/objects.gltf` follows within a second), so `APP.hub.hub_id` never changed and the 30 s wait timed out | `...\t1-smoke-dialog-repeat7` | AFTER-T1-MOVE |
| T2.2: first click mutes; button, state and what is heard agree | Dialog | 5 of 5 | 4 of 5 | the first click muted (button and `isMicEnabled` followed) in all 5; repetitions 1 to 3 failed because B never heard A at all, before muting and after unmuting (0 packets: one-way, not the toggle); repetition 4 ran at 46 fps (invalid) and the pilot lasted 1607 ms after the click; repetition 5 passed (unmute heard after 2151 ms) | `fixes-before-dialog\t2.2-dialog`, `...-repeat2` to `...-repeat5` | AFTER-T22-D |
| T2.2: the same | LiveKit, local server | 5 of 5 | 5 of 5 | in the 3 runs where both entered, before muting the button showed muted while `isMicEnabled` was true and B heard A (0.27 to 0.29): the button disagreed, so the first click muted a microphone shown as muted; repetitions 3 and 5: B could not enter (LiveKit server 500, environmental) | `fixes-before-livekit-local\t2.2-livekit-local`, `...-repeat2` to `...-repeat5` | AFTER-T22-L |
| T2.2b: entered muted is not heard | Dialog | 3 of 3 (and 1 trial) | 1 of 3 | entering muted was not heard in any run: 0 pilot detections and 0 audio packets at B over 10 s, button muted and `isMicEnabled` false right after entry. Unmuting was heard after 545 and 1185 ms; in repetition 3 not at all (B's track of A stayed muted, 0 packets), which failed the run | `fixes-before-dialog\t2.2b-dialog`, `...-repeat2`, `...-repeat3`; trial `t22b-try\t2.2b-dialog` | AFTER-T22B-D |
| T2.2b: the same | LiveKit, local server | 3 of 3 (and 1 trial) | 0 of 3 | entering muted was not heard in any run (0 detections, 0 packets in 10 s); unmute heard after 693, 373 and 364 ms | `fixes-before-livekit-local\t2.2b-livekit-local`, `...-repeat2`, `...-repeat3`; trial `t22b-try-lk\t2.2b-livekit-local` | AFTER-T22B-L |
| T4.5: a late joiner gets model and pose within 3 s | Dialog | 3 of 3 | 2 of 3 | repetition 1: pose after 532 ms, model after 2181 ms; repetition 2: pose after 7 ms, model not within 15 s; repetition 3: neither within 15 s (and A logged "Tried to toggle mic but there's no producer."). B, entered with A, drew no model for A in all 3 | `fixes-before-dialog\t4.5-dialog`, `...-repeat2`, `...-repeat3` | AFTER-T45-D |
| T2.6: LiveKit to LiveKit move: audio back, microphone state | LiveKit, local server | 3 of 3 | 3 of 3 | repetitions 1 and 2: both moved in 0.6 to 0.7 s, but audio never came back and both microphones ended "live but disabled" (the move ended muted); A logged `UnexpectedConnectionState: PC manager is closed`; repetition 3: no "visit room" button showed (harness) | `fixes-before-livekit-local\t2.6-livekit-to-livekit-livekit-local`, `...-repeat2`, `...-repeat3` | AFTER-T26-LL |
| T2.6: Dialog to LiveKit move | LiveKit, local server | 3 of 3 | 1 of 3, environmental | repetitions 1 and 2: audio back after 789 to 1059 ms, both microphones live; repetition 3: the worker process crashed before the test began | `fixes-before-livekit-local\t2.6-dialog-to-livekit-livekit-local`, `...-repeat2`, `...-repeat3` | AFTER-T26-DL |

### What the before-runs showed

- **Avatar announcement (F2).** Without the workaround, two clients that enter together on Dialog almost never draw each other's model (1 of 20 client views), although the poses arrive. The single `#avatarId` at entry is often sent before the data channel is open.
- **Microphone (F1).** On Dialog the first Voice click failed once in 10 T1 runs. On LiveKit the Voice button shows muted while the microphone sends, in every run that entered. A move between two LiveKit rooms ends with both microphones disabled and no audio, in both runs that got that far.
- **Entering muted (T2.2b).** Entering muted held on both servers in all six runs and the two trials: nobody heard the client before it unmuted. The expectation that Dialog's producer might start sending was not borne out on this PC; the fix covers the case regardless.
- **Late joiner (T4.5).** The late joiner got A's model in time in 1 of 3 runs on Dialog.
- One-way media on Dialog (outside the fixes) showed in 2 of 10 T1 runs and 3 of 5 T2.2 runs.

## How the muted entry is driven

`clients/enter.ts`, option `enterMuted`: after the microphone setup step is shown, the checkbox with the accessible name "Mute" (`getByRole("checkbox", { name: "Mute", exact: true })`, the `ToggleInput` of `MicSetupModal.js`) is switched through its label, since the checkbox itself is 0 x 0 and transparent. The client stores the choice as the `muteMicOnEntry` preference of the profile, so the test puts it back to `false` when it ends (`setMuteOnEntryPreference`).
