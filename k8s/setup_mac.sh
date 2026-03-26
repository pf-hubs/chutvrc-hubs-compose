#!/bin/bash
# =============================================================================
# Hubs Setup Script for Mac
# This script automates the setup process for deploying Hubs locally or to Azure AKS.
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
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}→ $1${NC}"
}

# =============================================================================
# Check if running on Mac
# =============================================================================
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_error "This script is for Mac only. Please use setup_windows.ps1 for Windows."
    exit 1
fi

print_header "Hubs Setup for Mac"
echo "This script will set up Hubs for local development or Azure cloud deployment."
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
# Step 1: Install Homebrew
# =============================================================================
print_header "Step 1: Checking Homebrew"

if command -v brew &> /dev/null; then
    print_success "Homebrew is already installed"
else
    print_info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add Homebrew to PATH for Apple Silicon Macs
    if [[ -f "/opt/homebrew/bin/brew" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
    print_success "Homebrew installed"
fi

# =============================================================================
# Step 2: Install required tools
# =============================================================================
print_header "Step 2: Installing Required Tools"

# Git
if command -v git &> /dev/null; then
    print_success "Git is already installed"
else
    print_info "Installing Git..."
    brew install git
    print_success "Git installed"
fi

# kubectl
if command -v kubectl &> /dev/null; then
    print_success "kubectl is already installed"
else
    print_info "Installing kubectl..."
    brew install kubectl
    print_success "kubectl installed"
fi

# Node.js
if command -v node &> /dev/null; then
    print_success "Node.js is already installed"
else
    print_info "Installing Node.js..."
    brew install node
    print_success "Node.js installed"
fi

# pem-jwk
if npm list -g pem-jwk &> /dev/null; then
    print_success "pem-jwk is already installed"
else
    print_info "Installing pem-jwk..."
    npm install -g pem-jwk
    print_success "pem-jwk installed"
fi

# Azure CLI (only for Azure deployment)
if [[ "$DEPLOY_TARGET" == "azure" ]]; then
    if command -v az &> /dev/null; then
        print_success "Azure CLI is already installed"
    else
        print_info "Installing Azure CLI..."
        brew install azure-cli
        print_success "Azure CLI installed"
    fi
fi

# mkcert (only for local deployment)
if [[ "$DEPLOY_TARGET" == "local" ]]; then
    if command -v mkcert &> /dev/null; then
        print_success "mkcert is already installed"
    else
        print_info "Installing mkcert..."
        brew install mkcert
        print_success "mkcert installed"
    fi
fi

# =============================================================================
# Local Deployment Path
# =============================================================================
if [[ "$DEPLOY_TARGET" == "local" ]]; then

    # =========================================================================
    # Step 3: Setup mkcert (Local only)
    # =========================================================================
    print_header "Step 3: Setting up SSL Certificates"

    print_info "Installing mkcert root CA (you may be asked for your password)..."
    mkcert -install
    print_success "mkcert root CA installed"

    # =========================================================================
    # Step 4: Check Docker Desktop (Local only)
    # =========================================================================
    print_header "Step 4: Checking Docker Desktop"

    if ! command -v docker &> /dev/null; then
        print_warning "Docker Desktop is not installed or not running."
        echo ""
        echo "Please complete these manual steps:"
        echo "1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/"
        echo "2. Install and open Docker Desktop"
        echo "3. Go to Settings > Kubernetes"
        echo "4. Check 'Enable Kubernetes'"
        echo "5. Click 'Apply & Restart'"
        echo "6. Wait for Kubernetes to show green/running status"
        echo ""
        read -p "Press Enter after completing these steps..."
    else
        print_success "Docker is installed"

        # Check if Kubernetes is enabled
        if kubectl cluster-info &> /dev/null; then
            print_success "Kubernetes is running"
        else
            print_warning "Kubernetes may not be enabled in Docker Desktop."
            echo ""
            echo "Please ensure:"
            echo "1. Docker Desktop is running"
            echo "2. Kubernetes is enabled (Settings > Kubernetes > Enable Kubernetes)"
            echo ""
            read -p "Press Enter after verifying..."
        fi
    fi

    # =========================================================================
    # Step 5: Configure hosts file (Local only)
    # =========================================================================
    print_header "Step 5: Configuring hosts file"

    if grep -q "hubs.local" /etc/hosts; then
        print_success "hosts file already configured"
    else
        print_info "Adding hubs.local entries to /etc/hosts (requires password)..."
        sudo bash -c 'cat >> /etc/hosts << EOF

# Hubs Local Development
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
EOF'
        print_success "hosts file configured"
    fi

    HUB_DOMAIN="hubs.local"

    # =========================================================================
    # Step 6: Select deployment template (Local)
    # =========================================================================
    # Template: using Chutvrc
    cp templates/hcce-chutvrc-local.yam hcce.yam
    print_success "Chutvrc template configured"

# =============================================================================
# Azure AKS Deployment Path
# =============================================================================
else

    # =========================================================================
    # Step 3: Azure Login
    # =========================================================================
    print_header "Step 3: Azure Login"

    print_info "Logging in to Azure..."
    echo "A browser window will open for authentication."
    az login
    print_success "Azure login successful"

    # =========================================================================
    # Step 4: Configure Azure Resources
    # =========================================================================
    print_header "Step 4: Configure Azure Resources"

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
    # Step 5: Create Network Security Group
    # =========================================================================
    print_header "Step 5: Creating Network Security Group"

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
    # Step 6: Create AKS Cluster
    # =========================================================================
    print_header "Step 6: Creating AKS Cluster"

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
    # Step 7: Configure Domain
    # =========================================================================
    print_header "Step 7: Configure Domain"

    echo "Enter the domain name you will use for Hubs."
    echo "Example: hubs.yourdomain.com"
    echo ""
    read -p "Enter your domain: " HUB_DOMAIN

    if [[ -z "$HUB_DOMAIN" ]]; then
        print_error "Domain is required for Azure deployment."
        exit 1
    fi
    print_success "Domain set to: $HUB_DOMAIN"

    # =========================================================================
    # Step 8: Select deployment template (Azure)
    # =========================================================================
    # Template: using Chutvrc
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
    sed -i '' "s|export HUB_DOMAIN=.*|export HUB_DOMAIN=\"$HUB_DOMAIN\"|" overlays/local.env
else
    sed -i '' "s|export HUB_DOMAIN=.*|export HUB_DOMAIN=\"$HUB_DOMAIN\"|" overlays/production.env
fi

print_success "Configuration updated"

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
    echo "1. Quit your browser completely (Cmd + Q)"
    echo "2. Open your browser and go to: https://hubs.local"
    echo ""
    echo "If you see an SSL warning, try:"
    echo "- Quitting and reopening your browser"
    echo "- Clearing your browser cache"
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
