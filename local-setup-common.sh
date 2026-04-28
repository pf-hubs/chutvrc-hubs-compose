#!/bin/bash
# setup-common.sh — Shared setup logic for macOS, Linux, and Windows.
# Sourced by local-setup-mac.command, local-setup-linux.sh, and
# local-setup-windows.bat (via Git Bash).

BOLD='\033[1;37m'
GREEN='\033[1;32m'
YELLOW='\033[1;33m'
RED='\033[1;31m'
RESET='\033[0m'

info()    { echo -e "${BOLD}$*${RESET}"; }
success() { echo -e "${GREEN}$*${RESET}"; }
warn()    { echo -e "${YELLOW}$*${RESET}"; }
fail()    { echo -e "${RED}$*${RESET}"; }

# ── Scenario detection (.env-driven) ─────────────────────────────────────────
#
# Sets two globals used by the rest of this file:
#   SCENARIO  — internal label: "local" | "lan" | "public-domain"
#   HUBS_HOST — hostname/IP the user is actually accessing chutvrc on
#
# Detection rules (matched against HUBS_HOST as read from .env):
#   unset / empty / "hubs.local"          → local (single-device default)
#   IPv4 dotted-quad (e.g. 192.168.x.y)    → lan (other devices on the LAN)
#   anything else (e.g. hubs.example.com)  → public-domain (real DNS)
#
# Public-domain mode additionally requires PRIVATE_NETWORK_IP in .env
# (auto-detection in bin/up returns the wrong NIC on cloud VMs and silently
# breaks WebRTC media).

