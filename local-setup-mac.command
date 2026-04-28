#!/bin/bash
# local-setup-mac.command — Double-click in Finder to set up chutvrc Compose.
# Default flow is single-device development on hubs.local. For LAN access or
# public-domain hosting, populate `.env` (see .env.example / MANUAL_SETUP.md)
# *before* double-clicking — this script will detect HUBS_HOST and dispatch.

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

echo ""
echo "============================================================"
echo "  chutvrc Compose — macOS Setup"
echo "============================================================"
echo ""

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

# common.sh + load_env already ran in Phase 0; just dispatch on the scenario.
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
