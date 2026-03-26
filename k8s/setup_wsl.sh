#!/bin/bash
# =============================================================================
# Hubs Setup Script for WSL (Windows Subsystem for Linux)
# This script automates the setup process for deploying Hubs locally or to Azure AKS.
#
# HOW TO RUN:
# 1. Open Ubuntu (or your WSL distro) terminal
# 2. Navigate to the community-edition folder
# 3. Run: chmod +x setup_wsl.sh && ./setup_wsl.sh
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo -e "${BLUE}======================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}======================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}[OK] $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}[!] $1${NC}"
}

print_error() {
    echo -e "${RED}[X] $1${NC}"
}

print_info() {
    echo -e "${BLUE}[-] $1${NC}"
}

# =============================================================================
# Check if running in WSL
# =============================================================================
if ! grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    print_error "This script is for WSL (Windows Subsystem for Linux) only."
    print_error "For native Linux, please use setup_linux.sh."
    print_error "For Windows, please use setup_windows.ps1."
    exit 1
fi

print_header "Hubs Setup for WSL"
echo "This script will set up Hubs for local development or Azure cloud deployment."
echo ""
echo "Important: Since your browser runs on Windows (not in WSL), this script"
echo "will guide you through importing certificates to Windows and editing the"
echo "Windows hosts file for local deployment."
echo ""

# =============================================================================
# Select Deployment Target
# =============================================================================
echo "Where would you like to deploy Hubs?"
echo "1) Local (Docker Desktop) - For development and testing"
echo "2) Azure AKS (Cloud) - For production deployment"
echo ""
read -p "Enter your choice (1 or 2): " deploy_target

case $deploy_target in
    1)
        DEPLOY_TARGET="local"
        print_success "Local deployment selected"
        ;;
    2)
        DEPLOY_TARGET="azure"
        print_success "Azure AKS deployment selected"
        ;;
    *)
        print_warning "Invalid choice, defaulting to Local"
        DEPLOY_TARGET="local"
        ;;
esac

echo ""
read -p "Press Enter to continue..."

# =============================================================================
# Step 1: Install tools via apt
# =============================================================================
print_header "Step 1: Installing Required Tools"

print_info "Updating package lists..."
sudo apt update

# Git
if command -v git &> /dev/null; then
    print_success "Git is already installed"
else
    print_info "Installing Git..."
    sudo apt install -y git
    print_success "Git installed"
fi

# kubectl
if command -v kubectl &> /dev/null; then
    print_success "kubectl is already installed"
else
    print_info "Installing kubectl..."
    sudo apt install -y kubectl || {
        # If kubectl is not in apt, install via snap or download
        print_warning "kubectl not found in apt, trying alternative installation..."
        curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
        sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
        rm kubectl
    }
    print_success "kubectl installed"
fi

# libnss3-tools (for mkcert)
print_info "Installing libnss3-tools..."
sudo apt install -y libnss3-tools
print_success "libnss3-tools installed"

# mkcert (only for local deployment)
if [[ "$DEPLOY_TARGET" == "local" ]]; then
    if command -v mkcert &> /dev/null; then
        print_success "mkcert is already installed"
    else
        print_info "Downloading mkcert..."
        curl -JLO "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64"
        sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
        sudo chmod +x /usr/local/bin/mkcert
        print_success "mkcert installed"
    fi
fi

# Node.js
if command -v node &> /dev/null; then
    print_success "Node.js is already installed"
else
    print_info "Installing Node.js..."
    sudo apt install -y nodejs npm
    print_success "Node.js installed"
fi

# pem-jwk
if npm list -g pem-jwk &> /dev/null 2>&1; then
    print_success "pem-jwk is already installed"
else
    print_info "Installing pem-jwk..."
    sudo npm install -g pem-jwk
    print_success "pem-jwk installed"
fi

# Azure CLI (only for Azure deployment)
if [[ "$DEPLOY_TARGET" == "azure" ]]; then
    if command -v az &> /dev/null; then
        print_success "Azure CLI is already installed"
    else
        print_info "Installing Azure CLI..."
        curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
        print_success "Azure CLI installed"
    fi
fi