# Read .env line-by-line and export only well-formed KEY=VALUE pairs (avoids
# breaking on values that contain shell metacharacters or unquoted spaces).
load_env() {
    local envfile="${basedir:-.}/.env"
    [ -f "$envfile" ] || return 0
    [ -r "$envfile" ] || { warn ".env exists but is not readable; ignoring."; return 0; }
    while IFS= read -r line || [ -n "$line" ]; do
        # match: KEY=value (KEY must start with letter/underscore)
        if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}" val="${BASH_REMATCH[2]}"
            # strip surrounding single or double quotes if any
            [[ "$val" =~ ^\"(.*)\"$ ]] && val="${BASH_REMATCH[1]}"
            [[ "$val" =~ ^\'(.*)\'$ ]] && val="${BASH_REMATCH[1]}"
            export "$key=$val"
        fi
    done < "$envfile"
}

detect_scenario() {
    local host="${HUBS_HOST:-}"
    if [ -z "$host" ] || [ "$host" = "hubs.local" ]; then
        SCENARIO=local
    elif [[ "$host" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        SCENARIO=lan
        # Single-host LAN: announce IP for mediasoup defaults to the LAN IP
        # itself if the user didn't override it explicitly.
        : "${PRIVATE_NETWORK_IP:=$host}"
        export PRIVATE_NETWORK_IP
    else
        SCENARIO=public-domain
        if [ -z "${PRIVATE_NETWORK_IP:-}" ]; then
            fail "ERROR: Public-domain hosting requires PRIVATE_NETWORK_IP=<server public IP> in .env."
            warn "bin/up auto-detection returns the private NIC on cloud VMs, which silently breaks WebRTC media."
            warn "See MANUAL_SETUP.md (Remote Server section) for details."
            exit 1
        fi
    fi
    export SCENARIO
    case "$SCENARIO" in
      local)         info "Single-device development on hubs.local." ;;
      lan)           info "LAN access (other devices reach chutvrc at $HUBS_HOST). PRIVATE_NETWORK_IP=$PRIVATE_NETWORK_IP" ;;
      public-domain) info "Public-domain hosting at $HUBS_HOST. PRIVATE_NETWORK_IP=$PRIVATE_NETWORK_IP" ;;
    esac
}

# ── Interactively pick a scenario when .env doesn't already set HUBS_HOST ───
#
# Skipped silently if HUBS_HOST is already set in .env (the user has already
# made their choice). For LAN / public-domain, this function prints the
# .env contents the user needs to add and exits 0 — they edit .env and
# re-run the script.
#
# The default (just press Enter) is local single-device development, so
# users who don't care about scenarios still get the one-click experience.
ask_scenario_if_unset() {
    if [ -n "${HUBS_HOST:-}" ]; then
        # User already populated .env — no need to ask.
        return 0
    fi

    echo ""
    echo "============================================================"
    info "  Which deployment scenario?"
    echo "============================================================"
    echo ""
    echo "  1) Local single-device development  (DEFAULT — press Enter)"
    echo "     Access at https://hubs.local:4000 from this machine only."
    echo ""
    echo "  2) LAN access"
    echo "     Other devices on your WiFi/LAN reach chutvrc via your machine's IP."
    echo ""
    echo "  3) Public-domain hosting"
    echo "     Access from anywhere via a real domain (e.g., hubs.example.com)."
    echo ""

    local choice
    read -rp "  Enter 1, 2, or 3 [1]: " choice
    choice="${choice:-1}"
    echo ""

    case "$choice" in
      1)
        success "Proceeding with local single-device development."
        ;;
      2)
        warn "LAN access selected — needs .env configuration before continuing."
        echo ""
        echo "  Step 1: Find your machine's LAN IP."
        echo "          (e.g., 192.168.x.y — NOT a 172.x or virtual-bridge address)"
        echo "    macOS:  ifconfig | grep 'inet ' | grep -v 127.0.0.1"
        echo "    Linux:  ip -4 addr show | grep 'inet ' | grep -v 127.0.0.1"
        echo ""
        echo "  Step 2: Edit .env at the repo root (copy from .env.example if needed):"
        echo "    HUBS_HOST=<your-LAN-IP>"
        echo ""
        echo "  Step 3: Re-run this script."
        echo ""
        info "Aborting so you can configure .env. Re-run when ready."
        exit 0
        ;;
      3)
        warn "Public-domain hosting selected — needs .env configuration before continuing."
        echo ""
        echo "  Step 1: Make sure your domain (e.g., hubs.example.com) has a DNS A"
        echo "          record pointing to your server's public IP."
        echo ""
        echo "  Step 2: Edit .env at the repo root (copy from .env.example if needed):"
        echo "    HUBS_HOST=<your-domain>"
        echo "    PRIVATE_NETWORK_IP=<your-server-public-IP>"
        echo "    LE_EMAIL=<your-email>   # optional, lets certbot run unattended"
        echo ""
        echo "  Step 3: Open ports 80, 4000, 4443, 8080, 40000-40050 on the server firewall."
        echo ""
        echo "  Step 4: Re-run this script."
        echo ""
        info "Aborting so you can configure .env. Re-run when ready."
        exit 0
        ;;
      *)
        fail "Invalid choice: '$choice'. Re-run and enter 1, 2, or 3."
        exit 1
        ;;
    esac
}

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
    # "Cloned" is not enough — bin/init can fail mid-way (leaving services cloned
    # but with no deps installed), and the container start later fails cryptically
    # with "webpack not found", "Cannot find module", etc. So we treat the run as
    # successful only when a sentinel file is present; bin/init writes that file
    # on full success.
    local sentinel="$basedir/.bin-init-completed"
    if [ -f "$sentinel" ]; then
        success "Services already initialized. Skipping bin/init."
        echo "(Delete $sentinel and run bin/reset to re-initialize from scratch.)"
        return 0
    fi

    if [ -d "services/reticulum/.git" ]; then
        warn "Services are cloned but no init-completed sentinel found."
        warn "Re-running bin/init to (re)install dependencies — this is idempotent."
    fi

    info "Running bin/init (this will take a while)..."
    if ! bin/init; then
        fail "ERROR: bin/init failed."
        echo "Check the output above for details. You can re-run this script to retry."
        return 1
    fi
    touch "$sentinel"
    success "bin/init completed successfully."
}

# ── Generate SSL certificates ────────────────────────────────────────────────
#
# Dispatches by SCENARIO (set by detect_scenario):
#   A: mkcert with hubs.local SAN list (default).
#   B: mkcert with the LAN IP added as SAN (hubs.local/hubs-proxy.local kept
#      so prior /etc/hosts entries don't trip cert errors, and so the Hubs
#      client default CORS_PROXY_SERVER=hubs-proxy.local still validates).
#   C: certbot --standalone for a real domain. Requires port 80 free.

