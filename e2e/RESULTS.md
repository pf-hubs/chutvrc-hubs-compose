# Results of the full run (plan step 9)

One run of every suite per media server block on this PC, without product fixes. The consolidated report, with the matrix, the checklist coverage, the findings, a gallery and links to every test's evidence, is `final/index.html` in the evidence directory (`D:\chutvrc-e2e\evidence\final\index.html` on this PC), built by `report/build-summary.ts`. Each block's own report is `report.html` in its run folder.

The run did not finish. The brief's rule is to keep at least 2 GB free on C:, and to stop and report if it gets lower. Free space fell under 2 GB twice, both times while seven or eight clients ran at once. The first time was in the last test of the Dialog run; the second was in T4.12 on LiveKit Cloud, when it dropped to 0.25 GB for a moment. After the second time no further tests were run. What was left out is listed at the end.

## The runs

| Block | Run folder | When (UTC+9) | What it holds |
| --- | --- | --- | --- |
| Dialog | `final-dialog` | 2026-11-15 09:26 to 12:02 | T0 first; one pass of every suite, stopped by the C: watchdog in the closing phase of T7.7, its last test; the soak run again at the end with the 4 DESK clients only, because the bots kept it from forming |
| LiveKit, local server | `final-livekit-local` | 12:02 to 13:34 | one pass of every suite; the soak failed on its bots, and its run with the DESK clients only was not made |
| LiveKit Cloud | `final-livekit-cloud` | 13:34 to 14:07 | every LiveKit test except the soak, as the brief asks (none needs a server restart: T2.9 takes one client offline for 10 s instead); stopped by the C: watchdog during T4.12, so T5, T6 and T7 did not run |

Under test, the same in all three runs: hubs `feature/client-tests` `290b6aa86` (`feature/avatar-refactor` plus the offline tests), reticulum `feature/upstream-merge-2026-11` `1dca9654` (with its local certificate changes only), spoke `feature/upstream-merge-2026-11` `cde518a9`, dialog `develop` `43468d6`. The harness ran from compose `feature/client-tests` `ecf5527` plus the changes committed with this file. Browsers: Edge 157.0.4341.46, Chromium 159.0.8154.6, Playwright 1.65.1, and Playwright's Linux WebKit for the IOS profiles.

The PC has a Ryzen 5 3600 (12 threads), 48 GB of RAM and a Radeon RX 6800. Also running, during every run and never stopped: the Unity editor 2022.3.22f1 with a project open (about 2 GB, mostly idle, about 4% of one core), the VRChat Creator Companion, Meta Quest Link, the Virtual Desktop service, Steam and OBS. Docker's WSL machine held about 19 GB. CPU load was 60 to 80% on average and often 100%. OBS's screen capture source rendered black and its desktop audio was silent, so the OBS recordings have no picture or sound. The per-client videos and the audio measurements are unaffected.

What took the space on C: two things, both outside the harness's folders. First, the page file on C: grows while RAM runs out: free RAM fell to 1.3 GB in the Dialog T7.7, the page file stood at 19.5 to 20 GB when it was checked later, and that first drop came back once the browsers closed. Second, when the WebKit client's web process crashed in the `netclient` container at the end of the local T7.7, WSL wrote a 3.1 GB crash dump into the user's TEMP folder. That dump was moved to `final-livekit-local-attempts` on D: afterwards, which brought C: back to 6.5 GB. What took about 3 GB for a moment during the Cloud T4.12 was not found. The watchdog sampled every 10 s, but under full CPU load its samples came 40 s apart.

What changed in the harness for this run (committed with this file):

- `suites/server-clock.ts` measures reticulum's clock again during a run and restarts reticulum when it is more than 45 s behind. Under load the clock fell 1 to 4 s a minute behind, which would have locked every client out of the rooms after about 90 minutes. Reticulum was restarted several times per run.
- `SOAK_BOTS=0` runs the soak with the DESK clients only.
- T7.3 to T7.7 now run on LiveKit Cloud too.
- The mixed room with the bots runs only with `T7_MIXED_WITH_BOTS=1`.
- T6.7's checks now name the checklist items N2 to N5 as the checklist numbers them; they were one item off.
- The soak's sequence-wrap check now fails when the avatars did not move at the end.
- The reporter keeps a skip reason in `result.json` also when the evidence fixture already wrote the test as skipped.
- `report/preflight.ts` records T0 in a run, and `report/build-summary.ts` with `report/summary-data.ts` builds the consolidated report.

## T0