# =============================================================================
# Local Deployment Path
# =============================================================================
if [[ "$DEPLOY_TARGET" == "local" ]]; then

    # =========================================================================
    # Step 2: Setup mkcert (Local only)
    # =========================================================================
    print_header "Step 2: Setting up SSL Certificates"

    print_info "Installing mkcert root CA in WSL..."
    mkcert -install
    print_success "mkcert root CA installed in WSL"

    # =========================================================================
    # Step 3: Guide user through Windows CA import (Local only)
    # =========================================================================
    print_header "Step 3: Import CA Certificate to Windows (Important!)"

    echo "Since your browser runs on Windows, you need to import the mkcert CA"
    echo "certificate to Windows for your browser to trust it."
    echo ""

    CA_ROOT=$(mkcert -CAROOT)
    print_info "Your CA root is located at: $CA_ROOT"
    echo ""

    echo "Opening the CA folder in Windows Explorer..."
    cd "$CA_ROOT" && explorer.exe . 2>/dev/null || {
        print_warning "Could not open Explorer. Please navigate to this folder manually:"
        echo "  $CA_ROOT"
    }
    cd - > /dev/null

    echo ""
    echo "Please follow these steps to import the certificate to Windows:"
    echo ""
    echo "  1. In the Explorer window, you should see 'rootCA.pem'"
    echo "  2. Click on the address bar and copy the full path"
    echo "     (looks like: \\\\wsl.localhost\\Ubuntu\\home\\...\\rootCA.pem)"
    echo ""
    echo "  3. Press Win + R to open the Run dialog"
    echo "  4. Type 'certmgr.msc' and press Enter"
    echo ""
    echo "  5. In the left panel, expand 'Trusted Root Certification Authorities'"
    echo "  6. Click on 'Certificates'"
    echo "  7. Right-click in the right panel > 'All Tasks' > 'Import...'"
    echo ""
    echo "  8. Click 'Next'"
    echo "  9. Click 'Browse...', paste the path you copied, click 'Open', then 'Next'"
    echo "  10. Make sure 'Place all certificates in the following store' is selected"
    echo "  11. Store should say 'Trusted Root Certification Authorities'"
    echo "  12. Click 'Next', then 'Finish'"
    echo "  13. Click 'Yes' to confirm the security warning, then 'OK'"
    echo ""
    read -p "Press Enter after you have imported the certificate to Windows..."
    print_success "CA certificate import step completed"

    # =========================================================================
    # Step 4: Check Docker Desktop (Local only)
    # =========================================================================
    print_header "Step 4: Checking Docker Desktop"

    if command -v docker &> /dev/null; then
        print_success "Docker is accessible from WSL"

        # Check if Kubernetes is enabled
        if kubectl cluster-info &> /dev/null 2>&1; then
            print_success "Kubernetes is running"
        else
            print_warning "Kubernetes may not be enabled in Docker Desktop."
            echo ""
            echo "Please ensure:"
            echo "1. Docker Desktop is running on Windows"
            echo "2. WSL Integration is enabled for your distro (Settings > Resources > WSL Integration)"
            echo "3. Kubernetes is enabled (Settings > Kubernetes > Enable Kubernetes)"
            echo ""
            read -p "Press Enter after verifying..."
        fi
    else
        print_warning "Docker is not accessible from WSL."
        echo ""
        echo "Please complete these steps:"
        echo "1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/"
        echo "2. Install and open Docker Desktop on Windows"
        echo "3. Go to Settings > Resources > WSL Integration"
        echo "4. Enable integration for your WSL distro (e.g., Ubuntu)"
        echo "5. Go to Settings > Kubernetes"
        echo "6. Check 'Enable Kubernetes'"
        echo "7. Click 'Apply & Restart'"
        echo "8. Wait for both Docker and Kubernetes to show green/running status"
        echo ""
        read -p "Press Enter after completing these steps..."
    fi

    # =========================================================================
    # Step 5: Configure Windows hosts file (Local only)
    # =========================================================================
    print_header "Step 5: Configuring Windows hosts file"

    echo "Checking if hubs.local is already in Windows hosts file..."

    # Check if hosts file already has hubs.local
    if powershell.exe -Command "Get-Content 'C:\Windows\System32\drivers\etc\hosts'" 2>/dev/null | grep -q "hubs.local"; then
        print_success "Windows hosts file already configured"
    else
        print_info "Adding hubs.local entries to Windows hosts file..."
        echo ""
        echo "This requires Administrator privileges on Windows."
        echo "A PowerShell window will open asking for permission."
        echo ""

        # Use PowerShell to add entries with admin privileges
        powershell.exe -Command "Start-Process powershell -Verb RunAs -ArgumentList '-Command', 'Add-Content -Path C:\Windows\System32\drivers\etc\hosts -Value \"\`n# Hubs Local Development\`n127.0.0.1   hubs.local\`n127.0.0.1   assets.hubs.local\`n127.0.0.1   cors.hubs.local\`n127.0.0.1   stream.hubs.local\"'" 2>/dev/null || {
            print_warning "Could not automatically edit hosts file."
            echo ""
            echo "Please manually add these lines to C:\\Windows\\System32\\drivers\\etc\\hosts:"
            echo ""
            echo "127.0.0.1   hubs.local"
            echo "127.0.0.1   assets.hubs.local"
            echo "127.0.0.1   cors.hubs.local"
            echo "127.0.0.1   stream.hubs.local"
            echo ""
            echo "You can run this command to open the file:"
            echo "  powershell.exe -Command \"Start-Process notepad 'C:\\Windows\\System32\\drivers\\etc\\hosts' -Verb RunAs\""
            echo ""
        }

        read -p "Press Enter after the hosts file has been updated..."
        print_success "Windows hosts file configuration step completed"
    fi

    HUB_DOMAIN="hubs.local"

    cp templates/hcce-chutvrc-local.yam hcce.yam
    print_success "Chutvrc template configured"

