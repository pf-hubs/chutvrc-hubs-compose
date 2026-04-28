#!/bin/bash
# local-setup-linux.sh — One-shot setup of chutvrc Compose on Linux.
# Run from a terminal:  ./local-setup-linux.sh
# Default flow is single-device development on hubs.local. For LAN access or
# public-domain hosting, populate `.env` (see .env.example / MANUAL_SETUP.md)
# *before* running — this script will detect HUBS_HOST and dispatch.
#
# Supported floor: Ubuntu 22.04 LTS (and Debian/Fedora/Arch equivalents).
# On apt-based distros, missing prerequisites are auto-installed where
# packaged. On non-apt distros, the script prints install instructions and
# exits; you can re-run after installing manually.

set -euo pipefail
cd "$(dirname "$0")"
basedir="$(pwd)"

BOLD='\033[1;37m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m'

info()    { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
warn()    { echo -e "${YELLOW}$*${RESET}"; }
fail()    { echo -e "${RED}$*${RESET}"; exit 1; }

# Pinned mutagen versions (Mutagen and Mutagen Compose MUST match — see
# MANUAL_SETUP.md). 0.18.1 is the version known to work with this repo's
# docker-compose layout. Bump together when verified.
MUTAGEN_VERSION="0.18.1"

echo ""
echo "============================================================"
echo "  chutvrc Compose — Linux Setup"
echo "============================================================"
echo ""

# Make sure ~/.local/bin (where we drop user-local binaries below) is on
# PATH for the rest of this session. Most Linux distros put it there at login
# *if* the directory exists; we may create it for the first time below.
mkdir -p "$HOME/.local/bin"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac

# Source the shared library now so we can use ask_scenario_if_unset before
# Phase 1 starts installing things. common.sh's fail() does not exit (its
# own functions wrap fail+return 1); restore the exit-on-fail variant so
# the inline prereq checks below still terminate the script on missing
# Docker / etc.
source ./local-setup-common.sh
fail() { echo -e "${RED}$*${RESET}"; exit 1; }

# ── Pre-flight: Scenario selection ──────────────────────────────────────────
# Skipped silently if HUBS_HOST is already set in .env. Otherwise prompts;
# selecting LAN or public-domain prints what to add to .env and exits so
# the user can configure it before the heavy install steps.
load_env
ask_scenario_if_unset

# ── Phase 0: Environment guards ─────────────────────────────────────────────

info "Phase 0: Environment checks..."

# WSL2: hosts edits inside WSL are invisible to Windows browsers, so users
# should run local-setup-windows.bat from Windows instead.
if grep -qi 'microsoft\|wsl' /proc/version 2>/dev/null; then
    fail "ERROR: WSL2 detected. Run local-setup-windows.bat from Windows instead.

Reason: /etc/hosts edits inside WSL are not visible to browsers running on
the Windows host. The Windows wrapper handles hosts editing via PowerShell
elevation so Windows browsers see hubs.local correctly."
fi

# Detect package manager — apt is auto-install territory; others get hints.
PKG=""
if   command -v apt-get  &>/dev/null; then PKG=apt
elif command -v dnf      &>/dev/null; then PKG=dnf
elif command -v pacman   &>/dev/null; then PKG=pacman
fi

if [ -z "$PKG" ]; then
    fail "ERROR: Unsupported package manager.

This script auto-installs prerequisites only on apt / dnf / pacman based
distros. For others (zypper, apk, NixOS, Gentoo, etc.), follow MANUAL_SETUP.md
for the manual installation steps, then re-run this script — it will detect
the binaries already on PATH and skip the install steps."
fi
success "  Package manager: $PKG"

# curl / tar — needed for downloading mutagen tarballs.
need_install=()
command -v curl &>/dev/null || need_install+=("curl")
command -v tar  &>/dev/null || need_install+=("tar")
if [ ${#need_install[@]} -gt 0 ]; then
    info "  Installing: ${need_install[*]}..."
    case "$PKG" in
      apt)    sudo apt-get update -y && sudo apt-get install -y "${need_install[@]}" ;;
      dnf)    sudo dnf install -y "${need_install[@]}" ;;
      pacman) sudo pacman -Sy --noconfirm "${need_install[@]}" ;;
    esac
fi

# sudo: needed for /etc/hosts edit, for apt-installs, and for certbot in C.
if ! command -v sudo &>/dev/null; then
    fail "ERROR: 'sudo' is not installed.

This script needs sudo to edit /etc/hosts (single-device mode) and to
install packages. Either install sudo (su - then 'apt-get install sudo' /
equivalent + add your user to the 'sudo' group), or follow MANUAL_SETUP.md
to do those steps manually as root."
fi
echo ""

# ── Phase 1: Prerequisites ──────────────────────────────────────────────────

info "Phase 1: Checking prerequisites..."

# 1.1 Docker engine + Compose v2 plugin + group membership.
if ! command -v docker &>/dev/null; then
    fail "ERROR: Docker is not installed.

Install Docker Engine for your distribution by following the official guide:
  https://docs.docker.com/engine/install/

Or install Docker Desktop for Linux:
  https://docs.docker.com/desktop/setup/install/linux/