# Print the firewall port table for the active scenario. Best-effort
# informational output — we cannot configure the user's firewall for them.
print_firewall_table() {
    case "$SCENARIO" in
      lan)
        info "Open these ports on the host firewall (if not already open):"
        echo "  TCP  4000        Reticulum"
        echo "  TCP  4443        Dialog (WebRTC signaling)"
        echo "  TCP  8080        Hubs Client"
        echo "  UDP  40000-40050 mediasoup (WebRTC media)"
        ;;
      public-domain)
        info "Open these ports on the server firewall (if not already open):"
        echo "  TCP  80          certbot HTTP-01 challenge (temporary, for cert renewal)"
        echo "  TCP  4000        Reticulum"
        echo "  TCP  4443        Dialog (WebRTC signaling)"
        echo "  TCP  8080        Hubs Client"
        echo "  UDP  40000-40050 mediasoup (WebRTC media)"
        ;;
    esac
}

generate_certs() {
    case "$SCENARIO" in
      local)
        if ! command -v mkcert &>/dev/null; then
            fail "ERROR: mkcert is not installed."
            return 1
        fi
        info "Installing mkcert root CA (you may be prompted for your password)..."
        mkcert -install
        [ -f shared-cert.pem ] && warn "Existing certificates found. Regenerating..."
        info "Generating SSL certificates for local development..."
        mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
            localhost 127.0.0.1 ::1 \
            hubs.local hubs-proxy.local hubs-client hubs-admin spoke \
            reticulum dialog postgrest
        success "SSL certificates generated."
        ;;
      lan)
        if ! command -v mkcert &>/dev/null; then
            fail "ERROR: mkcert is not installed."
            return 1
        fi
        info "Installing mkcert root CA (you may be prompted for your password)..."
        mkcert -install
        [ -f shared-cert.pem ] && warn "Existing certificates found. Regenerating..."
        info "Generating SSL certificates for LAN access ($HUBS_HOST)..."
        mkcert -key-file shared-key.pem -cert-file shared-cert.pem \
            localhost 127.0.0.1 ::1 \
            "$HUBS_HOST" \
            hubs.local hubs-proxy.local \
            hubs-client hubs-admin spoke reticulum dialog postgrest
        success "SSL certificates generated."
        echo ""
        info "To trust this cert from another LAN device, copy this file to it and import as a root CA:"
        echo "  $(mkcert -CAROOT)/rootCA.pem"
        echo ""
        print_firewall_table
        ;;
      public-domain)
        # Windows (Git Bash / msys / cygwin) has no native certbot port.
        case "$OSTYPE" in
          msys*|cygwin*|win*)
            fail "ERROR: Public-domain hosting (with a real DNS-resolvable domain) is not supported on Windows."
            warn "Run from WSL2, or follow MANUAL_SETUP.md (Remote Server section) on a Linux server."
            return 1
            ;;
        esac
        if ! command -v certbot &>/dev/null; then
            fail "ERROR: certbot is not installed."
            warn "Install with: apt-get install certbot   (Debian/Ubuntu)"
            warn "             dnf install certbot       (Fedora/RHEL)"
            warn "             brew install certbot      (macOS)"
            return 1
        fi
        # Port 80 must be free for HTTP-01 challenge.
        if command -v ss &>/dev/null && ss -lnt 2>/dev/null | grep -qE '[: ]80[[:space:]]'; then
            fail "ERROR: Port 80 is already in use."
            warn "Stop nginx/apache/etc. on port 80 before running certbot."
            return 1
        elif command -v lsof &>/dev/null && lsof -iTCP:80 -sTCP:LISTEN 2>/dev/null | grep -q .; then
            fail "ERROR: Port 80 is already in use."
            warn "Stop nginx/apache/etc. on port 80 before running certbot."
            return 1
        fi
        info "Requesting Let's Encrypt certificate for $HUBS_HOST..."
        if [ -n "${LE_EMAIL:-}" ]; then
            sudo certbot certonly --standalone -d "$HUBS_HOST" \
                --non-interactive --agree-tos -m "$LE_EMAIL" --keep-until-expiring
        else
            warn "LE_EMAIL not set in .env — certbot will prompt interactively."
            sudo certbot certonly --standalone -d "$HUBS_HOST" --keep-until-expiring
        fi
        sudo cp "/etc/letsencrypt/live/$HUBS_HOST/privkey.pem"   shared-key.pem
        sudo cp "/etc/letsencrypt/live/$HUBS_HOST/fullchain.pem" shared-cert.pem
        sudo chown "$(whoami)" shared-key.pem shared-cert.pem
        success "SSL certificates generated."
        echo ""
        print_firewall_table
        echo ""
        warn "Let's Encrypt certs expire in ~90 days. To auto-renew, add to root crontab:"
        echo "  0 3 * * * certbot renew --deploy-hook 'cd $(pwd) && bin/down && bin/up'"
        ;;
      *)
        fail "ERROR: SCENARIO is unset; call detect_scenario before generate_certs."
        return 1
        ;;
    esac
}