| Part | Result |
| --- | --- |
| Containers | 14 of 14 running; every health check passes except reticulum's: its image probes `localhost:4000`, which is `::1` in the container, where the dev server does not listen. The API answers 200 |
| client `lint:js` | NG: 54 errors (50 `no-unused-vars`, 2 `missing-formatted-message`, 1 `prettier/prettier`, 1 `no-dupe-keys`), the same as in steps 2 and 5. 53 are already on develop; the duplicate `optimization` key in `webpack.config.js` came with the upstream intake |
| admin `lint:js` | NG: 2 `no-unused-vars` in `admin/webpack.config.js`, also on develop |
| `lint:html`, client and admin | pass |
| client `test:unit` | 29 pass, 0 fail, 1 known failure (`test.failing`, #22) |
| client `build`, admin `build` | pass: "compiled with 3 warnings" each, no ERROR, no "export ... was not found" |
| T0.2 pose codec | OK, 9 tests: a round trip of 20,000 poses with the rig position at most 0.0064 mm off, 140,000 packets across 16-bit wraps, resync after 2 s, v0 exact |
| T0.3 interpolation buffer | OK, 8 tests: 5% loss and up to ±30 ms of jitter with bounded error; carry-on for 100 ms, then hold; a delay of 100 ms is smoother than 0 |
| T0.4 body solver | OK, 11 tests (hand error under 1e-11 mm on reachable targets, no NaN, bone lengths kept), plus the known failure #22 |

## Counts

Counted per test of the matrix, T0 apart. "not applicable": the test is written for the other media server, or runs once in the Dialog block. "skipped": written for the block but not run. On Cloud that is mostly T5 to T7, which never ran because the run was stopped.

| Block | OK | NG | known limitation | not applicable | skipped | invalid |
| --- | --- | --- | --- | --- | --- | --- |
| Dialog | 28 | 26 | 0 | 6 | 1 | 1 |
| LiveKit local | 23 | 27 | 1 | 10 | 1 | 0 |
| LiveKit Cloud | 12 | 16 | 1 | 10 | 23 | 0 |

T0, run once for all blocks: T0.1 NG (lint), T0.2 to T0.4 OK.

## Matrix

Each cell gives the status, then the first failing check (or the main check) with its numbers. The consolidated report links each cell to its evidence.

| Test | Dialog | LiveKit local | LiveKit Cloud |
| --- | --- | --- | --- |
| t0.1 preflight: containers, lint, unit tests and… | **NG** client lint:js: 54 errors, 0 warnings (no-unused-vars 50, @calm/react-intl/missing-format… (once, all blocks) | | |
| t0.2 pose codec v1: round trip, sequence wrap, late… | **OK** v1 round trip of 20,000 random poses: rig position error max 0.00640 mean 0.00229 p99… (once, all blocks) | | |
| t0.3 interpolation buffer behind a simulated network | **OK** network stream: 60 fps sender, 40 ms + 0-30 ms jitter, 5% loss: send interval 33.3 ms… (once, all blocks) | | |
| t0.4 body solver on synthetic rigs | **OK** the synthetic rigs map to the expected bones: T-pose facing -z, identity rest: forward… (once, all blocks) | | |
| t1-smoke smoke | **NG** Two-way audio: B hears A: pilot 0.29; A hears B: pilot 0 (heard at 0.1 or more) (and 4… | **NG** Mute and unmute with the toolbar's Voice button: muted: button muted, isMicEnabled… | **NG** Mute and unmute with the toolbar's Voice button: muted: button muted, isMicEnabled… |
| t2.1 both talk | **OK** Each detects the other's pilot: B hears A: pilot 0.3; A hears B: pilot 0.26 | **OK** Each detects the other's pilot: B hears A: pilot 0.3; A hears B: pilot 0.29 | **OK** Each detects the other's pilot: B hears A: pilot 0.3; A hears B: pilot 0.3 |
| t2.2 mute and unmute with the toolbar | **NG** Before muting: button, isMicEnabled and what B hears agree: button on, isMicEnabled… | **NG** Before muting: button, isMicEnabled and what B hears agree: button muted, isMicEnabled… | **NG** Before muting: button, isMicEnabled and what B hears agree: button muted, isMicEnabled… |
| t2.3 change the input device in audio settings | **NG** Switched to "麥克風 (TKGOU PnP USB Microphone) (0c76:1467)" in Audio Settings: one track… | **NG** Switched to "麥克風 (TKGOU PnP USB Microphone) (0c76:1467)" in Audio Settings: one track… | **NG** Switched to "麥克風 (TKGOU PnP USB Microphone) (0c76:1467)" in Audio Settings: one track… |
| t2.4 camera and screen share | **OK** Share > Camera: B sees A's camera: expected A's camera clip (rgb 255, 0, 0); B sees… | **NG** No console errors outside the allow-list: 2 unexpected, 28 allowed; first: A-admin… | **OK** Share > Camera: B sees A's camera: expected A's camera clip (rgb 255, 0, 0); B sees… |
| t2.5 video file and camera tool | **OK** A places a video file: it plays in step on both: playing on both after 1.0 s; A and B… | **OK** A places a video file: it plays in step on both: playing on both after 1.0 s; A and B… | **OK** A places a video file: it plays in step on both: playing on both after 1.0 s; A and B… |
| t2.6-dialog-to-dialog room move Dialog to Dialog | **NG** Move through an in-world link to move-target-dialog (dialog): error: no "visit room"… | n/a | n/a |
| t2.6-dialog-to-livekit room move Dialog to LiveKit | n/a | **OK** Move through an in-world link to move-target-livekit (livekit): B moved in 0.7 s, A in… | **OK** Move through an in-world link to move-target-livekit (livekit): B moved in 0.9 s, A in… |
| t2.6-livekit-to-livekit room move LiveKit to LiveKit | n/a | **NG** Move through an in-world link to move-target-livekit (livekit): B moved in 0.7 s, A in… | **NG** Move through an in-world link to move-target-livekit (livekit): B moved in 0.8 s, A in… |
| t2.7 switching the room's media server with… | n/a | **NG** Muted: switch to Dialog: error: the check did not finish within 6 min (and 1 more NG: No… | **NG** No console errors outside the allow-list: 3 unexpected, 44 allowed; first: A-admin… |
| t2.8 a third client joins after the switch | n/a | **NG** Switched back to Dialog: all three follow: error: locator.click: Timeout 60000ms exceeded. | **NG** No console errors outside the allow-list: 3 unexpected, 50 allowed; first: A-admin… |
| t2.9 media server restart, then leaving | **NG** Before: everyone hears everyone: A-admin hears B-member1 0.28, C-member2 0.27; B-member1… | **NG** Poses resume: A-admin <- B-member1 no pose; A-admin <- C-member2 no pose; B-member1 <-… | **NG** Audio resumes for everyone: A-admin hears B-member1 0.3, C-netclient 0.3; B-member1… |
| t2.10 block, unblock and kick | **NG** Before: A hears B and draws B's avatar: A hears B pilot 0.29, B hears A pilot 0.18; A… | **NG** A hides (blocks) B from People: B's voice and avatar disappear: A hears B pilot 0.29; B… | **NG** A hides (blocks) B from People: B's voice and avatar disappear: A hears B pilot 0.27; B… |
| t2.11 PDF, laser pointer, N-impro and #iot | **NG** Members answer (Yes with the left arrow, No with the right arrow): B-member1: Send… | **NG** Laser pointer: A speaks publicly (Broadcast > Start Speaking) and points at the scene… | **NG** Laser pointer: A speaks publicly (Broadcast > Start Speaking) and points at the scene… |
| t2.12 RTC panel | **NG** No console errors outside the allow-list: 1 unexpected, 19 allowed; first: A-admin… | **NG** No console errors outside the allow-list: 1 unexpected, 15 allowed; first: A-admin… | **NG** No console errors outside the allow-list: 1 unexpected, 14 allowed; first: A-admin… |
| t2.13 force_tcp and force_turn | **NG** ?force_tcp=1: the media server transports connect through a relay: 2 relay-only… | n/a | n/a |
| t2.14 Dialog host change | **OK** host_changed: both reconnect, no exception, audio returns: host hubs.local ->… | n/a | n/a |
| t2.15 soak, 40 minutes | **OK** A-admin: heap 93.5 -> 93.8 MB (0.01 MB/min), geometries 13 -> 15, textures 41 -> 42… | **NG** TimeoutError: locator.setInputFiles: Timeout 60000ms exceeded. | not run: the step 9 brief leaves the soak out on LiveKit Cloud |
| t3.1 a speaker in X heard and seen in Y | **NG** A stand-in for A appears in Y, with A's model: B-member1: pose yes, model none, pilot 0… | n/a | n/a |
| t3.2 Y and Z listen at once | **NG** Y and Z, listening at once, both receive A: B-member1: pose yes, model none, pilot 0 (no… | n/a | n/a |
| t3.3 public speaking (probe) | n/a | **NG** A's main session stays connected and keeps sending while it speaks (required): before… | **NG** A's main session stays connected and keeps sending while it speaks (required): before… |
| t3.4 the speaker pages a PDF and points with the laser | **NG** The speaker pages the slide: Y's slide follows: pages before 0/0/0, after 2/0/0 (A/B/C)… | n/a | n/a |
| t3.5 a headset speaker's stand-in moves its hands | **NG** The stand-in moves its hands as well as its head: left hand: moved 40 cm at A, 0 cm at… | n/a | n/a |
| t3.6 the speaker's room switches media server while… | n/a | **known limitation** Recorded: the speaker's sessions and the stand-in when the speaker's room switches to… | **known limitation** Recorded: the speaker's sessions and the stand-in when the speaker's room switches to… |
| t4.1 what a moving and an idle client send, new build… | **NG** Pose bytes a quarter or less of the old build's: moving: new 2563 B/s against old 5416… | **NG** Pose bytes a quarter or less of the old build's: moving: new 2546 B/s against old 4786… | **NG** Pose bytes a quarter or less of the old build's: moving: new 2554 B/s against old 4810… |
| t4.2 B's copy follows A's walk | **OK** B's copy of A follows A's path: position error under 2 cm after alignment; lag reported… | **OK** B's copy of A follows A's path: position error under 2 cm after alignment; lag reported… | **OK** B's copy of A follows A's path: position error under 2 cm after alignment; lag reported… |
| t4.3 slow hand and head movements of a headset reach… | **OK** B's copy keeps changing throughout: right hand at 1 cm/s and head at 2°/s for 20 s: B's… | **OK** B's copy keeps changing throughout: right hand at 1 cm/s and head at 2°/s for 20 s: B's… | **OK** B's copy keeps changing throughout: right hand at 1 cm/s and head at 2°/s for 20 s: B's… |
| t4.4 leave and re-enter three times | **OK** B sees A move after each of three re-entries: round 1: B saw A walk 5.56 m; round 2: B… | **NG** No console errors outside the allow-list: 15 unexpected, 65 allowed; first: A-admin… | **NG** No console errors outside the allow-list: 13 unexpected, 65 allowed; first: A-admin… |
| t4.5 a late joiner gets the model and pose | **NG** C, joining late, has A's model and pose within 3 s: after C entered: A's pose not within… | **OK** C, joining late, has A's model and pose within 3 s: after C entered: A's pose after 5… | **OK** C, joining late, has A's model and pose within 3 s: after C entered: A's pose after 5… |
| t4.6 avatar changed three times | **NG** Geometry and texture counts return to the baseline after the three changes: geometries… | **OK** B holds one model for A at every step: baseline: B loaded A's first avatar in 282 ms, 2… | **OK** B holds one model for A at every step: baseline: B loaded A's first avatar in 267 ms, 2… |
| t4.7 each sample avatar | **NG** Name tag above the neck for each humanoid avatar: rpm: tag 0.70 m above the neck, 0.00 m… | **NG** Name tag above the neck for each humanoid avatar: rpm: tag 0.70 m above the neck, 0.96 m… | **NG** Name tag above the neck for each humanoid avatar: rpm: tag 0.70 m above the neck, 0.96 m… |
| t4.8 headset in and out of VR and a lost controller | **NG** The untracked hand rests: B's copy of the disconnected hand does not follow the… | **NG** The untracked hand rests: B's copy of the disconnected hand does not follow the… | **NG** The untracked hand rests: B's copy of the disconnected hand does not follow the… |
| t4.9 interpolation delay 0 against 100 ms | **OK** Lower jerk at 100 ms than at 0 ms (B's copy of A, the same walk twice each): rig jerk… | **OK** Lower jerk at 100 ms than at 0 ms (B's copy of A, the same walk twice each): rig jerk… | **OK** Lower jerk at 100 ms than at 0 ms (B's copy of A, the same walk twice each): rig jerk… |
| t4.10 the sender's page frozen for 3 s | **OK** While A is frozen, B carries A on for at most 100 ms, then holds: gap in A's packets… | **OK** While A is frozen, B carries A on for at most 100 ms, then holds: gap in A's packets… | **OK** While A is frozen, B carries A on for at most 100 ms, then holds: gap in A's packets… |
| t4.11 old build and new build in one room | **OK** The new client shows the old one moving: the old client walked 6.125 m net; the new… | **OK** The new client shows the old one moving: the old client walked 6.1666 m net; the new… | **OK** The new client shows the old one moving: the old client walked 6.1164 m net; the new… |
| t4.12 eight avatars, four DESK and four BOT | **NG** TimeoutError: locator.setInputFiles: Timeout 240000ms exceeded. | **NG** Error: page.goto: net::ERR_TIMED_OUT at https://hubs.local:4000/ | **skipped** stopped during the test by the C: watchdog: free space fell from 3.4 to 0.25 GB within a… |
| t5-rpm-desktop inverse kinematics, old solver against new… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-rpm-vr inverse kinematics, old solver against new… | **NG** New solver: hand error no worse than the old solver's: mean distance from hand bone to… | **NG** The new solver's height scale comes from the standing headset: scale 0.9272; the… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-summary contact sheets and summary videos per avatar | **NG** Per avatar and mode: the new solver against the old (all motions): rpm vr: NG; hand… | **NG** Per avatar and mode: the new solver against the old (all motions): rpm vr: NG; hand… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-vrm0-desktop inverse kinematics, old solver against new: VRM… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-vrm0-vr inverse kinematics, old solver against new: VRM… | **NG** The new solver's height scale comes from the standing headset: scale 1.1158; the… | **NG** New solver: hand error no worse than the old solver's: mean distance from hand bone to… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-vrm1-desktop inverse kinematics, old solver against new: VRM… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | **OK** The probe's maths against known answers: 14 of 14 cases with known answers (rig to room… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t5-vrm1-vr inverse kinematics, old solver against new: VRM… | **NG** New solver: hand error no worse than the old solver's: mean distance from hand bone to… | **NG** New solver: hand error no worse than the old solver's: mean distance from hand bone to… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.1 admin pages: Email and WebRTC saved, the add-on… | **OK** The admin page opens for the admin: admin opened at https://hubs.local:4000/admin#/ | n/a | n/a |
| t6.2 create a room, rename it, change its scene… | **OK** Create a room from the home page: room bq95yDm created (name, sfu, entry mode: Prickly… | **OK** Create a room from the home page: room w6XKba6 created (name, sfu, entry mode: Shabby… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.3 place an image, a video, a GLB and a PDF; grab… | **OK** Place an image, a video, a GLB and a PDF (Place, Upload): both clients show them: image… | **OK** Place an image, a video, a GLB and a PDF (Place, Upload): both clients show them: image… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.4 external image, video and GLB URLs through the… | **OK** Paste an external image URL: it loads through the proxy: placed and loaded after 23 ms… | **OK** Paste an external image URL: it loads through the proxy: placed and loaded after 10 ms… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.5 pronouns separated by commas and spaces | **OK** Pronouns "she, her" in Change Name & Avatar: accepted and shown to B: the field accepts… | **OK** Pronouns "she, her" in Change Name & Avatar: accepted and shown to B: the field accepts… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.6 Spoke: a new project, one edit, published, a… | **NG** Publish the new project as the template opened it: publishing failed: "Error Publishing… | n/a | n/a |
| t6.7 bitecs room: loader and add-on on, a video… | **OK** Room Settings: Enable bitECS based Client and the Behavior Graphs add-on; the page… | n/a | n/a |
| t6.8-whole-run every request of every client in the run… | **OK** No request of any client in the run went to a reticulum.io host: 12745 requests of 121… | **OK** No request of any client in the run went to a reticulum.io host: 12429 requests of 129… | **OK** No request of any client in the run went to a reticulum.io host: 7231 requests of 63… |
| t6.9 the downloaded recording file | **OK** The downloaded chutvrc-recording file: valid JSON with #avatar-pose entries, sent and… | **OK** The downloaded chutvrc-recording file: valid JSON with #avatar-pose entries, sent and… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t6.10-whole-run console errors of every client over the whole… | **NG** No console error outside the allow-list in the whole run: 8142 error entries of 121… | **NG** No console error outside the allow-list in the whole run: 14498 error entries of 129… | **NG** No console error outside the allow-list in the whole run: 1400 error entries of 63… |
| t7.1 headset: VR, talk, H1, a PDF paged in VR, out of… | **OK** The headset enters VR on Enter Room: presenting true; own pose isVR true, tracked 7 | **OK** The headset enters VR on Enter Room: presenting true; own pose isVR true, tracked 7 | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.2 phone: mobile entry, joysticks, talk, mute… | **OK** Mobile entry: the phone layout with the on-screen joysticks: isMobile true; joysticks… | **NG** Mute and unmute with a tap on Voice: before: button muted, isMicEnabled true; muted… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.3 iPhone in WebKit: as far as the engine goes | **OK** Loads and enters the room: entered in 18.1 s; sfuId 0, connected true, microphone live | **OK** Loads and enters the room: entered in 18.0 s; sfuId 2, connected true, microphone live | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.3-ipad iPad in WebKit: as far as the engine goes | **NG** Audio both ways (the observer hears the pilot; the WebKit client receives audio with a… | **NG** Audio both ways (the observer hears the pilot; the WebKit client receives audio with a… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.4 headset and phone follow a media server switch… | **OK** Everyone moves by link to move-target-dialog: the headset and the phone follow without… | **NG** TimeoutError: page.waitForFunction: Timeout 60000ms exceeded. | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.5 poor network: loss and jitter, 1 Mbit/s, a 10 s… | **OK** Who sees whom on a clean link: every cell: full. C-poor-net: A-desk yes, B-desk yes… | **OK** Who sees whom on a clean link: every cell: full. C-poor-net: A-desk yes, B-desk yes… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.6 slow headset and slow phone (CPU 4x) | **OK** The send rate falls with the frame rate (reported): full speed: headset 60.1 fps sending… | **OK** The send rate falls with the frame rate (reported): full speed: headset 60.1 fps sending… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.7 mixed room: 2 DESK, 2 QUEST, 2 ANDROID, 1 IOS, 2… | **skipped** runs only with T7_MIXED_WITH_BOTS=1: with the two bots the mixed room never formed on… | **skipped** runs only with T7_MIXED_WITH_BOTS=1: with the two bots the mixed room never formed on… | not run: the Cloud run was stopped during T4.12 when free space on… |
| t7.7-no-bots mixed room without the bots | **invalid** ran its 10 minutes, then stopped in its closing phase by the C: watchdog (free space… | **NG** TimeoutError: page.waitForFunction: Timeout 60000ms exceeded. | not run: the Cloud run was stopped during T4.12 when free space on… |

## Soak (T2.15)

| | Dialog | Local LiveKit | LiveKit Cloud |
| --- | --- | --- | --- |
| With 4 DESK and 4 BOT | failed after 10 min: a bot's page load timed out (`net::ERR_TIMED_OUT`) and the DESK pages stopped answering; kept in `final-dialog-attempts/t2.15-dialog-with-bots` | failed after 12 min: a bot's page did not take its microphone file within 60 s | not run (the brief leaves the soak out on Cloud) |
| With the 4 DESK clients only, 40 min | **OK**. Heap 0.01 to 0.02 MB a minute after 8 min of warm-up (93.2 to 93.8 MB on all four; limit 1 MB a minute). Live connections 4 on each client throughout. Geometries and textures: one client went 13 to 15 and 41 to 42, the other three did not change. The pose sequence number wrapped after 36.5 min (highest value seen 65,169; the next sample read 521), and A still saw B walk 4.31 m at the end. No console errors outside the allow-list | not run: all runs had been stopped after the second drop on C: | not run |

## Findings

The numbers are BASELINE.md's. "Seen" names the tests of this run that showed the finding.

### New since develop

- **#5** A room move between two LiveKit rooms leaves both microphones live but disabled, and no voice comes back. Seen in T2.6 LiveKit to LiveKit and in T1's room move, on local LiveKit and on Cloud. Transport refactor.
- **#2**, second half: the first mute click can be lost after the microphone wish was lost at entry. Not seen in this run; the lost wish at entry was seen (T2.3 Dialog). Transport refactor.
- **#11** BOT clients throw every frame. Not observable in this run, because the bots never stayed in a room (see the harness section). Avatar refactor.
- **#18** An untracked hand does not rest: the tracked bits now reach the observer, but neither solver reads them. T4.8 in all three blocks. Avatar refactor.
- **#22** The two-bone solver can give a bone that must turn half a turn an arbitrary turn (T0.4, a `test.failing`). Avatar refactor; the new solver is off by default.
- **#24** The new solver takes its height scale from a single frame: 1.116 against 1.130 (Dialog, VRM 0.x) and 0.927 against 0.939 (local, Ready Player Me), even with the subject standing still. **#26** Planted feet jump up to 25.3 cm in one frame. **#27** The body stays turned up to 20° from where the head looks. All three in T5, both servers. Avatar refactor; the new solver is off by default.

### Already on develop

- **#1** Remote avatar models are not drawn on Dialog (T1, T2.10, T4.5), and **#20**, the late joiner, in T4.5.
- **#3** One-way audio and poses at a simultaneous join on Dialog (T1, T2.2, T2.9). **#21** A send transport that never connects: seen after a media server switch back to Dialog (local T2.7, below) and in the mixed room. **#34** No voice and no poses after a room move on Dialog (T1).
- **#4** On LiveKit the Voice button shows muted while the microphone is on (T1 and T2.2 on local LiveKit and Cloud, T7.2 on local LiveKit).
- **#6** The microphone chosen in Audio Settings is ignored (T2.3 in all three blocks).
- **#7** A Dialog restart takes everyone out of the room (T2.9 Dialog).
- **#8** After a local LiveKit restart, poses and avatars never return (T2.9 local).
- **#9** Block and kick on LiveKit: the hidden user is still heard and drawn, and the kicked client stays connected (T2.10, local and Cloud).
- **#10** The laser pointer is never sent (T2.11 in all three blocks, T3.4).
- **#12** Public speaking on Dialog delivers nothing to the listening room (T3.1, T3.2, T3.5). **#14** The Broadcast menu offers Start Speaking again while speaking (T3.1). **#15** The speaker's PDF page does not reach the listening room (T3.4).
- **#13** Public speaking on LiveKit throws the speaker out of the room. The speaker's identity showed 10 LiveKit participant ids on local LiveKit and 14 on Cloud, and the page ended on "Unable to connect" (T3.3). This one is most likely on develop too, but was not run there.
- **#16** The name tag stays where the first model's neck was (T4.7, all three blocks). **#17** A model with unfamiliar bone names is shown unsolved (T4.7, all three blocks).
- **#28** to **#30**, the old solver's baseline. Soles 37 to 40 cm under the floor in the crouch (Ready Player Me); the VRM 1.0 knees bent backward in 197 frames; arm flips up to 41 cm; wrists bent far (T5). The new solver has none of the first three.
- **#31** to **#33**: Spoke cannot publish the new project, cannot publish a scene without a material, and its name fields carry a pattern current Chromium rejects (T6.6).
- T6.10, console errors over the whole run, is NG in every block. Almost all of them are of the known kinds: "PC manager is closed" (#8, 1,736 times on local LiveKit), sends on a closed data channel (#21) and the unhandled public-speaking rejection (#12).

### Harness and environment limits, and what is not judged

- **The bots.** On both servers they kept the 40-minute soak from forming: a bot's page load timed out on Dialog, and a bot's page did not take its microphone file on local LiveKit. T4.12, with 4 DESK and 4 BOT, did not complete in any block: a bot's page did not take its file on Dialog, a page load timed out at the socket on local LiveKit, and on Cloud the watchdog stopped it.
- **The mixed room (T7.7) is more than this PC carries.** On Dialog it ran its 10 minutes and is invalid by the frame-rate floor: both headsets ran at 32 to 50 fps and the iPhone at 4 to 7. Who hears whom went from 29 to 30 of 42, and who sees whom stayed at 31 of 42; one phone's sending failed (#21) and nobody heard the iPhone (#35). It was stopped in its closing phase, so it has no result file; its grids and frame rates are in `final-dialog-attempts/t7.7-no-bots-dialog-stopped`. On local LiveKit it did not form: the WebKit client stayed in the lobby, and its web process crashed. The bots variant is skipped (`T7_MIXED_WITH_BOTS`).
- **Harness steps that did not happen**, so these are not product verdicts:
  - T2.6 Dialog to Dialog: the room link never appeared in B's view, so the move was not tried. T1's move by the same path did run.
  - T2.8 on local LiveKit: the click on Room Info and Settings timed out with the People panel open.
  - T7.4 on local LiveKit: the phone stayed on Microphone Setup.
  - T4.1 on local LiveKit: the headset half did not run; an entry wait of 240 s timed out.
- **T2.13** `?force_tcp` and `?force_turn`: reticulum hands out TURN settings, but no TURN server runs on this stack, so the relay-only transports never connect. The same happened in steps 4 and 5.
- **#35** The WebKit clients' sending fails often: the iPad was not heard on Dialog or on local LiveKit; the iPhone was fine in its own test on both. Linux WebKit in a container is not Safari, so this cannot be judged here.
- **#37**, a measurement, not judged: under 5% loss with 40 ± 30 ms of delay, the poor-network client's poses arrived 1.09 s (Dialog) and 1.17 s (local) behind, with no freeze; at 1 Mbit/s 2.4 and 2.6 s. After a 10 s blackout its voice was back within 0.25 s and its poses after 8.3 s (Dialog) and 9.5 s (local).
- **#19** is an expectation, not a defect: pose bytes were 0.47 to 0.53 of the old build's moving and 0.63 idle. **#25** is by the new solver's design: its hands and eyes are off by the height scale in VR, 8.3 to 13.4 cm hand error against 1.4 to 6.3 cm for the old solver.
- **#23** (VR entry poses too high) and **#36** (the headset's voice silent once) were not seen; T7.1 passed on both servers.

## Differences from the earlier steps

- **Local T2.7.** After the fourth switch (LiveKit back to Dialog, microphone muted), A's Dialog data channels never opened. A's page made 10,863 sends on a channel that was not open in six minutes, and the switch check never finished. This is the #21 pattern after a switch. T2.7 passed its switches in step 4, and on Cloud in this run.
- **Cloud T2.9.** After the netclient client's 10 s outage it no longer heard B. In the earlier Cloud runs the audio came back for everyone.
- **Dialog T2.11.** The device simulator's `#iot` message reached A and C but not B and D, and D's N-impro answer was not sent. In step 4 every member received it.
- **T7.5.** After the blackout the poses came back after 8.3 s on Dialog; in step 8 they came back at once.
- Better than in step 8: T7.4 and T7.5 passed on Dialog, and T7.1 passed on both servers. T4.6 passed on both LiveKit blocks; on Dialog it still ends with 4 more geometries and 2 more textures. T4.5 passed on both LiveKit blocks.
- The soak passed for the first time at its full length (Dialog, DESK clients only), with the sequence wrap reached.
- T5's numbers match step 7 within a few per cent. One new failing check per block: "the height scale comes from the standing headset" was off by 1.2% (VRM 0.x on Dialog, Ready Player Me on local LiveKit; #24).

## Fix candidates, in priority order

1. **#5 LiveKit to LiveKit room move leaves the microphones disabled** (new, transport refactor). `src/sfu-adapters/sfu-session.ts` `connect()` carries the microphone wish over only when it replaces the adapter. On a move between two LiveKit rooms the kept adapter reconnects, and `src/sfu-adapters/livekit-adapter.ts` `_initializeLocalAudio()` mutes the new microphone ("Start muted by default"). Re-apply `media.micShouldBeEnabled` after `connect()` when the adapter is kept.
2. **#1 and #20, remote avatars not drawn on Dialog** (develop; every Dialog room). `src/sfu-adapters/dialog-adapter.ts` calls `PoseSync.handleSyncInit()` right after `produceData()`, before the data channel is open. `src/avatar/net/pose-sync.ts` then sends `#avatarId` once on the closed channel and never repeats it for ordinary clients. Announce on the data producer's open event, and again when a peer joins.
3. **#3, #21 and #34, one-way audio and poses on Dialog** (develop, now also after a switch). The send transport in `src/sfu-adapters/dialog-adapter.ts` can stay "connecting" or fail without being replaced. Detect that, then restart ICE or recreate the transport.
4. **#13, public speaking on LiveKit throws the speaker out.** `src/sfu-adapters/sfu-config.ts` `derivePublicSpeakingConfig` passes no `accessToken`, so the adapter fetches the hub's token. Reticulum (`lib/ret_web/channels/hub_channel.ex`, `Ret.LivekitTokenGenerator.generate_access_token(hub.hub_sid, session_id)`) issues it for the speaker's own identity in its own room. A token is needed for the speaking identity in the listening room.
5. **#12, public speaking on Dialog delivers nothing.** `src/systems/public-speaking-system.js` `initPublicSpeakerAgent` awaits `APP.hubChannel.getSfuTokenOrFetch()`. Reticulum answers `refresh_sfu_token` for Dialog rooms with `sfu_type_not_supported`.
6. **#2 and #4, the microphone state.** `src/sfu-adapters/media-session.ts` `enableMicrophone()` returns before recording `micWanted` when there is no producer yet. The LiveKit adapter mutes at connect while the UI follows the wish. Keep one microphone wish and apply it when the track or producer appears.
7. **#8 and #9, LiveKit reconnect, block and kick** (develop). `livekit-adapter.ts` `reconnect()` (the "PC manager is closed" loop and the pose sync after a reconnect); hiding a user and the kick on LiveKit.
8. **#10, the laser pointer** (develop). `src/components/cursor-controller.js` sends only when `this.isHoverTargetMainScreen` is set, and nothing sets it.
9. **#16 and #17, avatars** (develop). `src/components/name-tag.js` looks the neck up once (line 182); look it up again on a model change. `src/avatar/avatar-model-manager.ts` should fall back to the default avatar when the rig has no hips or head.
10. **#15 and #14, public speaking extras** (develop). `src/components/media-loader.js` sends and applies `#pdfPage` only for pinned media (lines 687 and 695). `PublicSpeakingMenu.js` keeps `publicSpeakerActive` in its own state.
11. **#11, bots** (new, avatar refactor). `src/avatar/pose/local-pose-source.ts` reads `renderer.xr`, which the bot's stub renderer lacks. `src/avatar/net/pose-sender.ts` sends every frame without checking that the channel is open.
12. **The new solver** (new; off by default, so after the above).
    - #24: in `src/avatar/ik/calibration.ts`, calibrate from a stable standing sample, or call `AvatarIkManager.recalibrate()`.
    - #26: in `src/avatar/ik/feet.ts` `placeFoot`, step over several frames.
    - #27: in `src/avatar/ik/body-yaw.ts`, turn back inside the dead band.
    - #22: in `src/avatar/ik/two-bone-ik.ts`, handle the near-opposite case of `setFromUnitVectors`.
    - #18: have the solvers read `TrackedPose.tracked`.
    - #25 is a product decision (feet on the floor against hands on the controllers).
13. **#6, the microphone device choice** (develop). `src/utils/media-devices-manager.js` line 235: `deviceId: { ideal: [id] }` should use `exact`.
14. **Spoke #31 to #33** (develop).
    - `src/assets/templates/crater.spoke` names its model on the retired upload host.
    - The `clips` getter of `src/editor/objects/Model.js` reads a null model.
    - `src/editor/Editor.js` `exportScene` iterates `json.materials` unchecked.
    - The `pattern` attributes in `PublishDialog.js`, `SaveNewProjectDialog.js` and `CreateScenePage.js` are rejected by current Chromium.
15. **Lint**: the duplicate `optimization` key in `webpack.config.js` (new, upstream intake), then develop's 53 errors.
16. **#7, a Dialog restart takes everyone out** (develop).

## What could not be run

All of the following were left out after the second drop on C: (the brief: stop when C: falls under 2 GB):

- LiveKit Cloud: T4.12 (stopped), all of T5, T6.2 to T6.5 and T6.9, and T7.1 to T7.7.
- Local LiveKit: the soak with the DESK clients only. Also the one rerun due to T4.12 (a socket timeout) and to T7.7 (the WebKit process crashed); both failed for environmental reasons.

Not runnable here at all: V5 (no NPC scene on this stack), N2 (no Behavior Graph scene: the examples are `.blend` files only), the media-frame part of N4, T2.13's relay (no TURN server), and the real-device items listed in the consolidated report.

To finish the run on this PC, C: needs more room, or WSL's crash dumps must not go to C:. Then run `T4.12` and the `T5`, `T6` and `T7` suites with `MEDIA_BLOCK=livekit-cloud E2E_RUN_ID=final-livekit-cloud`, and on local LiveKit the soak with `SOAK_BOTS=0`, `T4.12` and `T7.7`, each into its run folder. After that, rebuild with `npx tsx report/build-summary.ts`.
