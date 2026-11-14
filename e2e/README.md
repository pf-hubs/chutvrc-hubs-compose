# Simulated-client tests

Playwright drives several browsers on this PC, each with its own profile, as if they were separate devices, and has them join rooms on the local stack. The client source is not changed: probes read `APP.*` and browser APIs from outside the page.

## Folders

| Folder | Contents |
| --- | --- |
| `clients/` | Starting and driving a client. `launch.ts`: the profile table (DESK so far; QUEST, ANDROID, IOS, OLD, BOT and the modifiers come with later steps), one Edge process and profile directory per client, launch flags, video, console capture. `signin.ts`: signing in without e-mail. `enter.ts`: the real entry UI. `input.ts`: keys, mouse look, toolbar, placing objects, clicking in-world buttons. `local-stack.ts`: where the local stack differs from a deployed one |
| `probes/` | Read-only measurements inside a page: `session.ts` (media server session, peers, frame rate), `audio.ts` (pilot heard), `poses.ts`, `recording.ts` (the downloaded recording), `errors.ts` (console errors against the allow-list, reticulum.io requests, data channel sends before open). Step 4 adds video, connections, packets, memory |
| `motions/` | Headset and controller pose timelines (M1 to M10, H1) and the scripts that convert recordings into timelines (later steps) |
| `suites/` | The tests, one file per group (`t1-smoke` to `t7-devices`); `harness.ts` (the `test` with the evidence fixture), `global-setup.ts`, `console-allowlist.ts` |
| `report/` | `evidence.ts` (per-test evidence folders, `run.json`), `obs.ts` (OBS recordings), `reporter.ts` and `build-report.ts` (`evidence/<run-id>/report.html`) |
| `assets/` | `media.ts` (pilot frequency and colour per client slot), `generate.ts` (clips and the scene), `SOURCES.md`. Served at `https://hubs.local:3001/<path>` by the `assets` service |
| `setup/` | `create-fixtures.ts`: accounts, the scene and the rooms of plan 1.5, written to `fixtures.json` |
| `lib/` | Paths and host names, `docker compose`, SQL and Elixir helpers, `fixtures.json` access |
| `docker/` | Files for the extra services in `../docker-compose.e2e.yml`: the TLS proxy for LiveKit, the asset server and the poor-network client image |
| `trials/` | Throwaway scripts of the step 2 trials, written up in `TRIALS.md` |

Created on each machine and ignored by git: `node_modules/`, `evidence/`, `.env.local`, `fixtures.json`, `profiles/` (signed-in browser profiles), the generated clips and scene under `assets/`.

## Setup

```bash
cd e2e
npm install
npx playwright install chromium webkit
cp .env.local.example .env.local         # OBS WebSocket password, LAN address
npx tsx assets/generate.ts               # clips per client slot, and the Crater scene file (needs ffmpeg)
npx tsx setup/create-fixtures.ts         # accounts, signed-in profiles, the scene, the rooms -> fixtures.json
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
npm run typecheck
npx tsx report/build-report.ts [run-id]   # rebuild a run's report (the newest when no id is given)
```

Before the tests, `suites/global-setup.ts` stops the run when `PRIVATE_NETWORK_IP` is no longer this PC's address or the stack does not answer, restarts reticulum when its clock has fallen behind (below), and writes `run.json`.

Each run writes `evidence/<run-id>/`: `run.json` (commits of the five repositories, browser versions, media server block, the reticulum clock), and per test a folder with named screenshots, a video per client, console logs, saved data, the OBS recording when OBS is reachable, and `result.json`. `report.html` in the run folder lists every test with its status (OK, NG, skipped, known limitation, invalid), the checks with their numbers and the checklist items they cover, thumbnails and links.

## Where the local stack differs

- **Room links.** Reticulum's media resolver refuses its own rooms here: `hubs.local` is `127.0.0.1` inside its container, an internal address, so placing a room URL gets a 500. `clients/local-stack.ts` answers that one request as a deployed server would (the URL and the room page's `og:image`); the link object, its "visit room" button and the room change are the client's own. Every T1 run records what reticulum answered.
- **Reticulum's clock.** The long-running reticulum server's Erlang clock falls behind the container's clock on this PC (163 s an hour after a start, 321 s 40 minutes later). Tokens it signs then look issued in the past: Dialog rejects the 5-minute permission token as expired once the gap passes 300 s, and nobody can enter a room. `restartReticulum()` resets it; the global setup does that when the gap is over 60 s. Tokens that `signin.ts` signs in a separate process are dated 10 minutes back for the same reason.
- **OBS.** The harness starts and stops an OBS recording per test that asks for one and moves the file into the evidence folder. It notes when OBS's scene renders black (its screen capture source captures nothing) and how loud the recorded sound is.
- **Place menu.** The toolbar popovers' content is mounted afresh on every render, many times a second in a room, so Playwright's `click()` never sees a stable element there; `clickPopoverItem()` presses the mouse at the item's position, as a person does.

`TRIALS.md` records what the step 2 trials found; the scripts under `trials/` are the throwaway code behind it.
