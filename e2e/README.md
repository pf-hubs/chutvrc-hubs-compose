# Simulated-client tests

Playwright drives several browsers on this PC, each with its own profile, as if they were separate devices, and has them join rooms on the local stack. The client source is not changed: probes read `APP.*` and browser APIs from outside the page.

## Folders

| Folder | Contents |
| --- | --- |
| `clients/` | Starting and driving a client. `launch.ts`: the profile table (DESK; QUEST, Edge with IWER emulating a Quest 3 and the Quest Browser's user agent; OLD, the previous build from `hubs-client-old`; OLD_QUEST, both; ANDROID, Edge with the Pixel 7 descriptor; IOS and IOS_IPAD, Linux WebKit in `netclient` with the iPhone 15 and iPad (gen 7) descriptors), one browser process and profile directory per client, launch flags, video (fetched from the container for the clients that run there), console capture and the hosts each client sent requests to, and the two modifiers: slow device (`Emulation.setCPUThrottlingRate` 4) and poor network (headless Chromium in `netclient`). `touch.ts`: touch input for the phone and tablet profiles (taps, the two on-screen joysticks, pinch, turning the device). `pilot-mic.ts`: the IOS profiles' microphone, the slot's pilot made with Web Audio (WebKit cannot play a clip file as a microphone). `bot.ts`: BOT clients on the client's own bot path (`?bot=true`), in headless Chromium. `iot.ts`: the IOT client, the libpeer device simulator page. `network.ts`: shaping the poor-network client's link (`tc netem` in one band of a priority queue, so the harness's own connection to the container stays unshaped; offline). `cable.ts`: the player that feeds a clip into the virtual audio cable. `motion.ts`: the QUEST profile's init script (IWER on the browser's own frame function, window frame callbacks held while the immersive session presents, as the Quest Browser does) and the pose timeline player (headset and controllers: position, quaternion, connected flag, thumbstick, buttons), with the timelines T3.5, T4.3 and T4.8 use, and `deviceFromClient`, which turns the pose the client should send into the emulated device's (the client sends the left eye and the controllers moved by the Quest Touch offset). `stage.ts`: placing a subject and observers (rig position and turn, the observers' camera, models hidden from an observer's view) and the viewer setting for the new body solver. `workarounds.ts`: logged workarounds for known product failures (the avatar announcement sent again; a client whose sending failed at a joint join entering again). `signin.ts`: signing in without e-mail. `enter.ts`: the real entry UI. `input.ts`: keys, mouse look, toolbar, popovers, Audio Settings, Share, People, Room Settings, Preferences, placing objects, clicking in-world buttons and paging PDFs. `local-stack.ts`: where the local stack differs from a deployed one |
| `probes/` | Read-only measurements inside a page, through `compat.ts`, the capability layer that reads the session build (APP.sfu a session with the data channel bus, `APP.avatarPoses`) and the adapter build of `develop` alike, and marks what a build lacks as not applicable: `session.ts` (media server session, peers, remote tracks, frame rate), `audio.ts` (pilot heard, a pilot watch that follows a sender across track changes and measures gaps, and for a WebKit receiver the sender's inbound RTP and its level), `video.ts` (remote video drawn to a canvas: frames and mean colour against the sender's own track or clip), `connections.ts` (an init script wraps `RTCPeerConnection`: live count, `getStats` with the selected candidate pair, data channels per label, RTP, bitrates), `packets.ts` (the data channel bus's recording: per label, direction and time), `memory.ts` (JS heap through the DevTools protocol after a collection, `renderer.info.memory`, live connections, trends), `poses.ts` (an avatar's pose as a page holds it; the frame recorder, which samples the sender's own rig objects and the receivers' copies on every animation frame, stamped with the PC's clock; lag and error after alignment, freezes, jerk, CSV), `avatars.ts` (which model a page shows for a client, its rig mapping and bones, neck and name tag, how many avatar models the page holds), `ik.ts` (the inverse kinematics probe: per frame, an observer's model of another client against the pose its solver was given: hand to controller, eyes to headset, elbow and knee sides, soles against the floor, sliding, joint jumps, spine twist, NaN; its maths runs in Node against known answers with `npx tsx probes/ik.ts selftest`), `recording.ts` (the downloaded recording), `errors.ts` (console errors against the allow-list, reticulum.io requests, data channel sends before open) |
| `motions/` | The motion battery of plan 2.4 for T5: `battery.ts` (M1 to M10 written as the poses a person 1.73 m tall would send, in phases that ease in and out, sampled and turned into device poses; the desktop equivalents: stand still, look around, snap turn, walk), `convert-bot-recording.ts` (H1 from the bot's recording in the hubs repository), `convert-room-recording.ts` (a downloaded room recording's sent `#avatar-pose` entries as a timeline). The JSON they write (`npx tsx motions/battery.ts`, `npx tsx motions/convert-bot-recording.ts`) is git-ignored; the suite builds the timelines itself |
| `suites/` | The tests, one file per group (`t1-smoke`, `t2-audio`, `t2-video`, `t2-rooms`, `t2-resilience`, `t2-features`, `t2-soak`, `t3-public-speaking`, `t4-avatar-sync`, `t5-ik`, `t6-features`, `t7-devices`); `harness.ts` (the `test` with the evidence fixture), `blocks.ts` (which tests run in the run's media server block), `common.ts` (entering clients, hearing grids, the closing checks), `global-setup.ts` and `global-teardown.ts`, `console-allowlist.ts` |
| `report/` | `evidence.ts` (per-test evidence folders, `run.json`), `obs.ts` (OBS recordings), `screencast.ts` (a page's frames with the PC's time on each, through the DevTools screencast), `side-by-side.ts` (two observers' frames side by side on one time grid with ffmpeg, videos joined, a contact sheet rendered from HTML to PNG), `grids.ts` (who hears whom and who sees whom, measured from every receiver and drawn as pictures the report shows inline), `mosaic.ts` (every client's video in one mosaic on one time line), `run-scans.ts` (T6.8 and T6.10 over every client of every test of a run, written as the results `t6.8-whole-run` and `t6.10-whole-run`), `reporter.ts` and `build-report.ts` (`evidence/<run-id>/report.html`; T5's verdicts and contact sheets near the top) |
| `assets/` | `media.ts` (pilot frequency and colour per client slot), `generate.ts` (clips, the PDFs, the video file, an image and a GLB, the Crater, N-impro and bitecs scenes), `behavior-graph/` (how to export a Behavior Graph example from Blender for T6.7), `avatars.ts` (downloads the four sample avatars of plan 1.6 and checks their SHA-256), `SOURCES.md`. Served at `https://hubs.local:3001/<path>` by the `assets` service |
| `setup/` | `create-fixtures.ts`: accounts, the scenes (Crater, and N-impro for the `nimpro` room) and the rooms of plan 1.5, written to `fixtures.json` |
| `lib/` | Paths and host names, `docker compose`, SQL and Elixir helpers, `fixtures.json` access, `livekit.ts` (the media server block of a run and switching the server's LiveKit setting) |
| `docker/` | Files for the extra services in `../docker-compose.e2e.yml`: the TLS proxy for LiveKit, the asset server and the poor-network client image |
| `trials/` | Throwaway scripts of the step 2 trials, written up in `TRIALS.md` |

Created on each machine and ignored by git: `node_modules/`, `evidence/`, `.env.local`, `fixtures.json`, `profiles/` (signed-in browser profiles), the generated clips, media and scenes and the downloaded avatars under `assets/`.

`evidence/` and `profiles/` grow to several GB. `EVIDENCE_DIR` and `PROFILES_DIR` in `.env.local` put them elsewhere (absolute, or relative to `e2e/`); on this PC they are `D:\chutvrc-e2e\evidence` and `D:\chutvrc-e2e\profiles`, because drive C: is short of space. Everything that writes or reads them (`lib/env.ts`, `playwright.config.ts`, the report, the trials) follows the settings. A run's `report.html` links its files relatively, so a run folder can be moved as a whole; move the existing folders when changing a setting, or the profiles have to be signed in again (`setup/create-fixtures.ts`).

## Setup

```bash
cd e2e
npm install
npx playwright install chromium webkit
cp .env.local.example .env.local         # OBS WebSocket password, LAN address, evidence and profile directories
npx tsx assets/generate.ts               # clips per client slot, media files, the Crater and N-impro scenes (needs ffmpeg)
npx tsx assets/avatars.ts                # the sample avatars (Ready Player Me, VRM 0.x, VRM 1.0, unfamiliar bone names)
npx tsx setup/create-fixtures.ts         # accounts, signed-in profiles, the scenes, the rooms -> fixtures.json
```

`create-fixtures.ts` can be run again at any time: it reuses the scene and rooms that still exist and signs in profiles whose token no longer works.

Signing in never uses e-mail: the local reticulum has real SMTP settings, so the UI sign-in would send a message to the address typed in. `clients/signin.ts` has reticulum find or create the accounts and sign a token, and stores it in the profile where a finished sign-in leaves it.

The extra services start after `bin/up`, from the compose root:

```bash
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d livekit livekit-tls assets netclient
```

| Service | Reached at |
| --- | --- |
| `livekit`, `livekit-tls` | `wss://hubs.local:7443` (key `devkey`, secret `secret`) |
| `assets` | `https://hubs.local:3001/<path>` from the browsers (a port reticulum's content security policy allows), `http://assets/<path>` inside `mozilla-hubs` |
| `netclient` | `chromium.connect("ws://127.0.0.1:3100")` or `webkit.connect(...)`, launch arguments in the `x-playwright-launch-options` header |
| `hubs-client-old` | `https://hubs.local:8082`; its browser opens `https://hubs.local:8080/hub.html?hub_id=<id>` with `--host-resolver-rules="MAP hubs.local:8080 127.0.0.1:8082"` |

`hubs-client-old` needs a worktree of the old client, with the certificate copied in, before its first start:

```bash
git -C services/hubs worktree add ../hubs-old feature/sfu-refactor
cp -r services/hubs/certs services/hubs-old/
```

Reinstalling the client's dependencies (`conditional-npm-ci`) fails with `ENOTEMPTY` on `node_modules/.cache/storybook` while `hubs-storybook` runs, so stop it with `hubs-client` and `hubs-admin`. The script writes `package-lock.sha512` even when `npm ci` fails; after a failure run `rm -f package-lock.sha512 && npm ci` in the container instead.

## Running

```bash
npx playwright test --list      # what would run
npx playwright test             # everything, one test at a time
npx playwright test suites/t1   # one group
npx playwright test suites/t4 -g "T4\.8 "   # one test of a group; the space keeps "T4\.1 " from also matching T4.10 to T4.12
E2E_OBS=0 npx playwright test   # without OBS recordings
MEDIA_BLOCK=livekit-local npx playwright test   # the LiveKit tests on the local LiveKit server
MEDIA_BLOCK=livekit-cloud npx playwright test   # the LiveKit tests on LiveKit Cloud (LIVEKIT_CLOUD_* in .env.local)
SOAK_MINUTES=5 npx playwright test suites/t2-soak   # T2.15 shortened (40 minutes by default)
npx playwright test suites/t5-ik   # T5 on Dialog: three avatars, VR and desktop, then the contact sheets
MEDIA_BLOCK=livekit-local npx playwright test suites/t5-ik   # T5 on the local LiveKit server
T5_MOTIONS=m01,m05 npx playwright test suites/t5-ik -g "Ready Player Me sample, headset"   # a quick look at two motions
E2E_RUN_ID=<run id> npx playwright test suites/t5-ik -g "VRM 1.0 sample, desktop|contact sheets"   # re-run a test into an existing run's folders, then its summary
npx playwright test suites/t2-audio -g "T2.1" --repeat-each=3   # a flaky test three times, each in its own folder
npm run typecheck
npx tsx report/build-report.ts [run-id]   # rebuild a run's report (the newest when no id is given)
npx playwright test suites/t6-features   # T6 (T6.1, T6.6 and T6.7 only in the Dialog block)
npx playwright test suites/t7-devices -g "T7\.(1|2|3) "   # the headset, the phone, the iPhone and the iPad
T7_MIXED_MINUTES=3 npx playwright test suites/t7-devices -g "T7\.7"   # the mixed room shortened (10 minutes by default)
npx tsx report/run-scans.ts [run-id]      # T6.8 and T6.10 over a whole run again (the reporter writes them after every run)
```

### Media server blocks

Which LiveKit server rooms set to LiveKit use is a server setting, not a room setting (plan 1.4), so a run picks one block with `MEDIA_BLOCK`: `dialog` (the default; the LiveKit setting is left as it is), `livekit-local` (`wss://hubs.local:7443`, `devkey`, `secret`) or `livekit-cloud` (the `LIVEKIT_CLOUD_URL`, `_KEY` and `_SECRET` of `.env.local`). The global setup switches the server setting to the block and restarts reticulum; the global teardown puts back what it found (`MEDIA_BLOCK_RESTORE=0` leaves it switched on, for several runs in one block). Each test is written for a media server: Dialog tests run in the Dialog block, LiveKit tests in whichever LiveKit block is active, and their ids carry the block (`t2.1-dialog`, `t2.1-livekit-local`, `t2.1-livekit-cloud`); the others are skipped with the reason. `run.json` records the block and the LiveKit setting before and during the run. By hand: `npx tsx lib/livekit.ts show | local | cloud | unset` (values are never printed).

Before the tests, `suites/global-setup.ts` stops the run when `PRIVATE_NETWORK_IP` is no longer this PC's address or the stack does not answer, restarts reticulum when its clock has fallen behind (below), and writes `run.json`.

Each run writes `evidence/<run-id>/`: `run.json` (commits of the five repositories, browser versions, media server block, the reticulum clock), and per test a folder with named screenshots, a video per client, console logs, saved data, the OBS recording when OBS is reachable, and `result.json`. `report.html` in the run folder names the hubs branch, commit and client API in its header, and lists every test with its status (OK, NG, skipped, known limitation, invalid, not applicable), the checks with their numbers and the checklist items they cover, thumbnails and links. "Not applicable" is a check that needs what the tested build does not have, such as the packet log on `develop`; it counts neither way.

`BASELINE.md` records which of the target's failures were already on `develop` (plan step 5).

### Device profiles (T7)

| Profile | Built from | Input | What it cannot show |
| --- | --- | --- | --- |
| ANDROID | visible Edge with Playwright's Pixel 7 descriptor (412 x 839, pixel ratio 2.625, touch, Chrome on Android's user agent); the clips as fake devices | touches through the DevTools protocol (`Input.dispatchTouchEvent`): the two on-screen joysticks, taps on the toolbar and menus, a pinch; turning the device swaps the viewport (Playwright sets the screen orientation with it) | a phone's GPU and thermal limits, Chrome on Android itself, a real microphone |
| IOS, IOS_IPAD | Playwright's Linux WebKit inside `netclient` (`webkit.connect`) with the iPhone 15 or iPad (gen 7) descriptor; software rendering (about 25 and 15 frames a second); WebKit's mock camera; the microphone is the slot's pilot made with Web Audio (`clients/pilot-mic.ts`) | taps through Playwright's touchscreen; drags (the joysticks) as pointer and touch events dispatched in the page | Safari and iOS themselves (media, autoplay and audio session rules, WebRTC, codecs), a phone's GPU; its own hearing is measured from WebRTC statistics (packets and level), because its Web Audio cannot read a remote WebRTC track |
| slow device | `Emulation.setCPUThrottlingRate` 4 on the page's target (Chromium profiles) | as the profile | a real slow device's GPU |
| poor network | headless Chromium inside `netclient`, the link shaped with `tc netem` (loss and jitter, a rate limit, a blackout) | as the profile | a real network; renders in software, so its rates are not judged |

Every T7 test saves "who hears whom" and "who sees whom" as pictures (`grid-hear-*.png`, `grid-see-*.png`) shown in the test's card of the report; T7.7 also makes `mosaic.mp4`, every client's video on one time line. T7.7 runs its six Edge clients headless (on the GPU): with six visible windows and the bots, Edge did not finish starting on this PC. The poor-network client's frames are moved onto the PC's clock (the container's clock is a few seconds off) before T7.5 compares them. Clients whose sending failed at a joint join on Dialog (known failures 3 and 21) enter again, logged as a workaround; the T7 tests are about the device profiles.

## Where the local stack differs

- **Room links.** Reticulum's media resolver refuses its own rooms here: `hubs.local` is `127.0.0.1` inside its container, an internal address, so placing a room URL gets a 500. `clients/local-stack.ts` answers that one request as a deployed server would (the URL and the room page's `og:image`); the link object, its "visit room" button and the room change are the client's own. Every T1 run records what reticulum answered.
- **Reticulum's clock.** The long-running reticulum server's Erlang clock falls behind the container's clock on this PC (163 s an hour after a start, 321 s 40 minutes later). Tokens it signs then look issued in the past: Dialog rejects the 5-minute permission token as expired once the gap passes 300 s, and nobody can enter a room. `restartReticulum()` resets it; the global setup does that when the gap is over 60 s. Tokens that `signin.ts` signs in a separate process are dated 10 minutes back for the same reason.
- **OBS.** The harness starts and stops an OBS recording per test that asks for one and moves the file into the evidence folder. It notes when OBS's scene renders black (its screen capture source captures nothing) and how loud the recorded sound is.
- **The emulated headset.** IWER runs in Edge, which keeps calling the page's window frame callbacks while an immersive session presents; the Quest Browser does not. The QUEST profile holds those callbacks during the session, as the headset's browser does; without that the scene ticks twice per frame in VR and stops drawing after leaving VR (TRIALS.md, (b), step 6).
- **Avatars left in profiles.** A test that picks a sample avatar leaves it in the signed-in profile; `startClients()` removes such an avatar again, so every test starts from the client's default avatar (the local stack has no default avatar listings, so the client falls back to its bundled one).
- **Place menu.** The toolbar popovers' content is mounted afresh on every render, many times a second in a room, so Playwright's `click()` never sees a stable element there; `clickPopoverItem()` presses the mouse at the item's position, as a person does.
- **Admin pages.** The admin build's `.defaults.env` names an Ita service at `http://localhost:3333` that the local stack does not run; the admin pages log the refused requests and use reticulum's `/api/v1/server_configs` instead (T6.1 saves through that path). T6.1 compares the server settings by hash only, masks every text field in its screenshots, records no video of that client, and puts back anything a save changed.
- **The web app manifest on the IOS profile.** Reticulum answers 404 for `/manifest.webmanifest` to Safari user agents on purpose (no installable app on iOS); WebKit logs it.

`TRIALS.md` records what the step 2 trials found; the scripts under `trials/` are the throwaway code behind it.
