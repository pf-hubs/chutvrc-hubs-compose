#!/bin/bash
# setup-mac.command — Double-click this file in Finder to set up chutvrc Compose
# Automates prerequisites installation and initial setup for macOS (Scenario A: Local)

set -euo pipefail
cd "$(dirname "$0")"

BOLD='\033[1;37m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m'

info()    { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
warn()    { echo -e "${YELLOW}$*${RESET}"; }
fail()    { echo -e "${RED}$*${RESET}"; exit 1; }

echo ""
echo "============================================================"
echo "  chutvrc Compose — macOS Setup"
echo "============================================================"
echo ""

# ── Phase 1: Prerequisites ──────────────────────────────────────────────────

info "Phase 1: Checking prerequisites..."
echo ""

# 1.1 Docker Desktop
if ! command -v docker &>/dev/null; then
    fail "Docker is not installed.
Please install Docker Desktop for Mac:
  https://docs.docker.com/desktop/setup/install/mac-install/
Then re-run this script."
fi
success "  Docker installed."

# 1.2 Homebrew
if ! command -v brew &>/dev/null; then
    info "  Homebrew not found. Installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add Homebrew to PATH for this session
    if [ -f /opt/homebrew/bin/brew ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [ -f /usr/local/bin/brew ]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi
success "  Homebrew installed."

# 1.3 mutagen, mutagen-compose, mkcert
BREW_PACKAGES=()
if ! command -v mutagen &>/dev/null; then
    BREW_PACKAGES+=("mutagen-io/mutagen/mutagen")
fi
if ! command -v mutagen-compose &>/dev/null; then
    BREW_PACKAGES+=("mutagen-io/mutagen/mutagen-compose")
fi
if ! command -v mkcert &>/dev/null; then
    BREW_PACKAGES+=("mkcert")
fi

if [ ${#BREW_PACKAGES[@]} -gt 0 ]; then
    info "  Installing: ${BREW_PACKAGES[*]}..."
    brew install "${BREW_PACKAGES[@]}"
fi
success "  mutagen, mutagen-compose, mkcert installed."

echo ""
success "All prerequisites satisfied."
echo ""

# ── Phase 2: Setup ──────────────────────────────────────────────────────────

info "Phase 2: Running setup..."
echo ""

source ./local-setup-common.sh

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

info "Phase 3: Configuring hosts file..."

if grep -q "hubs\.local" /etc/hosts 2>/dev/null; then
    success "  /etc/hosts already contains hubs.local entries."
else
    warn "  Adding hubs.local entries to /etc/hosts (requires sudo)..."
    echo "127.0.0.1   hubs.local" | sudo tee -a /etc/hosts >/dev/null
    echo "127.0.0.1   hubs-proxy.local" | sudo tee -a /etc/hosts >/dev/null
    success "  Hosts file updated."
fi
echo ""

# ── Phase 4: Start services ────────────────────────────────────────────────

info "Phase 4: Starting services..."
echo ""

start_services

guided_post_setup

echo "Press Enter to close this window..."
read -r
