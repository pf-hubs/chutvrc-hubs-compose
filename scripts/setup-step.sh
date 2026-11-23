#!/bin/bash
# Runs steps of the setup for the Windows installer (scripts/setup-windows-gui.ps1): one function of
# scripts/setup-common.sh per argument. All output goes to the file in CHUTVRC_SETUP_OUTPUT.
cd "$(dirname "$0")/.." || exit 1
if [ -n "$CHUTVRC_SETUP_OUTPUT" ]; then
    exec >>"$(cygpath -u "$CHUTVRC_SETUP_OUTPUT")" 2>&1
fi
exec </dev/null

basedir="$(pwd)"
source ./scripts/setup-common.sh

install_mkcert() {
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-mkcert.ps1
}

load_env
detect_scenario >/dev/null || exit 1
for step in "$@"; do
    "$step" || exit $?
done
