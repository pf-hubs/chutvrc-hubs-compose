# Simulated-client tests

Playwright drives several browsers on this PC, each with its own profile, as if they were separate devices, and has them join rooms on the local stack. The client source is not changed: probes read `APP.*` and browser APIs from outside the page.

## Folders

| Folder | Contents |
| --- | --- |
| `clients/` | Starting and driving a client: launch profiles and modifiers (desktop, headset, phone, tablet, old build, slow device, poor network), signing in, entering a room, keyboard, mouse and touch input, playing motion timelines |
| `probes/` | Read-only measurements taken inside a page: session state, audio heard, video seen, peer connections, packet log, avatar poses, body solver, memory, errors |
| `motions/` | Headset and controller pose timelines (M1 to M10, H1) and the scripts that convert recordings into timelines |
| `suites/` | The tests, one file per group (`t1-smoke` to `t7-devices`). `scaffold.spec.ts` is a placeholder until the first suite exists |
| `report/` | Builds `evidence/<run-id>/report.html` from a run's results and evidence |
| `assets/` | Clips, media and avatars the clients use, each listed with its source and licence in `assets/SOURCES.md`. Served to the containers by the `assets` service |
| `docker/` | Files for the extra services in `../docker-compose.e2e.yml`: the TLS proxy for LiveKit, the asset server and the poor-network client image |
| `trials/` | Throwaway scripts of the step 2 trials, written up in `TRIALS.md` |

Created on each machine and ignored by git: `node_modules/`, `evidence/` (one folder per run, with `results.json` and Playwright's output), `.env.local`, `fixtures.json`, `profiles/` (signed-in browser profiles).

## Setup

```bash
cd e2e
npm install
npx playwright install chromium webkit
cp .env.local.example .env.local         # OBS WebSocket password, LAN address
cp fixtures.example.json fixtures.json   # room ids, filled in once the rooms exist
```

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

`TRIALS.md` records what the step 2 trials found; the scripts under `trials/` are the throwaway code behind it.

## Running

```bash
npx playwright test --list      # what would run
npx playwright test             # everything, one test at a time
npx playwright test suites/t1   # one group
npm run typecheck
```
