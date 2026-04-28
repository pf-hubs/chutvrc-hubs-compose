# chutvrc Compose

Docker Compose setup for running [**chutvrc**](https://github.com/pf-hubs/chutvrc-hubs) — a fork of [Hubs](https://github.com/Hubs-Foundation) — on your local machine. Orchestrates the four chutvrc services (Reticulum, Dialog, Hubs client, Spoke) so you can bring everything up with one command. Runs on macOS, Windows, and Linux.

> **Important:** This is not a production-ready setup. It does not account for
> security or scalability. The included permissions files were generated for
> development purposes only.

---

## What chutvrc adds on top of Hubs

chutvrc is a fork of the [Hubs](https://github.com/Hubs-Foundation) online 3D collaboration platform that works on desktop, mobile, and VR. The notable additions are:

- **Full-body avatars** — supports humanoid avatars from
  [ReadyPlayerMe](https://readyplayer.me/) and
  [VRoid](https://vroid.com/) (with the file extension renamed from `.vrm` to
  `.glb`). Tested mainly with Meta Quest 3 controller and bare-hand tracking.
- **Independent BitECS implementation** — avatar management built on BitECS,
  separate from Hubs' official BitECS work (a future merge is planned).
- **Alternative WebRTC SFU** — Sora support in addition to Dialog, for
  environments where running and maintaining Dialog is impractical. The SFU is
  selectable per room from the admin panel.
- **Avatar transform sync over WebRTC DataChannel** — body language travels
  alongside voice on the same protocol. Works with both Dialog and Sora.
- **Public speaking mode** — broadcast a single user's audio and avatar to
  multiple rooms, useful for delivering speeches beyond a single room's
  capacity.

For the full feature list and screenshots, see the
[chutvrc client README](services/hubs/README.md).

---

## Quick Start (double-click) — one-time setup

The fastest way to get a single-device development instance running is the
one-click setup script for your platform. **Run this only once**, the very
first time you set up the project. After that, use the daily commands in the
next section.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and start it.
2. Clone this repository.
3. Double-click the script for your platform:
   - **macOS:** `local-setup-mac.command` (in Finder)
   - **Windows:** `local-setup-windows.bat` (in Explorer)

The script installs the remaining dependencies (`mutagen`, `mutagen-compose`,
`mkcert`), clones each service from `pf-hubs/chutvrc-*` into `services/`,
builds the Docker images, generates SSL certificates with `mkcert`,
configures your hosts file, and starts everything. It then guides you through
signing in and promoting your account to admin.

When the guided setup finishes, chutvrc is available at
**https://hubs.local:4000**.

The setup leaves a marker file (`.bin-init-completed`) in the project root.
If you re-run the setup script later, it will detect this and skip the heavy
`bin/init` step. To force a clean re-initialization, delete that file and run
`bin/reset`.

> **Linux:** the double-click flow is not packaged yet. Follow
> [`MANUAL_SETUP.md`](MANUAL_SETUP.md) instead.
>
> **LAN / Remote server:** the double-click flow only covers single-device
> (Scenario A). For multi-device or public-domain hosting, follow
> [`MANUAL_SETUP.md`](MANUAL_SETUP.md).

---

## Daily usage

After the one-time setup is finished, you do **not** need to run the setup
script again. To start chutvrc on subsequent days, just bring the services
up:

| Action  | Command                                       |
| ------- | --------------------------------------------- |
| Start   | `bin/up`                                      |
| Stop    | `bin/down`                                    |
| Restart | `bin/down && mutagen daemon stop && bin/up`   |
| Reset   | `bin/reset` (recreates containers and images) |

### Double-click start (optional)

If you'd rather not open a terminal each time, use the start script for your
platform — it just runs `bin/up` after a quick sanity check:

- **macOS:** double-click `start-mac.command`
- **Windows:** double-click `start-windows.bat`
- **Linux:** run `./start-linux.sh` from a terminal, or double-click it in
  your file manager if your desktop environment is configured to execute
  shell scripts on double-click (most ask whether to _Run_ or _Open in
  editor_ the first time).

These are **start-only** scripts. Do not confuse them with
`local-setup-mac.command` / `local-setup-windows.bat`, which run the full
one-time setup (cloning repos, building images, generating certificates,
etc.) and should not be repeated daily. On Linux there is no setup script —
follow [`MANUAL_SETUP.md`](MANUAL_SETUP.md) for the one-time setup, then use
`start-linux.sh` for daily start.

Make sure Docker is running before launching them (Docker Desktop on
macOS / Windows, or `sudo systemctl start docker` on Linux with Docker
Engine).

### Code edits

Code edits in `services/*` are picked up automatically by Mutagen while the
containers are running, so most day-to-day development does not require
restarting anything.

> **Known issue:** After restarting with `bin/down` and `bin/up`, Hubs may
> fail to connect to Dialog (port 4443). Fully **quit** Docker Desktop and
> start it again (a "Restart" from the Docker Desktop menu is not enough),
> then run `bin/up`.

---

## Customizing components

Each chutvrc service lives under `services/` as an **independent git
repository** that the setup script cloned for you:

| Folder               | Upstream                                                 |
| -------------------- | -------------------------------------------------------- |
| `services/reticulum` | https://github.com/pf-hubs/chutvrc-reticulum             |
| `services/dialog`    | https://github.com/pf-hubs/chutvrc-dialog                |
| `services/hubs`      | https://github.com/pf-hubs/chutvrc-hubs (client + admin) |
| `services/spoke`     | https://github.com/pf-hubs/chutvrc-spoke                 |

Because each one is a real git checkout, you can develop in it the same way
you would any other repository.

### Working on a component

1. `cd` into the component you want to change, e.g. `cd services/hubs`.
2. Inspect the current branch — `git status`. The setup checks out the
   `main` branch by default.
3. Create your own branch off it:
   ```bash
   git checkout -b my-feature
   ```
4. Edit the code. Mutagen syncs the changes into the running container, so
   most edits take effect without restarting (the Hubs client and Spoke do
   hot module replacement; Reticulum and Dialog restart on file changes).
5. Commit on your branch as usual.

### Recommended: fork your own repository

If you plan to keep your changes long-term, fork the relevant
`pf-hubs/chutvrc-*` repository to your own GitHub account / organization and
push your branch there:

```bash
cd services/hubs
git remote rename origin upstream
git remote add origin https://github.com/<your-account>/<your-fork>.git
git push -u origin my-feature
```

This keeps `upstream` pointing at `pf-hubs` so you can still pull in updates
(`git fetch upstream && git merge upstream/main`),
while `origin` points at your own fork for pushing.

### Pointing the setup script at your fork (optional)

By default, `bin/init` clones each service from `pf-hubs/chutvrc-*`. If you
want a fresh setup (on another machine, or for a teammate) to clone **your
fork** instead, you have two options:

- **Edit `bin/init`** — change the `clone_or_skip` lines (around lines 23–26)
  to use your fork URL and your branch name. The cloning is idempotent, so
  it's safe to re-run.
- **Pre-clone manually** — before running the setup script, clone your fork
  into the matching `services/<name>` directory yourself. `bin/init` skips
  any service that already has a `.git` folder, so it will leave your
  pre-cloned copy alone.

Whether or not to commit the edited `bin/init` to your own fork of
`hubs-compose` is up to you. If you commit it, anyone who clones your
`hubs-compose` fork will get your service forks automatically.

---

## Other documentation

- [`MANUAL_SETUP.md`](MANUAL_SETUP.md) — manual `bin/init`, certificate, and
  scenario configuration. Covers Scenarios A (single device), B (LAN), and
  C (remote server with a public domain). Use this if the double-click flow
  doesn't fit your environment, or for Linux.
- [`SSL_SETUP.md`](SSL_SETUP.md) — standalone walk-through of the
  `mkcert`-based local SSL setup (a subset of `MANUAL_SETUP.md`).
- [`k8s/`](k8s/) — Kubernetes deployment manifests and step-by-step deploy
  manuals (English and Japanese, under `k8s/docs/deploy-manual/`) for hosting
  chutvrc on a server.
- [`LEGACY_HUBS_COMPOSE.md`](LEGACY_HUBS_COMPOSE.md) — the original Hubs
  Compose `README.md` that this fork was based on. Targets the now-deprecated
  Mozilla Hubs / Hubs-Foundation services and **does not reflect the chutvrc
  workflow**. Kept only for historical reference.
- [`decisions/`](decisions/) — architectural decision records for changes that
  affect the structure or interfaces of the project.

---

## Funding and Sponsor

chutvrc is sponsored and developed for the
[CHANGE Project](https://change.kawasaki-net.ne.jp/en/) by a research team at
the [Virtual Reality Educational Research Center](https://vr.u-tokyo.ac.jp/),
The University of Tokyo.

You can support this development through the GitHub Sponsor button, which is
linked to the [UTokyo Foundation](https://utf.u-tokyo.ac.jp/en). If you want
to support this project specifically, write in the donation purpose:
_"For Virtual Reality Educational Research Center, chutvrc related
research/educational purpose."_

> Please be aware that 30% of the donation amount is used by the university
> administration office regardless of the stated purpose.

---

## License

[Mozilla Public License 2.0](LICENSE) — inherited from upstream Hubs Compose.