After installing, re-run this script."
fi

# Daemon up? On Docker Engine try systemd; on Docker Desktop the unit may not
# exist (the user starts the GUI), so the systemd-start is best-effort.
if ! docker info &>/dev/null; then
    warn "  Docker daemon is not running. Attempting 'sudo systemctl start docker'..."
    sudo systemctl start docker 2>/dev/null || true
    if ! docker info &>/dev/null; then
        warn "  Could not start Docker automatically."
        echo "  - Docker Desktop: launch it from your applications menu."
        echo "  - Docker Engine:  sudo systemctl start docker"
        echo "  Waiting for Docker to start..."
        while ! docker info &>/dev/null; do
            sleep 3
            printf "."
        done
        echo ""
    fi
fi
success "  Docker daemon is running."

# Compose v2 plugin (`docker compose`, not the legacy `docker-compose`). bin/init
# and rebuild_dialog use the v2 syntax — non-negotiable.
if ! docker compose version &>/dev/null; then
    fail "ERROR: 'docker compose' (v2) is not installed.

The legacy 'docker-compose' (v1) script is not enough — bin/init uses the v2
plugin syntax. Install the plugin:

  Ubuntu/Debian (Docker repo):  sudo apt-get install docker-compose-plugin
  Ubuntu 24.04 universe:        sudo apt-get install docker-compose-v2
  Fedora/RHEL:                  sudo dnf install docker-compose-plugin
  Arch:                         sudo pacman -S docker-compose

After installing, re-run this script."
fi
success "  docker compose v2 available."

# Docker group: without membership the docker socket is unreadable and
# bin/init fails with cryptic permission-denied. Re-login is required after
# adding to the group; this script cannot fix that in the same session, so
# we add and exit cleanly.
if ! id -nG "$USER" | grep -qw docker; then
    if [ -e /var/run/docker.sock ] && [ -O /var/run/docker.sock ]; then
        : # rootless docker — socket is owned by the user, group not required
    else
        warn "  $USER is not in the 'docker' group. Adding..."
        sudo usermod -aG docker "$USER"
        echo ""
        warn "  ====================================================================="
        warn "  You have been added to the 'docker' group, but group membership only"
        warn "  takes effect on a new login session. Please log out and back in (or"
        warn "  run 'newgrp docker' for a single shell), then re-run this script."
        warn "  ====================================================================="
        exit 0
    fi
fi
success "  $USER has docker access."

# 1.2 mkcert — apt/dnf/pacman packaged where available, else GitHub binary.
install_mkcert_from_github() {
    info "  Downloading mkcert from GitHub..."
    local arch
    case "$(uname -m)" in
      x86_64)   arch=amd64 ;;
      aarch64)  arch=arm64 ;;
      armv7l)   arch=arm   ;;
      *) fail "ERROR: Unsupported CPU architecture: $(uname -m). Install mkcert manually." ;;
    esac
    local url
    url=$(curl -sL https://api.github.com/repos/FiloSottile/mkcert/releases/latest \
          | grep -oE '"browser_download_url": *"[^"]*linux-'"$arch"'"' \
          | head -1 \
          | sed -E 's/.*"([^"]*)"$/\1/')
    [ -z "$url" ] && fail "ERROR: Could not find a Linux $arch mkcert release on GitHub."
    curl -sL "$url" -o "$HOME/.local/bin/mkcert"
    chmod +x "$HOME/.local/bin/mkcert"
}

if ! command -v mkcert &>/dev/null; then
    case "$PKG" in
      apt)
        if apt-cache show mkcert 2>/dev/null | grep -q '^Package: mkcert$'; then
            sudo apt-get install -y mkcert
        else
            install_mkcert_from_github
        fi
        ;;
      dnf)
        if dnf list mkcert 2>/dev/null | grep -q '^mkcert\.'; then
            sudo dnf install -y mkcert
        else
            install_mkcert_from_github
        fi
        ;;
      pacman)
        if pacman -Si mkcert &>/dev/null; then
            sudo pacman -S --noconfirm mkcert
        else
            install_mkcert_from_github
        fi
        ;;
    esac
fi
success "  mkcert installed."

# NSS DB tools — without these, `mkcert -install` silently fails to add the
# root CA to Firefox/Chromium's NSS DB, and the user gets cert warnings even
# on the local machine despite a "successful" install.
case "$PKG" in
  apt)
    dpkg -s libnss3-tools &>/dev/null || sudo apt-get install -y libnss3-tools
    ;;
  dnf)
    rpm -q nss-tools &>/dev/null || sudo dnf install -y nss-tools
    ;;
  pacman)
    pacman -Q nss &>/dev/null || sudo pacman -S --noconfirm nss
    ;;
esac
success "  NSS tools installed (browser trust DB)."

