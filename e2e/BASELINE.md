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

## Step 6: what T3, T4 and the offline tests found

Plan step 6 added T3 (public speaking), T4 (avatar sync) and the offline tests T0.2 to T0.4 in hubs (`test/unit/avatar/`). These failures were not part of the baseline above: T3 and T4 did not exist when develop was run, and none of them was run on develop. "Code identical on develop" means the code path that fails is the same there (read, not run).

| # | Failure | Where | Verdict |
| --- | --- | --- | --- |
| 12 | Public speaking on Dialog delivers nothing to the listening room's audience: no stand-in, no voice (T3.1, T3.2, T3.4, T3.5). The listener's own mirror session does hold the speaker's pose (head angle error 0.8° after alignment, the headset's hands 0.1 cm p95), so the speaker's sending works (review fix B10); the relay into the room does not | `PublicSpeakingSystem.initPublicSpeakerAgent` (`src/systems/public-speaking-system.js`) awaits `APP.hubChannel.getSfuTokenOrFetch()` before it creates the agent session; reticulum answers `refresh_sfu_token` for a Dialog room with `{error, %{reason: "sfu_type_not_supported"}}` (`lib/ret_web/channels/hub_channel.ex`), the promise rejects ("Uncaught (in promise) #<Object>"), and no agent joins the room | Code identical on develop (hubs `develop` awaits the same token; reticulum `develop` has the same handler) |
| 13 | Public speaking on LiveKit throws the speaker out of the room (T3.3, 4 of 4 runs on the local server, 1 of 1 on Cloud): while speaking the main session sends no poses, its microphone is off or ended, and the page ends on "Unable to connect to this room". The speaker's identity shows up under several LiveKit participant ids (2 on the local server, 16 on Cloud) | The speaking session has no token of its own (`derivePublicSpeakingConfig` passes `accessToken` undefined), so the LiveKit adapter fetches one from reticulum, which issues it for the hub's own room and the session's own identity (`Ret.LivekitTokenGenerator.generate_access_token(hub.hub_sid, session_id)`). The speaking session therefore joins the speaker's own room under the speaker's identity, and LiveKit drops the other connection with that identity | Most likely already on develop: develop connects the speaking session with `accessToken: process.env.SORA_PUBLIC_SPEAKING_CHANNEL_TOKEN`, empty here, and its LiveKit adapter also fetches the hub's token then. Not run on develop |
| 14 | Broadcast menu offers "Start Speaking" while speaking, once the menu has been closed and opened again; stopping takes two clicks | `PublicSpeakingMenu.js` keeps `publicSpeakerActive` in the menu's own React state, which starts false each time `ChutvrcPopoversContainer` mounts the menu | Code identical on develop |
| 15 | The speaker's PDF page does not reach the listening room (T3.4): the speaking session sends no `#pdfPage` | `media-loader.js` sends the page every 500 ms only when `this.data.isPinned` (line 695) and applies a received page only then (line 687); nothing sets `isPinned`, which keeps its schema default false, scene media included (`gltf-component-mappings.js`) | Code identical on develop |
| 16 | The name tag stays where the first model's neck was after an avatar change (T4.7: right above the neck for the first model B loads for A, then 0.96 m, 1.97 m and 2.99 m to the side for the next ones, while A walks a little between changes) | `name-tag.js` looks the neck up once (`if (!this.neck && this.ikRoot)`, line 182) and keeps reading the removed model's bone | Code identical on develop (only the accessor was renamed) |
| 17 | A model with unfamiliar bone names (CesiumMan: 6 bones found, no hips or head) is shown as it is, unsolved, instead of falling back to the default avatar (T4.7) | `AvatarModelManager.replaceAvatarModel` (`src/avatar/avatar-model-manager.ts`) falls back only when loading throws; `createAvatarEntities` accepts any model with one known bone, and the solver returns early without hips | Same structure on develop (`avatar-sync-helper.ts`); not run there |
| 18 | The untracked hand does not rest (T4.8): with the left controller disconnected after being raised to 1.75 m, B's model keeps that hand 0.57 m (old solver) or 0.68 m (new solver) above the hips | The tracked bits now reach the observer (7, 5 with the controller off, 1 out of VR, all matching), but neither solver reads `TrackedPose.tracked` | New with the avatar refactor in the sense that the bits are new; neither build lets an untracked hand rest |
| 19 | Pose bytes a quarter or less of the old build's (T4.1): measured 0.50 to 0.62 with a desktop client and 0.41 to 0.51 with a headset moving head and both hands | The new build always sends 86 bytes 30 times a second (2.5 kB/s); the old build sends the rig at 66 a second (4 kB/s) and the head and hands only while they change by more than 1 cm or 0.01 rad, so it reaches its 16 kB/s only with every part moving fast | Expectation, not a defect: the plan's quarter assumes all four parts moving |
| 20 | Known failure 1 on a late joiner (T4.5, Dialog, 6 of 6 runs): C never gets A's model (B, there from the start, has none either); A's pose arrives within 6 ms in 4 runs and not at all in 2 (the one-way failure, 21). On LiveKit pose and model within 30 ms | as known failure 1 | Already on develop (known failure 1) |
| 21 | Data channels that never open on Dialog: once the whole-body pose channel of a DESK client in T4.12 (2,645 sends while "connecting"), once every channel of the headset speaker's speaking session in T3.5 (3,679 pose and 6,300 laser sends) | In the consolidated Dialog run T4.2 (`2026-11-14T16-57-39-338Z`) the connection watch shows it: A's send transport (its second connection) was marked failed or closed and still read "connecting" at the end, no other send transport replaced it, A's 810 pose sends never left, and B held no pose of A, while A received B's poses on its receive transport. The tests now save every client's connections and data channel states (`connections-at-end.json`) | The one-way pattern of known failure 3 (already on develop at a lower rate there); where the send transport fails is not located |
| 22 | The two-bone solver can give a bone that must turn half a turn an arbitrary turn (offline, T0.4): the hand misplaced by up to 520 mm for targets within the arm's length difference of the shoulder on a straight-armed rest pose | `src/avatar/ik/two-bone-ik.ts` uses three.js `setFromUnitVectors`, which treats directions as opposite only when their dot product is within `Number.EPSILON` of -1 and otherwise builds the turn from a cross product of rounding noise | New code of the avatar refactor (the new solver is off by default) |

