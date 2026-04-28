#!/bin/bash
# start-mac.command — Double-click in Finder to start chutvrc Compose.
# Use AFTER local-setup-mac.command has been run once. For daily start/stop only.

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
    echo -e "${RED}Docker is not installed. Run local-setup-mac.command first.${RESET}"
    read -rp "Press Enter to close..."
    exit 1
fi

if ! docker info &>/dev/null; then
    echo -e "${YELLOW}Docker daemon is not running. Please start Docker Desktop.${RESET}"
    echo "Waiting for Docker..."
    while ! docker info &>/dev/null; do
        sleep 3
        printf "."
    done
    echo ""
fi

if [ ! -f .bin-init-completed ]; then
    echo -e "${RED}Setup not completed yet. Run local-setup-mac.command first.${RESET}"
    read -rp "Press Enter to close..."
    exit 1
fi

echo -e "${BOLD}Starting services with bin/up...${RESET}"
bin/up

echo ""
echo -e "${GREEN}Services are starting in the background.${RESET}"
echo "  Open: https://hubs.local:4000"
echo "  Stop: bin/down  (or double-click stop-mac.command if available)"
echo ""
read -rp "Press Enter to close this window..."
