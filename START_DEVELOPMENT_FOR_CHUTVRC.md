# chutvrc Compose — Getting Started

chutvrc Compose is a Docker Compose setup for orchestrating all services used by
chutvrc for local development. It runs on macOS, Linux, and Windows.

> **Important:** This is not a production-ready setup. It does not account for
> security or scalability. The permissions files were generated for development
> purposes only.

> **Note (26260326):** The configuration steps here are not fully validated yet for Linux and Windows.

---

## Quick Start (Recommended)

For **Scenario A (Local Single-Device Development)**, use the one-click setup
scripts that automate prerequisites installation and initial setup:

- **macOS:** Double-click `local-setup-mac.command` in Finder.
- **Windows:** Double-click `local-setup-windows.bat` in Explorer.

The scripts will install dependencies, initialize services, generate SSL
certificates, configure the hosts file, and start everything up. They then
guide you interactively through the remaining steps — including automatically
fetching the sign-in link and promoting your account to admin.

> **Note:** If you prefer to set up manually or need a different scenario
> (LAN or Remote Server), follow the full instructions below.

---

# Manual Setup for chutvrc Compose

## 1. Prerequisites

### All Platforms

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — includes
  both Docker Engine and Docker Compose. Download and install for your platform.
- [Mutagen](https://mutagen.io/documentation/introduction/installation)
- [Mutagen Compose](https://github.com/mutagen-io/mutagen-compose#system-requirements)
- [mkcert](https://github.com/FiloSottile/mkcert) (for trusted local SSL certificates)

> **Note:** The version of Mutagen Compose you install must match the version of
> Mutagen. If you install the latest versions at the same time, they will match.

### macOS

1. Install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/).
2. Install the remaining dependencies via [Homebrew](https://brew.sh/):
   ```bash
   brew install mutagen-io/mutagen/mutagen mutagen-io/mutagen/mutagen-compose mkcert
   ```

> **Note:** If you prefer not to install Docker Desktop, standalone Homebrew
> formulae are available for
> [docker](https://formulae.brew.sh/formula/docker) and
> [docker-compose](https://formulae.brew.sh/formula/docker-compose).

### Linux

1. Install [Docker Desktop for Linux](https://docs.docker.com/desktop/setup/install/linux/)
   or install [Docker Engine](https://docs.docker.com/engine/install/) directly.
   If using Docker Engine, add your user to the `docker` group so you do not
   need `sudo`.
2. Install Mutagen and Mutagen Compose. Installing the binaries manually in
   `/usr/local/bin` is recommended.
3. Install `mkcert` via your package manager (e.g., `apt install mkcert` or
   `yay -S mkcert`), or via [Linuxbrew](https://brew.sh/).

### Windows

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
2. **(Recommended)** Install [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install).
   Docker Desktop runs more quickly with its WSL2-based engine.
3. Use **Git Bash** (MINGW64) to run all `bin/` scripts. The Windows Terminal
   will not work.
4. Configure Git to preserve Unix line endings:
   ```bash
   git config --global core.autocrlf false
   ```
   If you have already cloned this repository, delete your local copy and
   re-clone it after changing this setting.
5. `mkcert` is installed automatically by `local-setup-windows.bat` — it
   downloads the latest release from
   [mkcert's GitHub releases](https://github.com/FiloSottile/mkcert/releases/latest)
   into `%LOCALAPPDATA%\mkcert\` and adds it to your user PATH (no admin
   needed). If you prefer, you can pre-install it yourself with
   [Scoop](https://scoop.sh/) (`scoop install mkcert`) or by downloading the
   binary manually from the releases page.

---

## 2. Initial Setup

### Step 1 — Start Docker

Launch Docker Desktop (macOS / Windows) or start the Docker daemon (Linux).

### Step 2 — Initialize Services

```bash
bin/init
```

This clones the chutvrc service repositories, checks out the correct branches,
builds all container images, and installs dependencies.

### Step 3 — Choose Your Deployment Scenario

Pick one of the three scenarios below. Each scenario tells you how to configure
the `.env` file, set up SSL certificates, and prepare your network.

> **Tip:** A template is provided at `.env.example`. Copy it to `.env` and
> uncomment the relevant lines.

---

#### Scenario A — Local Single-Device Development (default)

Use this when developing on a single machine. Services are accessed via the
`hubs.local` hostname.

**Hosts file** — add these entries:

```
127.0.0.1   hubs.local
127.0.0.1   hubs-proxy.local
```

- **macOS / Linux:** `/etc/hosts`
- **Windows:** `C:\Windows\System32\drivers\etc\hosts`

**`.env`** — no file needed (defaults to `hubs.local`).

**Install mkcert root CA** (first time only):

```bash
mkcert -install
```

**Generate SSL certificates:**

```bash
mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
  localhost 127.0.0.1 ::1 \
  hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
  reticulum dialog postgrest
```

---

#### Scenario B — LAN Development (access from other devices on the same network)

Use this when you want other devices on the same WiFi / LAN to connect to
your Hubs instance. Instead of `hubs.local`, you use your machine's LAN IP
address (e.g., `192.168.1.100`).

**Find your LAN IP:**

```bash
# macOS
ifconfig | grep "inet " | grep -v 127.0.0.1

# Linux
ip -4 addr show | grep "inet " | grep -v 127.0.0.1
```

**`.env`** — create the file at the repository root:

```env
HUBS_HOST=192.168.1.100
```

Replace `192.168.1.100` with your actual LAN IP.

**Hosts file** — not needed (using an IP address directly).

**Install mkcert root CA** (first time only):

```bash
mkcert -install
```

**Generate SSL certificates** (include the LAN IP as a SAN):

```bash
mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
  localhost 127.0.0.1 ::1 \
  192.168.1.100 \
  hubs-client hubs-admin spoke reticulum dialog postgrest
```

**Firewall** — ensure the following ports are open for incoming connections on
the host machine:

| Port        | Protocol | Service                      |
| ----------- | -------- | ---------------------------- |
| 4000        | TCP      | Reticulum (main entry point) |
| 4443        | TCP      | Dialog (WebRTC signaling)    |
| 8080        | TCP      | Hubs Client                  |
| 40000–40050 | UDP      | mediasoup (WebRTC media)     |

On macOS, you may need to allow incoming connections in **System Settings >
Network > Firewall**.

**Other devices** — when accessing from another device on the LAN, the browser
will show a certificate warning because the mkcert root CA is not installed on
that device. You can either:

- Accept the warning for each service URL, or
- Install the mkcert root CA on the other device. Find the CA certificate with
  `mkcert -CAROOT` on the host machine, then copy and install
  `rootCA.pem` on the other device.

**Access URLs:**

| Service     | URL                        |
| ----------- | -------------------------- |
| Reticulum   | https://192.168.1.100:4000 |
| Hubs Client | https://192.168.1.100:8080 |
| Hubs Admin  | https://192.168.1.100:8989 |
| Spoke       | https://192.168.1.100:9090 |

---

#### Scenario C — Remote Server (access from any network via a domain)

Use this when hosting on a server with a public domain name so that devices
from any network can access the Hubs instance.

**Prerequisites:**

- A domain name (e.g., `hubs.example.com`) with a DNS A record pointing to
  your server's public IP address.
- [certbot](https://certbot.eff.org/) installed on the server (for Let's
  Encrypt certificates).
- Ports open in your server's firewall (see table below).

**`.env`** — create the file at the repository root:

```env
HUBS_HOST=hubs.example.com
PRIVATE_NETWORK_IP=xxx.xxx.xxx.xxx
```

Replace the values with your actual domain and public IP. `PRIVATE_NETWORK_IP`
must be set to your server's **public** IP because the auto-detection in
`bin/up` finds the private/internal IP on cloud servers, which would break
WebRTC media delivery.

**Hosts file** — not needed (DNS handles resolution).

**Generate SSL certificates** with Let's Encrypt:

```bash
# Stop any service on port 80 first, then:
sudo certbot certonly --standalone -d hubs.example.com

# Copy certs to the shared location
sudo cp /etc/letsencrypt/live/hubs.example.com/privkey.pem shared-key.pem
sudo cp /etc/letsencrypt/live/hubs.example.com/fullchain.pem shared-cert.pem
sudo chown $(whoami) shared-key.pem shared-cert.pem
```

**Firewall** — ensure the following ports are open:

| Port        | Protocol | Service                               |
| ----------- | -------- | ------------------------------------- |
| 80          | TCP      | certbot HTTP-01 challenge (temporary) |
| 4000        | TCP      | Reticulum (main entry point)          |
| 4443        | TCP      | Dialog (WebRTC signaling)             |
| 8080        | TCP      | Hubs Client                           |
| 40000–40050 | UDP      | mediasoup (WebRTC media)              |

**Access URLs:**

| Service     | URL                           |
| ----------- | ----------------------------- |
| Reticulum   | https://hubs.example.com:4000 |
| Hubs Client | https://hubs.example.com:8080 |
| Hubs Admin  | https://hubs.example.com:8989 |
| Spoke       | https://hubs.example.com:9090 |

---

### Step 4 — Copy Certificates to Services

After generating certificates (in any scenario), copy them to each service:

```bash
# Reticulum
cp shared-key.pem services/reticulum/priv/dev-ssl.key
cp shared-cert.pem services/reticulum/priv/dev-ssl.cert

# Hubs Client
mkdir -p services/hubs/certs
cp shared-key.pem services/hubs/certs/key.pem
cp shared-cert.pem services/hubs/certs/cert.pem

# Hubs Admin
mkdir -p services/hubs/admin/certs
cp shared-key.pem services/hubs/admin/certs/key.pem
cp shared-cert.pem services/hubs/admin/certs/cert.pem

# Spoke
mkdir -p services/spoke/certs
cp shared-key.pem services/spoke/certs/key.pem
cp shared-cert.pem services/spoke/certs/cert.pem

# Dialog
mkdir -p services/dialog/certs
cp shared-key.pem services/dialog/certs/privkey.pem
cp shared-cert.pem services/dialog/certs/fullchain.pem
```

### Step 5 — Start the Services

```bash
bin/up
```

### Step 6 — Sign In

1. Open the Reticulum URL in your browser (e.g., `https://hubs.local:4000` for
   Scenario A) and click the sign-in button.
   - If it doesn't open successfully, try again after waiting a minute, or clear your browser cache.
2. Enter an email address (it does not have to be real). Remember this address —
   it will be used for your admin account.
3. Find the sign-in link in the Reticulum logs:
   ```bash
   docker compose logs reticulum | grep auth_token
   ```
   The link looks like `https://hubs.local:4000/?auth_origin=hubs&auth_payload=...&auth_token=...`.
   Add `-f` for a live-updating log.
4. Copy the link from the log output and open it in a new tab in the **same
   browser**.

### Step 7 — Promote Account to Admin

Shell into the Reticulum container and start an IEx console:

```bash
docker compose exec reticulum iex -S mix
```

Then run the following command to promote the first account to admin:

```elixir
Ret.Account |> Ret.Repo.all() |> Enum.at(0) |> Ecto.Changeset.change(is_admin: true) |> Ret.Repo.update!()
```

> **Note:** You must have signed in at least once (Step 6) before you can
> promote the account. After promotion, sign out and sign in again. Since
> SMTP is not configured yet (that happens in Step 8), you will need to
> fetch the sign-in link from the Reticulum logs again, just as in Step 6.

### Step 8 — Configure Admin Settings

Open the admin panel at `https://<your-host>:4000/admin` and fill in SMTP
credentials and any other settings required for your environment.

- **SMTP** (configure the email account used to send sign-in authentication emails): Side menu → "Server Settings" → "Email" tab
- **WebRTC SFU** (Dialog, Sora, LiveKit, etc.): Side menu → "Server Settings" → "WEBRTC" tab

---

## 3. Stopping and Restarting

| Action  | Command                                     |
| ------- | ------------------------------------------- |
| Start   | `bin/up`                                    |
| Stop    | `bin/down`                                  |
| Restart | `bin/down && mutagen daemon stop && bin/up` |

> **Known issue:** After restarting with `bin/down` and `bin/up`, Hubs may fail
> to connect to Dialog (port 4443). If this happens, fully **quit** Docker
> Desktop and start it again (a simple "Restart" from the Docker Desktop menu
> is not sufficient.) Then run `bin/up` as usual.

---

## 4. Switching Scenarios

To switch between scenarios (e.g., from Local to LAN):

1. Run `bin/down` to stop the current services.
2. Edit (or create/remove) the `.env` file for the new scenario.
3. Regenerate SSL certificates for the new hostnames/IPs (Step 3 of the new
   scenario).
4. Re-copy certificates to services (Step 4).
5. Run `bin/up`.

> **Note:** Existing browser sessions/cookies will not carry over when switching
> scenarios. Clear your browser's local storage for the old host before signing
> in on the new one.