# 1.3 mutagen + mutagen-compose — pinned versions, downloaded as Linux release
# tarballs into ~/.local/bin (already on PATH for this session).
install_mutagen() {
    local name="$1" version="$2"
    local arch
    case "$(uname -m)" in
      x86_64)   arch=amd64 ;;
      aarch64)  arch=arm64 ;;
      *) fail "ERROR: Unsupported CPU architecture for $name: $(uname -m)." ;;
    esac
    local tarball="${name}_linux_${arch}_v${version}.tar.gz"
    local url="https://github.com/mutagen-io/${name}/releases/download/v${version}/${tarball}"
    info "  Downloading $name v$version ($arch)..."
    local tmpdir
    tmpdir=$(mktemp -d)
    if ! curl -fsSL "$url" -o "$tmpdir/$tarball"; then
        rm -rf "$tmpdir"
        fail "ERROR: Failed to download $url"
    fi
    tar -xzf "$tmpdir/$tarball" -C "$tmpdir"
    # mutagen tarball contains 'mutagen'; mutagen-compose contains 'mutagen-compose'
    if [ -f "$tmpdir/$name" ]; then
        mv "$tmpdir/$name" "$HOME/.local/bin/$name"
        chmod +x "$HOME/.local/bin/$name"
    else
        rm -rf "$tmpdir"
        fail "ERROR: Tarball for $name did not contain a '$name' binary."
    fi
    rm -rf "$tmpdir"
}

if ! command -v mutagen &>/dev/null; then
    install_mutagen mutagen "$MUTAGEN_VERSION"
fi
if ! command -v mutagen-compose &>/dev/null; then
    install_mutagen mutagen-compose "$MUTAGEN_VERSION"
fi

# Sanity-check that both versions match (mismatched versions break in subtle
# ways; the manual mandates matching versions).
m_v=$(mutagen version 2>/dev/null | head -1 | awk '{print $NF}')
mc_v=$(mutagen-compose version 2>/dev/null | head -1 | awk '{print $NF}')
if [ -n "$m_v" ] && [ -n "$mc_v" ] && [ "$m_v" != "$mc_v" ]; then
    warn "  Mutagen versions disagree (mutagen=$m_v, mutagen-compose=$mc_v)."
    warn "  See MANUAL_SETUP.md — they must match. You may hit obscure runtime errors."
fi
success "  mutagen + mutagen-compose installed."

# 1.4 Snap-Firefox / Snap-Chromium warning — these use a separate NSS DB that
# `mkcert -install` cannot populate, so the user will see cert warnings even
# after a clean single-device install unless they import the root CA manually.
if command -v snap &>/dev/null; then
    if snap list firefox &>/dev/null || snap list chromium &>/dev/null; then
        echo ""
        warn "  Snap browser detected (Firefox or Chromium)."
        warn "  Snap browsers use a separate certificate store that mkcert cannot"
        warn "  populate automatically. After setup, if you see cert warnings at"
        warn "  https://hubs.local:4000, import this file manually via the"
        warn "  browser's certificate settings:"
        echo "    $(mkcert -CAROOT)/rootCA.pem"
        warn "  (Settings → Privacy & Security → View Certificates → Authorities → Import)"
        echo ""
    fi
fi

# 1.5 Avahi mDNS — the .local TLD is reserved for mDNS (RFC 6762). On stock
# Ubuntu Desktop with avahi-daemon running and libnss-mdns installed, NSS may
# resolve hubs.local via mDNS *before* /etc/hosts, breaking single-device mode.
# Only relevant when the user has no HUBS_HOST in .env (default flow).
if [ ! -f .env ] || ! grep -qE '^[[:space:]]*HUBS_HOST=..*' .env 2>/dev/null; then
    if systemctl is-active --quiet avahi-daemon 2>/dev/null \
       && [ -f /etc/nsswitch.conf ] \
       && grep -E '^hosts:' /etc/nsswitch.conf | grep -q 'mdns4_minimal.*files'; then
        warn "  Avahi (mDNS) is active and 'mdns4_minimal' precedes 'files' in /etc/nsswitch.conf."
        warn "  This will hijack 'hubs.local' DNS and break single-device development. To fix, run ONE of:"
        echo "    sudo sed -i 's/mdns4_minimal \\[NOTFOUND=return\\] //' /etc/nsswitch.conf"
        echo "    sudo apt-get remove libnss-mdns"
        warn "  Then re-run this script."
        fail "ERROR: Avahi mDNS conflict on hubs.local. Fix /etc/nsswitch.conf and try again."
    fi
fi

echo ""
success "All prerequisites satisfied."
echo ""

# ── Phase 2: Setup ──────────────────────────────────────────────────────────

info "Phase 2: Running setup..."
echo ""

# common.sh + load_env already ran in the pre-flight step; just dispatch.
detect_scenario
echo ""

ensure_docker_running
echo ""

run_init
echo ""

generate_certs
echo ""

copy_certs_to_services
echo ""

rebuild_dialog
echo ""

# ── Phase 3: Hosts file ────────────────────────────────────────────────────
# configure_hosts edits /etc/hosts for single-device (hubs.local) only;
# it's a no-op for LAN / public-domain hosts (where it isn't needed).

info "Phase 3: Configuring hosts file..."
configure_hosts
echo ""

# ── Phase 4: Start services ────────────────────────────────────────────────

info "Phase 4: Starting services..."
echo ""

start_services

guided_post_setup

echo "Press Enter to close this window..."
read -r