# =============================================================================
# Azure AKS Deployment Path
# =============================================================================
else

    # =========================================================================
    # Step 2: Azure Login
    # =========================================================================
    print_header "Step 2: Azure Login"

    print_info "Logging in to Azure..."
    echo "A browser window will open for authentication."
    az login
    print_success "Azure login successful"

    # =========================================================================
    # Step 3: Configure Azure Resources
    # =========================================================================
    print_header "Step 3: Configure Azure Resources"

    read -p "Enter resource group name (default: HubsResourceGroup): " resource_group
    resource_group=${resource_group:-HubsResourceGroup}

    read -p "Enter Azure region (default: westeurope): " azure_region
    azure_region=${azure_region:-westeurope}

    read -p "Enter AKS cluster name (default: HubsCluster): " cluster_name
    cluster_name=${cluster_name:-HubsCluster}

    # Create resource group
    print_info "Creating resource group..."
    az group create --name "$resource_group" --location "$azure_region"
    print_success "Resource group created"

    # =========================================================================
    # Step 4: Create Network Security Group
    # =========================================================================
    print_header "Step 4: Creating Network Security Group"

    print_info "Creating NSG..."
    az network nsg create --resource-group "$resource_group" --name HubsNSG

    print_info "Adding firewall rules..."
    az network nsg rule create --resource-group "$resource_group" --nsg-name HubsNSG \
        --name AllowStream --priority 1000 --direction Inbound --access Allow \
        --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 4443

    az network nsg rule create --resource-group "$resource_group" --nsg-name HubsNSG \
        --name AllowTurn --priority 1001 --direction Inbound --access Allow \
        --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 5349

    az network nsg rule create --resource-group "$resource_group" --nsg-name HubsNSG \
        --name AllowUDP --priority 1002 --direction Inbound --access Allow \
        --protocol Udp --source-address-prefixes '*' --destination-port-ranges 35000-60000

    print_success "Network security group configured"

    # =========================================================================
    # Step 5: Create AKS Cluster
    # =========================================================================
    print_header "Step 5: Creating AKS Cluster"

    print_warning "This step takes 5-10 minutes. Please wait..."
    az aks create \
        -g "$resource_group" \
        -n "$cluster_name" \
        -l "$azure_region" \
        -s Standard_F2s_v2 \
        --enable-node-public-ip \
        --node-count 2 \
        --network-plugin azure

    print_success "AKS cluster created"

    # Get credentials
    print_info "Getting cluster credentials..."
    az aks get-credentials --resource-group "$resource_group" --name "$cluster_name"
    print_success "Cluster credentials configured"

    # =========================================================================
    # Step 6: Configure Domain
    # =========================================================================
    print_header "Step 6: Configure Domain"

    echo "Enter the domain name you will use for Hubs."
    echo "Example: hubs.yourdomain.com"
    echo ""
    read -p "Enter your domain: " HUB_DOMAIN

    if [[ -z "$HUB_DOMAIN" ]]; then
        print_error "Domain is required for Azure deployment."
        exit 1
    fi
    print_success "Domain set to: $HUB_DOMAIN"

    cp templates/hcce-chutvrc.yam hcce.yam
    print_success "Chutvrc template configured"

fi

# =============================================================================
# Common Steps: SMTP Configuration
# =============================================================================
print_header "Configure Email Settings"

echo "Hubs requires SMTP settings to send login emails."
echo "You can use Gmail with an App Password."
echo ""
echo "To get a Gmail App Password:"
echo "1. Go to Google Account > Security"
echo "2. Enable 2-Step Verification"
echo "3. Go to Security > 2-Step Verification > App passwords"
echo "4. Create an app password for 'Mail'"
echo ""

read -p "Enter your email address: " user_email
read -p "Enter SMTP server (default: smtp.gmail.com): " smtp_server
smtp_server=${smtp_server:-smtp.gmail.com}
read -p "Enter SMTP port (default: 587): " smtp_port
smtp_port=${smtp_port:-587}
read -p "Enter SMTP username (your email): " smtp_user
read -s -p "Enter SMTP password (App Password): " smtp_pass
echo ""

