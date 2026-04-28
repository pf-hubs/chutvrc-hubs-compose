#!/bin/bash
# start-linux.sh — Start chutvrc Compose on Linux.
# Run from a terminal: ./start-linux.sh
# Or double-click in your file manager (most need "Run" enabled for .sh files).
# Use AFTER you have completed the manual setup in MANUAL_SETUP.md once.

set -euo pipefail
cd "$(dirname "$0")"

BOLD='\033[1;37m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m'

echo ""
echo "============================================================"
echo "  chutvrc Compose — Start"
echo "============================================================"
echo ""

if ! command -v docker &>/dev/null; then
    echo -e "${RED}Docker is not installed. See MANUAL_SETUP.md for prerequisites.${RESET}"
    read -rp "Press Enter to close..."
    exit 1
fi

if ! docker info &>/dev/null; then
    echo -e "${YELLOW}Docker daemon is not running.${RESET}"
    echo "  - Docker Desktop: launch it from your applications menu."
    echo "  - Docker Engine:  sudo systemctl start docker"
    echo "Waiting for Docker..."
    while ! docker info &>/dev/null; do
        sleep 3
        printf "."
    done
    echo ""
fi

if [ ! -d services/reticulum/.git ]; then
    echo -e "${RED}Services are not initialized.${RESET}"
    echo "Follow MANUAL_SETUP.md (run bin/init and configure your scenario) first."
    read -rp "Press Enter to close..."
    exit 1
fi

if ! command -v mutagen-compose &>/dev/null; then
    echo -e "${RED}mutagen-compose is not installed. See MANUAL_SETUP.md.${RESET}"
    read -rp "Press Enter to close..."
    exit 1
fi

echo -e "${BOLD}Starting services with bin/up...${RESET}"
bin/up

echo ""
echo -e "${GREEN}Services are starting in the background.${RESET}"
echo "  Open: https://hubs.local:4000  (or your configured HUBS_HOST)"
echo "  Stop: bin/down"
echo ""
read -rp "Press Enter to close this window..."
