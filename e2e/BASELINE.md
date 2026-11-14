# Baseline against develop (plan step 5)

Which failures of the target (hubs `feature/client-tests`, which is `feature/avatar-refactor` plus nothing) were already there before this work, found by running the same tests against the client from `develop`. Only hubs was switched; reticulum, dialog, spoke and the harness stayed as they were. Plan section 6 says how a failure is followed further (the intermediate branches).

## Set-up

| | develop | target |
| --- | --- | --- |
| hubs | `develop` `fb2c2185f` | `feature/client-tests` `59ee579ee` |
| Client API (`probes/compat.ts`) | APP.sfu is the media server adapter: no data channel bus, no pose store; poses read from the `#avatar-RIG` and `#avatar-HEAD` transforms | APP.sfu is a session with the bus; pose store `APP.avatarPoses` |
| Dependencies | `npm ci` for client and admin after the switch (lockfiles differ), the same back | as installed |
| Compile | "compiled with 1 warning" (pdfjs top-level await), as on the target | same |

Runs, all under `D:\chutvrc-e2e\evidence\` on this PC (`report.html` in each; the header names the hubs branch and commit):

| Block | develop | target |
| --- | --- | --- |
| Dialog, T1 and T2 (T2.15 left out on develop) | `2026-11-14T13-53-15-575Z` | `2026-11-14T12-27-40-088Z`; T1 again with the capability layer: `2026-11-14T13-29-29-377Z`, and after switching back from develop: `2026-11-14T15-06-37-096Z` |
| Dialog, T1, T2.1, T2.2 three more times | `2026-11-14T14-10-02-371Z` | `2026-11-14T12-51-38-810Z` |
| Local LiveKit, T1 and T2 | `2026-11-14T14-19-13-438Z` | `2026-11-14T10-33-58-271Z`; T2.1, T2.2 again `2026-11-14T13-01-01-790Z` |
| LiveKit Cloud | T1, T2.1, T2.2, T2.6: `2026-11-14T14-48-43-269Z` | T1 and T2: `2026-11-14T11-20-45-478Z`; T2.1, T2.2 again `2026-11-14T13-02-36-738Z` |
| BOT, 60 s in `dialog-main` with one DESK client (helper script, not a suite test) | `baseline-bot-develop` | `baseline-bot-target`; T2.15 soak: `2026-11-14T13-04-21-583Z`, `2026-11-14T11-12-26-094Z` |

The target runs except `13-29-29` and `15-06-37` were made before the capability layer existed; on the session build the layer reads the same fields as the probes did then, and the two T1 runs with it show the same failures.

On develop, checks that need the packet log are recorded as "not applicable" (the `#nimpro` packet check, the feature channel probes, and on LiveKit the laser pointer). On Dialog the laser pointer is counted on its own data channel instead (connections probe).

## The target's known failures

"x/n": failures out of runs. Verdicts: already on develop, new since develop (with the work stream: upstream intake, transport refactor, avatar refactor), or cannot tell.

