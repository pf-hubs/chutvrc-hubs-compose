# Simulated-client tests

Playwright drives several browsers on this PC, each with its own profile, as if they were separate devices, and has them join rooms on the local stack. The client source is not changed: probes read `APP.*` and browser APIs from outside the page.

## Folders

| Folder | Contents |
| --- | --- |
| `clients/` | Starting and driving a client. `launch.ts`: the profile table (DESK so far; QUEST, ANDROID, IOS and OLD come with later steps), one Edge process and profile directory per client, launch flags, video, console capture, and the poor-network modifier (headless Chromium in `netclient`). `bot.ts`: BOT clients on the client's own bot path (`?bot=true`), in headless Chromium. `iot.ts`: the IOT client, the libpeer device simulator page. `network.ts`: shaping the poor-network client's link (`tc netem`, offline). `cable.ts`: the player that feeds a clip into the virtual audio cable. `workarounds.ts`: logged workarounds for known product failures. `signin.ts`: signing in without e-mail. `enter.ts`: the real entry UI. `input.ts`: keys, mouse look, toolbar, popovers, Audio Settings, Share, People, Room Settings, Preferences, placing objects, clicking in-world buttons and paging PDFs. `local-stack.ts`: where the local stack differs from a deployed one |
| `probes/` | Read-only measurements inside a page, through `compat.ts`, the capability layer that reads the session build (APP.sfu a session with the data channel bus, `APP.avatarPoses`) and the adapter build of `develop` alike, and marks what a build lacks as not applicable: `session.ts` (media server session, peers, remote tracks, frame rate), `audio.ts` (pilot heard, and a pilot watch that follows a sender across track changes and measures gaps), `video.ts` (remote video drawn to a canvas: frames and mean colour against the sender's own track or clip), `connections.ts` (an init script wraps `RTCPeerConnection`: live count, `getStats` with the selected candidate pair, data channels per label, RTP, bitrates), `packets.ts` (the data channel bus's recording: per label, direction and time), `memory.ts` (JS heap through the DevTools protocol after a collection, `renderer.info.memory`, live connections, trends), `poses.ts`, `recording.ts` (the downloaded recording), `errors.ts` (console errors against the allow-list, reticulum.io requests, data channel sends before open) |
| `motions/` | Headset and controller pose timelines (M1 to M10, H1) and the scripts that convert recordings into timelines (later steps) |
| `suites/` | The tests, one file per group (`t1-smoke`, `t2-audio`, `t2-video`, `t2-rooms`, `t2-resilience`, `t2-features`, `t2-soak`, later `t3` to `t7`); `harness.ts` (the `test` with the evidence fixture), `blocks.ts` (which tests run in the run's media server block), `common.ts` (entering clients, hearing grids, the closing checks), `global-setup.ts` and `global-teardown.ts`, `console-allowlist.ts` |
| `report/` | `evidence.ts` (per-test evidence folders, `run.json`), `obs.ts` (OBS recordings), `reporter.ts` and `build-report.ts` (`evidence/<run-id>/report.html`) |
| `assets/` | `media.ts` (pilot frequency and colour per client slot), `generate.ts` (clips, the PDFs and the video file, the Crater scene and the N-impro scene), `SOURCES.md`. Served at `https://hubs.local:3001/<path>` by the `assets` service |
| `setup/` | `create-fixtures.ts`: accounts, the scenes (Crater, and N-impro for the `nimpro` room) and the rooms of plan 1.5, written to `fixtures.json` |
| `lib/` | Paths and host names, `docker compose`, SQL and Elixir helpers, `fixtures.json` access, `livekit.ts` (the media server block of a run and switching the server's LiveKit setting) |
| `docker/` | Files for the extra services in `../docker-compose.e2e.yml`: the TLS proxy for LiveKit, the asset server and the poor-network client image |
| `trials/` | Throwaway scripts of the step 2 trials, written up in `TRIALS.md` |

Created on each machine and ignored by git: `node_modules/`, `evidence/`, `.env.local`, `fixtures.json`, `profiles/` (signed-in browser profiles), the generated clips and scene under `assets/`.

`evidence/` and `profiles/` grow to several GB. `EVIDENCE_DIR` and `PROFILES_DIR` in `.env.local` put them elsewhere (absolute, or relative to `e2e/`); on this PC they are `D:\chutvrc-e2e\evidence` and `D:\chutvrc-e2e\profiles`, because drive C: is short of space. Everything that writes or reads them (`lib/env.ts`, `playwright.config.ts`, the report, the trials) follows the settings. A run's `report.html` links its files relatively, so a run folder can be moved as a whole; move the existing folders when changing a setting, or the profiles have to be signed in again (`setup/create-fixtures.ts`).

## Setup

```bash
cd e2e
npm install
npx playwright install chromium webkit
cp .env.local.example .env.local         # OBS WebSocket password, LAN address, evidence and profile directories
npx tsx assets/generate.ts               # clips per client slot, media files, the Crater and N-impro scenes (needs ffmpeg)
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
E2E_OBS=0 npx playwright test   # without OBS recordings
MEDIA_BLOCK=livekit-local npx playwright test   # the LiveKit tests on the local LiveKit server
MEDIA_BLOCK=livekit-cloud npx playwright test   # the LiveKit tests on LiveKit Cloud (LIVEKIT_CLOUD_* in .env.local)
SOAK_MINUTES=5 npx playwright test suites/t2-soak   # T2.15 shortened (40 minutes by default)
npx playwright test suites/t2-audio -g "T2.1" --repeat-each=3   # a flaky test three times, each in its own folder
npm run typecheck
npx tsx report/build-report.ts [run-id]   # rebuild a run's report (the newest when no id is given)
```

### Media server blocks

Which LiveKit server rooms set to LiveKit use is a server setting, not a room setting (plan 1.4), so a run picks one block with `MEDIA_BLOCK`: `dialog` (the default; the LiveKit setting is left as it is), `livekit-local` (`wss://hubs.local:7443`, `devkey`, `secret`) or `livekit-cloud` (the `LIVEKIT_CLOUD_URL`, `_KEY` and `_SECRET` of `.env.local`). The global setup switches the server setting to the block and restarts reticulum; the global teardown puts back what it found (`MEDIA_BLOCK_RESTORE=0` leaves it switched on, for several runs in one block). Each test is written for a media server: Dialog tests run in the Dialog block, LiveKit tests in whichever LiveKit block is active, and their ids carry the block (`t2.1-dialog`, `t2.1-livekit-local`, `t2.1-livekit-cloud`); the others are skipped with the reason. `run.json` records the block and the LiveKit setting before and during the run. By hand: `npx tsx lib/livekit.ts show | local | cloud | unset` (values are never printed).

Before the tests, `suites/global-setup.ts` stops the run when `PRIVATE_NETWORK_IP` is no longer this PC's address or the stack does not answer, restarts reticulum when its clock has fallen behind (below), and writes `run.json`.

Each run writes `evidence/<run-id>/`: `run.json` (commits of the five repositories, browser versions, media server block, the reticulum clock), and per test a folder with named screenshots, a video per client, console logs, saved data, the OBS recording when OBS is reachable, and `result.json`. `report.html` in the run folder names the hubs branch, commit and client API in its header, and lists every test with its status (OK, NG, skipped, known limitation, invalid, not applicable), the checks with their numbers and the checklist items they cover, thumbnails and links. "Not applicable" is a check that needs what the tested build does not have, such as the packet log on `develop`; it counts neither way.

`BASELINE.md` records which of the target's failures were already on `develop` (plan step 5).

## Where the local stack differs

- **Room links.** Reticulum's media resolver refuses its own rooms here: `hubs.local` is `127.0.0.1` inside its container, an internal address, so placing a room URL gets a 500. `clients/local-stack.ts` answers that one request as a deployed server would (the URL and the room page's `og:image`); the link object, its "visit room" button and the room change are the client's own. Every T1 run records what reticulum answered.
- **Reticulum's clock.** The long-running reticulum server's Erlang clock falls behind the container's clock on this PC (163 s an hour after a start, 321 s 40 minutes later). Tokens it signs then look issued in the past: Dialog rejects the 5-minute permission token as expired once the gap passes 300 s, and nobody can enter a room. `restartReticulum()` resets it; the global setup does that when the gap is over 60 s. Tokens that `signin.ts` signs in a separate process are dated 10 minutes back for the same reason.
- **OBS.** The harness starts and stops an OBS recording per test that asks for one and moves the file into the evidence folder. It notes when OBS's scene renders black (its screen capture source captures nothing) and how loud the recorded sound is.
- **Place menu.** The toolbar popovers' content is mounted afresh on every render, many times a second in a room, so Playwright's `click()` never sees a stable element there; `clickPopoverItem()` presses the mouse at the item's position, as a person does.

`TRIALS.md` records what the step 2 trials found; the scripts under `trials/` are the throwaway code behind it.