# Write secrets to overlay env file
print_info "Updating configuration..."

cat > overlays/secrets.env << SECRETS_EOF
export ADM_EMAIL="$user_email"
export DB_PASS="123456"
export SMTP_SERVER="$smtp_server"
export SMTP_PORT="$smtp_port"
export SMTP_USER="$smtp_user"
export SMTP_PASS="$smtp_pass"
export NODE_COOKIE="changeMe"
export GUARDIAN_KEY="changeMe"
export PHX_KEY="changeMe"
export SKETCHFAB_API_KEY="?"
export TENOR_API_KEY="?"
SECRETS_EOF

# Update HUB_DOMAIN in the appropriate overlay env file
if [[ "$DEPLOY_TARGET" == "local" ]]; then
    sed -i "s|export HUB_DOMAIN=.*|export HUB_DOMAIN=\"$HUB_DOMAIN\"|" overlays/local.env
else
    sed -i "s|export HUB_DOMAIN=.*|export HUB_DOMAIN=\"$HUB_DOMAIN\"|" overlays/production.env
fi

print_success "Configuration updated"

# =============================================================================
# Fix base64 command for Linux/WSL
# =============================================================================
print_header "Fixing base64 Command for Linux"

print_info "Checking render_hcce.sh for Mac-specific base64 syntax..."

if grep -q "base64 -i" render_hcce.sh; then
    print_info "Fixing base64 commands (removing -i flag for Linux compatibility)..."
    sed -i 's/base64 -i cert\.pem/base64 cert.pem/g' render_hcce.sh
    sed -i 's/base64 -i key\.pem/base64 key.pem/g' render_hcce.sh
    print_success "base64 commands fixed for Linux"
else
    print_success "base64 commands are already Linux-compatible"
fi

# =============================================================================
# Verify Kubernetes Context
# =============================================================================
print_header "Verifying Kubernetes Context"

current_context=$(kubectl config current-context 2>/dev/null || echo "none")
print_info "Current Kubernetes context: $current_context"

if [[ "$DEPLOY_TARGET" == "local" ]]; then
    if [[ "$current_context" != "docker-desktop" ]]; then
        print_warning "Switching to docker-desktop context..."
        kubectl config use-context docker-desktop || {
            print_error "Could not switch to docker-desktop context."
            print_error "Make sure Docker Desktop is running with Kubernetes enabled."
            exit 1
        }
    fi
fi
print_success "Kubernetes context verified"

# =============================================================================
# Deploy
# =============================================================================
print_header "Deploying Hubs"

if [[ "$DEPLOY_TARGET" == "local" ]]; then
    echo "Ready to deploy Hubs locally."
    read -p "Press Enter to start deployment..."

    chmod +x deploy_local.sh
    ./deploy_local.sh
else
    echo "Ready to deploy Hubs to Azure AKS."
    read -p "Press Enter to start deployment..."

    chmod +x render_hcce.sh
    bash render_hcce.sh production
    kubectl apply -f hcce.yaml

    print_header "Waiting for External IP"
    echo "Waiting for the load balancer to get an external IP..."
    echo "This may take a few minutes."
    echo ""
    echo "Run this command to check status:"
    echo "  kubectl get svc -n hcce"
    echo ""
    echo "Once you see an EXTERNAL-IP for the 'lb' service, configure your DNS:"
    echo "  - Create A records for: $HUB_DOMAIN, assets.$HUB_DOMAIN, cors.$HUB_DOMAIN, stream.$HUB_DOMAIN"
    echo "  - Point all of them to the EXTERNAL-IP"
    echo ""
    echo "Then run cbb.sh to set up SSL certificates with Let's Encrypt:"
    echo "  nano cbb.sh  # Update email and domain"
    echo "  bash cbb.sh"
fi

# =============================================================================
# Done!
# =============================================================================
print_header "Setup Complete!"

if [[ "$DEPLOY_TARGET" == "local" ]]; then
    echo -e "${GREEN}Hubs has been deployed locally!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Close your browser completely on Windows"
    echo "2. Open your browser and go to: https://hubs.local"
    echo ""
    echo "If you see an SSL warning:"
    echo "- Make sure you completed Step 3 (importing CA certificate to Windows)"
    echo "- Try closing and reopening your browser completely"
    echo "- Clear your browser cache"
else
    echo -e "${GREEN}Hubs has been deployed to Azure AKS!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Get the external IP: kubectl get svc -n hcce"
    echo "2. Configure DNS A records for your domain"
    echo "3. Run cbb.sh to set up SSL certificates"
    echo "4. Access your Hubs at: https://$HUB_DOMAIN"
fi

echo ""
print_success "Enjoy using Hubs!"