| # | Failure | develop | target | Verdict |
| --- | --- | --- | --- | --- |
| 1 | Remote avatar models not drawn on Dialog | T1 "avatar is drawn" 4/4 (A and B draw 0 others), T2.10 "Before" 1/1; drawn on LiveKit (T1, T2.10) | T1 6/6, T2.10 1/1; drawn on LiveKit | **Already on develop.** develop also announces `#avatarId` once per entry for ordinary clients (the one-second repeat in `dialog-adapter.ts` is only for public-speaking clients), and the send watch logs `#avatarId` sent before its channel is open on both builds |
| 2 | Microphone wish lost at entry on Dialog; first mute click lost | "Tried to toggle mic but there's no producer." logged at entry in T2.2 (repeat 2, on B), T2.3, T2.9, T2.11; mute click lost 0/8 (T1 x4, T2.2 x4) | error at entry in T2.2 repeat 2, T2.3, T2.9, T2.11 and `13-29-29` T1; click lost in `13-29-29` T1 (after the click: button on, isMicEnabled true), 1/10 (T1 x6, T2.2 x4) | **The lost wish at entry: already on develop. The lost click: new since develop, transport refactor.** On develop `toggleMicrophone()` reads the producer's own state (`isMicEnabled`), so a wish lost at entry cannot swallow a click; on the target `MediaSession.toggleMicrophone()` flips `micWanted`, which `enableMicrophone()` does not record when the producer is missing ("Move media stream handling into a shared media session"). Not reproduced on develop directly: no develop run had the clicking client hit the entry error |
| 3 | One-way audio at simultaneous join on Dialog | 2/12 pair runs (T1 1/4, T2.1 1/4, T2.2 0/4), also T2.9 "Before" (C not heard by A and B) | 7/14 (T1 3/6, T2.1 2/4, T2.2 2/4 silent before muting); T2.9 "Before" heard | **Already on develop.** Same pattern on both: one client's audio and its poses both missing at the other (develop T1 run 1: B hears A 0, B holds no pose of A). The target's rate is higher in these samples, but 7/14 against 2/12 is too few runs to say the target made it worse |
| 4 | LiveKit Voice button shows muted while the microphone is on | T2.2 "Before muting" local 1/1, Cloud 1/1 (button muted, isMicEnabled true, B hears A); T1 mute check NG on both | local 2/2, Cloud 2/2 | **Already on develop.** `_initializeLocalAudio` ("Start muted by default") is the same on both |
| 5 | LiveKit to LiveKit room move leaves the microphones disabled | T2.6 local and Cloud: audio back after 0.4 to 1.0 s; T1 move OK local and Cloud | T2.6 local and Cloud: microphones live but disabled, audio never back; T1 move NG local and Cloud (no audio after the move) | **New since develop, transport refactor.** On develop every move creates a new adapter (`change-hub.js`: `APP.sfu = SfuAdapterFactory.create(...)`); on the target the session keeps its LiveKit adapter and reconnects it ("Keep one session object for the active media server and define the disconnect contract"), with the microphone state held by the media session. Which of the transport commits is the cause is not settled (no bisect) |
| 6 | Microphone device choice ignored (`ideal` deviceId) | T2.3 Dialog and local LiveKit: Audio Settings stays on the cable, cable pilot still heard | T2.3 Dialog, local, Cloud: same | **Already on develop.** `media-devices-manager.js` (`deviceId: { ideal: [id] }`) is unchanged since develop |
| 7 | Dialog restart takes everyone out of the room | T2.9 Dialog 1/1: all three left the scene, not reconnected in 90 s | 1/1, the same | **Already on develop** |
| 8 | Local LiveKit restart: poses and avatars never return, "PC manager is closed" | T2.9 local 1/1: audio back, poses "no pose", 0 models; 3424 "UnexpectedConnectionState: PC manager is closed" | 1/1: the same, 5361 of the error | **Already on develop** |
| 9 | Block and kick: hidden user still drawn and heard; LiveKit kicked client stays connected | T2.10 local LiveKit: after Hide A still hears B (0.29) and draws B; after Kick B's session stays connected and A keeps B's pose and model. On Dialog Hide silences B and Kick works (the avatar part cannot be judged: never drawn, #1) | T2.10 local and Cloud: the same; Dialog the same | **Already on develop** (LiveKit Cloud's T2.10 not run on develop) |
| 10 | Laser pointer never sent | T2.11 Dialog: 0 messages on the `#laserPointer` data channel at B, C and D while A points (connections probe); LiveKit: not applicable (no packet log, labels share two channels) | 0 position messages at every receiver on Dialog, local and Cloud (packet log) | **Already on develop.** `cursor-controller.js` is unchanged since develop: it sends only when `this.isHoverTargetMainScreen` is set, which nothing sets |
| 11 | BOT clients throw every frame (`renderer.xr`) | 114 "Cannot read properties of undefined (reading 'enabled')" a minute from `setSelfIsVrFlag` and `sendSelfIsVrFlag` (two one-second timers); no send errors | 1793 "InvalidStateError: ... RTCDataChannel.readyState is not 'open'" a minute from `PoseSender.tick` (every frame); the soak runs also log the `reading 'enabled'` error from the per-frame `sample` | **Reading `renderer.xr` on the bot's stub renderer: already on develop. Throwing every frame: new since develop, avatar refactor** ("Sample and send poses per frame through a pose store": `local-pose-source.ts` reads `renderer.xr` and the pose sender sends every frame) |

## Lint (T0.1, each part on its own)

| Part | develop | target |
| --- | --- | --- |
| client `lint:js` | 55 errors | 54 errors |
| client `lint:html` | passes | passes |
| client `test:unit` | 1 test passes | 1 test passes |
| client `build` (`tsc`, webpack production) | passes, 3 warnings | passes, 3 warnings (TRIALS.md) |
| admin `lint:js` | 2 errors | 2 errors |
| admin `lint:html` | passes | passes |
| admin `build` | passes, 3 warnings (a Sass warning, asset and entrypoint size) | passes on the second try, 2 warnings (TRIALS.md) |

Compared by file, rule and message (line numbers differ between the branches):

- 53 of the target's 54 client errors are on develop: the 50 `no-unused-vars`, the 2 `@calm/react-intl/missing-formatted-message` (`HomePage.js` "Sponsored by:", `ChutvrcPopovers.js` "Chutvrc") and the `prettier/prettier` in `hub-channel.js`.
- New on the target: `webpack.config.js` duplicate key `optimization` (`no-dupe-keys`), from the upstream intake ("Port the add-on API from upstream Hubs" adds the second `optimization` block).
- On develop only, gone on the target: `src/bit-components.js` `'BoneType' is defined but never used` (removed by the avatar refactor) and `src/change-hub.js` `'SFU' is defined but never used` (removed by the transport refactor).
- Admin: the same 2 `no-unused-vars` in `admin/webpack.config.js` (`host`, `internalHostname`) on both.

## Failures of develop that the target does not have

Seen in the develop runs above, passing on the target; for the record, not part of the list to fix:

- Dialog room move through a link (T1, T2.6 Dialog to Dialog): the new adapter has no microphone (`getLocalMicTrack()` null), nobody is heard after the move.
- Dialog host change (T2.14): neither client reconnects; "Cannot read properties of undefined (reading 'sfuId')".
- LiveKit microphone published more than once (T2.3: B holds 3 audio tracks for A, "a track with the same ID has already been published"; T2.2: after the mute click B still hears A, the pilot 4.3 to 4.5 s after the click, 55 to 100 audio packets a second).
- LiveKit camera share does not stop (T2.4: B still sees A's camera after Share).
- RTC panel (T2.12): no Device section on Dialog, no explanation on LiveKit.
- The Dialog recording holds every message sent since connecting (T1: about 5600 entries over 53 s against 560 over 9 s).
- T2.11 on Dialog: one member could not take its seat, and the device simulator's `#iot` message reached nobody.
- Switching a room's media server in the room settings (T2.7, T2.8): the clients stay on Dialog; moving them in place came with the transport refactor.

## Repeating it

Switch only hubs, as in plan section 6 and README.md ("Reinstalling the client's dependencies"): stop `hubs-client`, `hubs-admin` and `hubs-storybook`, `git -C services/hubs switch develop`, let mutagen sync, `rm -f package-lock.sha512 && npm ci` in a `hubs-client` and a `hubs-admin` run container, start the three and wait for the compile. Then:

```bash
MEDIA_BLOCK=dialog npx playwright test suites/t1 suites/t2 --grep-invert "T2\.15"
MEDIA_BLOCK=dialog npx playwright test suites/t1 suites/t2-audio -g "T1 smoke on Dialog|T2\.1 both talk on Dialog|T2\.2 mute and unmute with the toolbar on Dialog" --repeat-each=3
MEDIA_BLOCK=livekit-local npx playwright test suites/t1 suites/t2 --grep-invert "T2\.15"
MEDIA_BLOCK=livekit-cloud npx playwright test suites/t1 suites/t2-audio suites/t2-rooms -g "T1 smoke|T2\.1 both|T2\.2 mute|T2\.6 room move"
```

and back the same way.
