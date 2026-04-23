#!/bin/bash
# setup-common.sh — Shared setup logic for macOS and Windows
# Sourced by setup-mac.command and setup-windows.bat (via Git Bash)

BOLD='\033[1;37m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m'

info()    { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
warn()    { echo -e "${YELLOW}$*${RESET}"; }
fail()    { echo -e "${RED}$*${RESET}"; }

# ── Ensure Docker daemon is running ──────────────────────────────────────────
ensure_docker_running() {
    if ! command -v docker &>/dev/null; then
        fail "ERROR: Docker is not installed."
        warn "Please install Docker Desktop first:"
        warn "  macOS:   https://docs.docker.com/desktop/setup/install/mac-install/"
        warn "  Windows: https://docs.docker.com/desktop/setup/install/windows-install/"
        return 1
    fi

    if docker info &>/dev/null; then
        success "Docker is running."
        return 0
    fi

    warn "Docker daemon is not running. Please start Docker Desktop."
    echo "Waiting for Docker to start..."
    while ! docker info &>/dev/null; do
        sleep 3
        printf "."
    done
    echo ""
    success "Docker is running."
}

# ── Run bin/init (clone repos, build images, install deps) ───────────────────
run_init() {
    if [ -d "services/reticulum/.git" ]; then
        success "Services already cloned. Skipping bin/init."
        echo "(Run bin/reset to re-initialize from scratch.)"
        return 0
    fi

    info "Running bin/init (this will take a while)..."
    if ! bin/init; then
        fail "ERROR: bin/init failed."
        echo "Check the output above for details. You can re-run this script to retry."
        return 1
    fi
    success "bin/init completed successfully."
}

# ── Generate SSL certificates with mkcert ────────────────────────────────────
generate_certs() {
    if ! command -v mkcert &>/dev/null; then
        fail "ERROR: mkcert is not installed."
        return 1
    fi

    info "Installing mkcert root CA (you may be prompted for your password)..."
    mkcert -install

    if [ -f shared-cert.pem ]; then
        warn "Existing certificates found. Regenerating..."
    fi

    info "Generating SSL certificates for local development..."
    mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
        localhost 127.0.0.1 ::1 \
        hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
        reticulum dialog postgrest

    success "SSL certificates generated."
}

# ── Copy certificates to all service directories ─────────────────────────────
copy_certs_to_services() {
    info "Copying certificates to service directories..."

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

    success "Certificates copied to all services."
}

# ── Rebuild Dialog image (certs are baked in at build time) ──────────────────
rebuild_dialog() {
    info "Rebuilding Dialog image with new certificates..."
    if ! docker compose -f docker-compose.yml build dialog; then
        fail "ERROR: Failed to rebuild Dialog image."
        return 1
    fi
    success "Dialog image rebuilt."
}

# ── Start services ───────────────────────────────────────────────────────────
start_services() {
    info "Starting services with bin/up..."
    if ! bin/up; then
        fail "ERROR: bin/up failed."
        return 1
    fi
    success "Services are starting up."
}

# ── Wait for services to become healthy ──────────────────────────────────────
wait_for_services_healthy() {
    info "Waiting for services to become healthy (this may take 1-2 minutes)..."
    local max_attempts=40  # 40 x 5s = ~3.3 minutes
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        if docker compose ps --format json 2>/dev/null | grep -q '"reticulum"' && \
           curl -sk https://localhost:4000 &>/dev/null; then
            echo ""
            success "Services are healthy and responding."
            return 0
        fi
        printf "."
        sleep 5
        attempt=$((attempt + 1))
    done
    echo ""
    warn "Services may not be fully ready yet. Continuing anyway..."
    echo "You can check status with: docker compose ps"
}

# ── Interactive guided setup ─────────────────────────────────────────────────
prompt_and_wait() {
    echo ""
    echo -e "${YELLOW}>>> $1${RESET}"
    echo ""
    read -rp "Press Enter when done..."
    echo ""
}

guided_post_setup() {
    echo ""
    echo "============================================================"
    echo "  AUTOMATED SETUP COMPLETE — Guided Steps"
    echo "============================================================"
    echo ""

    # Step 1: Wait for healthy
    wait_for_services_healthy
    echo ""

    # Step 2: Sign in (guided — fetch magic link automatically)
    echo "------------------------------------------------------------"
    info "  STEP 1: Sign In"
    echo "------------------------------------------------------------"
    echo "  1. Open https://hubs.local:4000 in your browser"
    echo "     (If it doesn't load, wait a minute and try again)"
    echo "  2. Click the sign-in button"
    echo "  3. Enter an email address that you will use as the admin account for your chutvrc instance"
    prompt_and_wait "Enter your email in the browser, then press Enter"

    info "Fetching sign-in link from Reticulum logs..."
    local magic_link=""
    magic_link=$(docker compose logs reticulum 2>/dev/null | grep -oE 'https?://[^ ]*auth_token=[^ ]*' | tail -1 | sed 's/[",]$//')

    if [ -n "$magic_link" ]; then
        echo ""
        success "Sign-in link found:"
        echo ""
        echo "  $magic_link"
        echo ""
        echo "  Open this link in the SAME browser where you entered your email."
    else
        warn "Could not find sign-in link automatically."
        echo "  Try running this in another terminal:"
        echo "    docker compose logs reticulum | grep auth_token"
        echo "  Then open the link in the SAME browser."
    fi
    prompt_and_wait "Open the sign-in link and complete sign-in, then press Enter"

    # Step 3: Promote to admin (automated!)
    echo "------------------------------------------------------------"
    info "  STEP 2: Promoting your account to admin..."
    echo "------------------------------------------------------------"
    echo ""
    info "Running admin promotion command..."
    if docker compose exec -T reticulum sh -c \
        'echo "Ret.Account |> Ret.Repo.all() |> Enum.at(0) |> Ecto.Changeset.change(is_admin: true) |> Ret.Repo.update!()" | iex -S mix' 2>&1; then
        success "Admin promotion command executed."
    else
        warn "Automatic promotion may have failed. You can do it manually:"
        echo "  1. Run: docker compose exec reticulum iex -S mix"
        echo "  2. Then run:"
        echo "     Ret.Account |> Ret.Repo.all() |> Enum.at(0) |> Ecto.Changeset.change(is_admin: true) |> Ret.Repo.update!()"
    fi
    echo ""
    echo "  Please sign out in the browser, then sign in again to activate admin."
    echo "  (Since SMTP is not configured yet, we will fetch the sign-in link from logs.)"
    prompt_and_wait "Sign out and enter your email in the browser, then press Enter"

    info "Fetching sign-in link from Reticulum logs..."
    local magic_link2=""
    magic_link2=$(docker compose logs reticulum 2>/dev/null | grep -oE 'https?://[^ ]*auth_token=[^ ]*' | tail -1 | sed 's/[",]$//')

    if [ -n "$magic_link2" ]; then
        echo ""
        success "Sign-in link found:"
        echo ""
        echo "  $magic_link2"
        echo ""
        echo "  Open this link in the SAME browser where you entered your email."
    else
        warn "Could not find sign-in link automatically."
        echo "  Try running this in another terminal:"
        echo "    docker compose logs reticulum | grep auth_token"
        echo "  Then open the link in the SAME browser."
    fi
    prompt_and_wait "Open the sign-in link and complete sign-in, then press Enter to continue"

    # Step 4: Configure admin settings (manual — browser)
    echo "------------------------------------------------------------"
    info "  STEP 3: Configure Admin Settings"
    echo "------------------------------------------------------------"
    echo "  1. Open https://hubs.local:4000/admin"
    echo "  2. Side menu > Server Settings > Email tab — configure SMTP"
    echo "  3. Side menu > Server Settings > WEBRTC tab — configure SFU"
    prompt_and_wait "Configure admin settings, then press Enter to finish"

    # Done
    echo "============================================================"
    success "  ALL DONE!"
    echo "============================================================"
    echo ""
    echo "  DAILY USAGE:"
    echo "    Start:   bin/up"
    echo "    Stop:    bin/down"
    echo "    Restart: bin/down && mutagen daemon stop && bin/up"
    echo ""
    echo "============================================================"
    echo ""
}
