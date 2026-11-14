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
docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d livekit livekit-tls
```

`hubs-client-old` needs a worktree of the old client first: `git -C services/hubs worktree add ../hubs-old feature/sfu-refactor`.

## Running

```bash
npx playwright test --list      # what would run
npx playwright test             # everything, one test at a time
npx playwright test suites/t1   # one group
npm run typecheck
```