Two more, not judged as product failures yet:

- T4.6 geometry and texture counts: after the three changes B holds 4 more geometries and 2 more textures than at the baseline in 3 of 4 Dialog runs (exact in the other) and 5 more geometries and 3 more textures in 3 of 4 local LiveKit runs (exact in the other); a second round of the same three changes ends on exactly the same counts as the first, so this is an allocation made once on the first change, not growth per change. Not located.
- T4.12 on Dialog did not complete in four attempts: a bot's page did not take its files within 4 minutes (twice), a bot's page load timed out, and once a DESK browser did not start within 3 minutes. Dialog's log shows bursts of "wrong authentication in STUN Binding Request" (about 2,000 a minute) in those runs, and the bots log a failed send every frame there (known failure 11). On local LiveKit the test passed: 60 fps on all four DESK clients, each holding the other seven poses and drawing seven models.

Runs of step 6 (under `D:\chutvrc-e2e\evidence\`): Dialog, all of T3 and T4: `2026-11-14T16-57-39-338Z`; Dialog, T3.5, T4.2, T4.5, T4.6, T4.7 three times each: `2026-11-14T17-33-44-246Z`; local LiveKit, all of T3 and T4: `2026-11-14T16-35-51-067Z`, and T3.3, T4.6, T4.7 three times each: `2026-11-14T17-49-42-745Z`; LiveKit Cloud, T3.3, T4.1, T4.2: `2026-11-14T16-52-11-803Z`; the QUEST client without the held window frames (T4.8): `2026-11-14T15-31-02-934Z`.

Harness findings of step 6 (not product failures): IWER keeps the page's window frame callbacks running during the immersive session, which made the QUEST client tick twice per frame and send `tracked` 1 (TRIALS.md, (b)); a sample avatar chosen by one test stayed in the signed-in profile and spoiled the next (now removed at client start).

## Step 7: what T5 found

T5 (`suites/t5-ik.spec.ts`) puts a subject (QUEST in VR, DESK on desktop) in front of two DESK observers at one spot, one with "Use the new avatar body solver (experimental)" off and one with it on, and measures every frame of each observer's model of the subject against the pose its solver was given (`probes/ik.ts`). Three avatars (Ready Player Me sample, VRM 0.x, VRM 1.0), M1 to M10 and H1 in VR, stand still, look around, snap turn and walk on desktop. Runs: Dialog `2026-11-14T19-30-21-547Z`, local LiveKit `2026-11-14T19-47-20-999Z`. Re-run into the same folders: every desktop test (the first desktop runs looked around in the third-person camera, where a drag turns nothing, TRIALS.md step 7); on Dialog the VRM 1.0 headset test (its console check had caught known failure #2, which T5 now allows) and once more the Ready Player Me desktop test (a page asset failed with `ERR_NO_BUFFER_SPACE`, a Windows socket error); on LiveKit once more the VRM 1.0 desktop test (`HubChannel.sendProfileUpdate` threw on the harness's profile change before the room's channel existed; the harness now changes the profile once the lobby shows); then both summaries. The two media servers gave the same numbers within a few per cent: the solver is the viewer's, the server only carries the poses.

T5's pass rule for the new solver: no NaN, no elbow or knee on the wrong side, hand error no worse than the old solver's. The first two hold in every test (0 NaN frames, 0 wrong-side frames for the new solver). The third fails in VR for every avatar, by the design of the new solver's height scale (#25 below).

"Code identical on develop" means the code path is the same there (read, not run); the old solver is the one develop has.

| # | Failure | Where | Verdict |
| --- | --- | --- | --- |
| 23 | A headset entering VR sends its first three pose packets with the head 0.79 m too high (2.39 m against 1.60 m), then the right height (`trials/step7-vr-entry.ts`, the observer's packet log) | The own pose is copied from `#avatar-pov-node` (`src/avatar/pose/local-pose-source.ts`), which `src/systems/camera-system.js` sets from the viewing camera in vr-mode; for the first frames of the session that is not yet the headset's pose. Not located further | Seen under IWER; whether the Quest Browser does the same is for the real device. The sampler is new with the avatar refactor; the pov handling is upstream |
| 24 | The new solver's height scale is taken from one frame and kept: an observer already watching a headset that enters VR calibrates on #23's frames (scale 1.15 to 1.29 instead of 0.94 for the Ready Player Me sample in 3 of 4 entries) and shows the avatar crouching, its hands 19 to 23 cm off the controllers, for as long as the model stays (debug run `2026-11-14T18-40-22-211Z`, `t5-summary-dialog/sheet-rpm.png`) | `src/avatar/ik/calibration.ts` `calibrateHeight` ("Takes the ratio once", first headset higher than 0.5 m in VR); `AvatarIkManager.recalibrate()` exists but nothing calls it. Any first frame that is not a standing user (#23, an interpolated frame, a user sitting or bending at that moment) sets the scale for the session | New with the avatar refactor (the new solver is off by default). T5 avoids it by turning the new solver on once the subject stands still, and checks the scale is then the standing headset's |
| 25 | The new solver puts the hands off the controllers and the eyes off the headset by the height scale, in VR: hand error 8.4 cm on average over all motions for the taller Ready Player Me model (scale 0.94), 12.3 and 13.4 cm for the shorter VRM models (1.12 and 1.13), against 2.7 to 7.9 cm for the old solver; eyes 7.5 cm and 20 cm off the headset. Against its own scaled target the new solver's hand error is 0 to 2 cm, except reaching 0.17 m beyond the arm (M5: 8.5 to 9.3 cm) and fast swings (M10: 3.3 to 3.9 cm). So T5's "hand error no worse than the old solver's" is NG for every avatar in VR on both media servers | `src/avatar/ik/solve-body.ts` `trackedHandTarget` and `placeHips` (heights through `scaleHeight`). It also applies to the own avatar, so in a headset the own hands would be off the controllers by the same amount (a real headset has to show how that feels) | By design of the new solver (feet on the floor at any model height, against the old solver's eyes at the headset with the feet off the floor, #29); a product decision, not a defect in the code |
| 26 | The new solver's planted feet jump up to 25 cm in one frame when the body has moved away from them (M4 lean, H1: "jump beyond the input" 24 to 25 cm, the bone a foot) | `src/avatar/ik/feet.ts` `placeFoot`: past `STEP_DISTANCE` (0.25 m) the foot "moves it there at once"; no step over several frames | New with the avatar refactor |
| 27 | After any look or turn to the side the new solver's body stays turned up to 20° from where the head looks, and keeps that into the following motions (body turned from the head at the end of a motion: 20° in 9 of 11 VR motions; up to 41° while turning). Visible on the contact sheets: the torso turned toward the observers while the head looks ahead | `src/avatar/ik/body-yaw.ts`: the body follows only beyond the 20° dead band and never turns back inside it | New with the avatar refactor; the old solver turns the hips with the head every frame (0°) |
| 28 | Both solvers let the feet slide with locomotion: about 5.2 m of sliding over M8's four thumbstick pushes, 8.1 to 8.3 m over the desktop walk, 0.3 to 1.5 m with snap and physical turns; on desktop the old solver's feet also turn with the view (1.0 m of sliding while looking around, Ready Player Me) | The new solver plants the feet in the rig's space (`feet.ts`, root space), so the rig's own movement carries them; the old solver keeps the feet at fixed offsets from the root (`legacy/leg-ik.ts`) | Old: code identical on develop. New: new code, the same behaviour |
| 29 | The old solver (the baseline): soles under or over the floor by the model's height difference (Ready Player Me 7 cm under standing, 39 to 41 cm under in the crouch; VRM 16 to 20 cm above standing); VRM 1.0: the head turned 90° from the headset's facing in every frame, knees bent backward through the crouch (195 to 197 frames); elbows folding sideways (55° to 90° from the anatomical way) on all three; one-frame arm flips (Ready Player Me M5: a forearm turned 177° and back, 35.9 cm); hands 29 cm short overhead | `src/avatar/ik/avatar-ik-manager.ts` `updateRootAndHipsTransform` (hips at the headset less the model's hips-to-head, no scaling), `legacy/leg-ik.ts` (ankle targets at the floor), `legacy/head-ik.ts` `adjustEffectorTransform` (writes the head's local rotation outright, as Euler angles meant for the default avatar's bones), `legacy/joint-settings.ts` and `legacy/ccdik-solver.ts` (per-axis limits) | Code identical on develop (the legacy solver). The new solver has none of these (0 wrong-side frames, soles at 0 cm, no flips) |
| 30 | Both solvers bend the VRM models' wrists far while the controllers are held in an ordinary way: at rest 109° for VRM 1.0 with either solver (visible as hands bent back at the wrist), 54° (old) and 76° (new) for VRM 0.x, up to 143° to 178° in the motions; Ready Player Me 24° (old) and 31° (new) at rest | One fixed hand correction for every model facing +z, a third of a turn about x (`solve-body.ts` `HAND_CORRECTION_UNFLIPPED`, `legacy/arm-ik.ts` `rotateX(-Math.PI / 3)`), which fits the default avatar's hand axes, not VRM's | The old solver's: code identical on develop; the new solver kept it |

Not product failures, noted with the evidence:

- The VRM 1.0 sample's shirt sleeves stay out in the rest pose (both solvers): the sample's twist bones are driven by VRM constraints, which the client does not evaluate.
- In the third-person camera of `?thirdPerson` a mouse drag does not turn the head the client sends (TRIALS.md, step 7); the desktop motions run in first person.

T5's numbers per avatar and mode (old → new, all motions, Dialog; local LiveKit within a few per cent):

| Avatar, mode | Hand error mean / max, cm | Wrong-side elbow / knee frames | Lowest sole, cm | Largest joint jump, cm | NaN frames | New solver |
| --- | --- | --- | --- | --- | --- | --- |
| Ready Player Me, VR | 2.7 / 29.5 → 8.4 / 34.7 | 0 / 0 → 0 / 0 | -41.1 → 0 | 35.9 → 25.2 | 0 → 0 | NG (hand error, #25) |
| VRM 0.x, VR | 4.8 / 29.4 → 13.4 / 37.5 | 0 / 0 → 0 / 0 | -17.8 → 0 | 18.1 → 25.1 | 0 → 0 | NG (hand error, #25) |
| VRM 1.0, VR | 7.9 / 39.1 → 12.3 / 35.5 | 0 / 196 → 0 / 0 | -29.8 → 0 | 19.3 → 25.3 | 0 → 0 | NG (hand error, #25) |
| Ready Player Me, desktop | not judged (no controllers) | 0 / 0 → 0 / 0 | -9.2 → 0 | 1.1 → 0.8 | 0 → 0 | OK |
| VRM 0.x, desktop | not judged | 0 / 0 → 0 / 0 | +17.7 → 0 | 0.8 → 0.5 | 0 → 0 | OK |
| VRM 1.0, desktop | not judged | 0 / 0 → 0 / 0 | +16.3 → 0 | 0.9 → 0.8 | 0 → 0 | OK |

The new solver's largest joint jump in VR is #26's foot step (25 cm); the old solver's is an arm flip (#29).

## Repeating it

Switch only hubs, as in plan section 6 and README.md ("Reinstalling the client's dependencies"): stop `hubs-client`, `hubs-admin` and `hubs-storybook`, `git -C services/hubs switch develop`, let mutagen sync, `rm -f package-lock.sha512 && npm ci` in a `hubs-client` and a `hubs-admin` run container, start the three and wait for the compile. Then:

```bash
MEDIA_BLOCK=dialog npx playwright test suites/t1 suites/t2 --grep-invert "T2\.15"
MEDIA_BLOCK=dialog npx playwright test suites/t1 suites/t2-audio -g "T1 smoke on Dialog|T2\.1 both talk on Dialog|T2\.2 mute and unmute with the toolbar on Dialog" --repeat-each=3
MEDIA_BLOCK=livekit-local npx playwright test suites/t1 suites/t2 --grep-invert "T2\.15"
MEDIA_BLOCK=livekit-cloud npx playwright test suites/t1 suites/t2-audio suites/t2-rooms -g "T1 smoke|T2\.1 both|T2\.2 mute|T2\.6 room move"
```

and back the same way.