# ── /etc/hosts management (single-device only, mac/linux only) ──────────────
#
# Windows handles hosts editing in its own .bat via PowerShell elevation; this
# function is a no-op there. For LAN / public-domain modes, no hosts edits
# are required (LAN uses the IP directly, public-domain uses real DNS).
configure_hosts() {
    if [ "$SCENARIO" != local ]; then
        info "Skipping /etc/hosts edit (using ${HUBS_HOST}, not hubs.local)."
        return 0
    fi
    case "$OSTYPE" in
      darwin*|linux-gnu*) ;;
      *)
        info "Skipping /etc/hosts on $OSTYPE — handled by the platform wrapper."
        return 0
        ;;
    esac
    if grep -qE '^[[:space:]]*127\.0\.0\.1[[:space:]]+hubs\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
        success "/etc/hosts already contains hubs.local entries."
        return 0
    fi
    if ! command -v sudo >/dev/null; then
        fail "ERROR: sudo not available; add manually to /etc/hosts:"
        warn "  127.0.0.1   hubs.local"
        warn "  127.0.0.1   hubs-proxy.local"
        return 1
    fi
    warn "Adding hubs.local entries to /etc/hosts (requires sudo)..."
    sudo -v   # prime credentials so the prompt isn't interleaved with later output
    echo "127.0.0.1   hubs.local"       | sudo tee -a /etc/hosts >/dev/null
    echo "127.0.0.1   hubs-proxy.local" | sudo tee -a /etc/hosts >/dev/null
    success "Hosts file updated."
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
    local host="${HUBS_HOST:-hubs.local}"
    local base_url="https://$host:4000"
    local browser_loc="in your browser"
    if [ "$SCENARIO" = "public-domain" ]; then
        browser_loc="in a browser on any internet-connected device"
    fi

    echo ""
    echo "============================================================"
    echo "  AUTOMATED SETUP COMPLETE — Guided Steps"
    echo "============================================================"
    echo ""

    if [ "$SCENARIO" != local ] && grep -qE '^[[:space:]]*127\.0\.0\.1[[:space:]]+hubs\.local([[:space:]]|$)' /etc/hosts 2>/dev/null; then
        warn "Note: /etc/hosts still contains a 'hubs.local' entry from a previous single-device run."
        warn "Use $base_url (the URL printed below). Cert errors at hubs.local are expected and harmless."
        echo ""
    fi

    # Step 1: Wait for healthy
    wait_for_services_healthy
    echo ""

    # Step 2: Sign in (guided — fetch magic link automatically)
    echo "------------------------------------------------------------"
    info "  STEP 1: Sign In"
    echo "------------------------------------------------------------"
    echo "  1. Open $base_url $browser_loc"
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
    echo "  1. Open $base_url/admin"
    echo "  2. Side menu > Server Settings > Email tab — configure SMTP"
    echo "  3. Side menu > Server Settings > WEBRTC tab — configure SFU"
    prompt_and_wait "Configure admin settings, then press Enter to finish"

    # Done
    echo "============================================================"
    success "  ALL DONE!"
    echo "============================================================"
    echo ""
    echo "  DAILY USAGE:"
    echo "    Start:   bin/up         (or double-click start-mac.command /"
    echo "                             start-windows.bat / start-linux.sh)"
    echo "    Stop:    bin/down"
    echo "    Restart: bin/down && mutagen daemon stop && bin/up"
    echo ""
    echo "  Note: do NOT re-run local-setup-* on subsequent days — those are"
    echo "  one-time setup scripts. Use the start-* scripts (or bin/up) instead."
    echo ""
    echo "============================================================"
    echo ""
}
