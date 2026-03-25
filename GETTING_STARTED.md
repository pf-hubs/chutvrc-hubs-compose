# chutvrc Compose — Getting Started

chutvrc Compose is a Docker Compose setup for orchestrating all services used by
chutvrc for local development. It runs on macOS, Linux, and Windows.

> **Important:** This is not a production-ready setup. It does not account for
> security or scalability. The permissions files were generated for development
> purposes only.

---

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
5. Install `mkcert` via [Chocolatey](https://chocolatey.org/)
   (`choco install mkcert`) or [Scoop](https://scoop.sh/)
   (`scoop install mkcert`).

### Hosts File

Add the following entries to your hosts file:

```
127.0.0.1   hubs.local
127.0.0.1   hubs-proxy.local
```

- **macOS / Linux:** `/etc/hosts`
- **Windows:** `C:\Windows\System32\drivers\etc\hosts`

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

### Step 3 — Install mkcert Root CA

If you have not previously installed the mkcert root certificate authority on
this machine, run:

```bash
mkcert -install
```

This adds the mkcert root CA to your system trust store so that generated
certificates are trusted by your browser.

### Step 4 — Generate SSL Certificates

From the repository root:

```bash
mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
  localhost 127.0.0.1 ::1 \
  hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
  reticulum dialog postgrest
```

### Step 5 — Copy Certificates to Services

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

### Step 6 — Start the Services

```bash
bin/up
```

### Step 7 — Sign In

1. Open https://hubs.local:4000 in your browser and click the sign-in button.
2. Enter an email address (it does not have to be real). Remember this address —
   it will be used for your admin account.
3. Find the magic verification link in the Reticulum logs:
   ```bash
   docker compose logs reticulum
   ```
   Add `-f` for a live-updating log.
4. Copy the link from the log output and open it in a new tab in the **same
   browser**.

### Step 8 — Promote Account to Admin

Shell into the Reticulum container and start an IEx console:

```bash
services/reticulum/bin/iex -S mix
```

Then follow the instructions at
https://github.com/Hubs-Foundation/reticulum#6-creating-an-admin-user to
promote your account.

> **Note:** You must have signed in at least once (Step 7) before you can
> promote the account. After promotion, clear your browser's local storage for
> `hubs.local` and sign in again.

### Step 9 — Configure Admin Settings

Open the admin panel at https://hubs.local:4000/admin and fill in SMTP
credentials and any other settings required for your environment.

---

## 3. Stopping and Restarting

| Action  | Command                                  |
| ------- | ---------------------------------------- |
| Stop    | `bin/down`                               |
| Restart | `bin/down && mutagen daemon stop && bin/up` |

> **Known issue:** After restarting with `bin/down` and `bin/up`, Hubs may fail
> to connect to Dialog (port 4443). If this happens, fully **quit** Docker
> Desktop and start it again — a simple "Restart" from the Docker Desktop menu
> is not sufficient. Then run `bin/up` as usual.

---

## 4. Service Endpoints

Once running, the following services are accessible:

| Service     | URL                        |
| ----------- | -------------------------- |
| Reticulum   | https://hubs.local:4000    |
| Hubs Client | https://hubs.local:8080    |
| Hubs Admin  | https://hubs.local:8989    |
| Spoke       | https://hubs.local:9090    |
| Dialog      | https://hubs.local:4443    |
