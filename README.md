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

## Quick Start (double-click)

The fastest way to get a single-device development instance running is the
one-click setup script for your platform.

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and start it.
2. Clone this repository.
3. Double-click the script for your platform:
   - **macOS:** `local-setup-mac.command` (in Finder)
   - **Windows:** `local-setup-windows.bat` (in Explorer)

The script installs the remaining dependencies (`mutagen`, `mutagen-compose`,
`mkcert`), clones each service from `pf-hubs/chutvrc-*`, builds the Docker
images, generates SSL certificates with `mkcert`, configures your hosts file,
and starts everything. It then guides you through signing in and promoting
your account to admin.

When the guided setup finishes, chutvrc is available at
**https://hubs.local:4000**.

> **Linux:** the double-click flow is not packaged yet. Follow
> [`MANUAL_SETUP.md`](MANUAL_SETUP.md) instead.
>
> **LAN / Remote server:** the double-click flow only covers single-device
> (Scenario A). For multi-device or public-domain hosting, follow
> [`MANUAL_SETUP.md`](MANUAL_SETUP.md).

---

## Daily usage

| Action  | Command                                       |
| ------- | --------------------------------------------- |
| Start   | `bin/up`                                      |
| Stop    | `bin/down`                                    |
| Restart | `bin/down && mutagen daemon stop && bin/up`   |
| Reset   | `bin/reset` (recreates containers and images) |

Code edits in `services/*` are picked up automatically by Mutagen while the
containers are running.

> **Known issue:** After restarting with `bin/down` and `bin/up`, Hubs may
> fail to connect to Dialog (port 4443). Fully **quit** Docker Desktop and
> start it again (a "Restart" from the Docker Desktop menu is not enough),
> then run `bin/up`.

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
*"For Virtual Reality Educational Research Center, chutvrc related
research/educational purpose."*

> Please be aware that 30% of the donation amount is used by the university
> administration office regardless of the stated purpose.

---

## License

[Mozilla Public License 2.0](LICENSE) — inherited from upstream Hubs Compose.
