# =============================================================================
# Hubs Setup Script for Windows
# This script automates the setup process for deploying Hubs locally or to Azure AKS.
#
# HOW TO RUN:
# 1. Right-click on this file
# 2. Select "Run with PowerShell"
# 3. If prompted about execution policy, type 'Y' and press Enter
# =============================================================================

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "This script requires Administrator privileges." -ForegroundColor Yellow
    Write-Host "Restarting as Administrator..." -ForegroundColor Yellow
    Start-Process powershell.exe "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

# Set execution policy for this session
Set-ExecutionPolicy Bypass -Scope Process -Force

function Write-Header {
    param([string]$text)
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host ""
}

function Write-Success {
    param([string]$text)
    Write-Host "[OK] $text" -ForegroundColor Green
}

function Write-Warning2 {
    param([string]$text)
    Write-Host "[!] $text" -ForegroundColor Yellow
}

function Write-Error2 {
    param([string]$text)
    Write-Host "[X] $text" -ForegroundColor Red
}

function Write-Info {
    param([string]$text)
    Write-Host "[-] $text" -ForegroundColor Cyan
}

# =============================================================================
# Start
# =============================================================================
Write-Header "Hubs Setup for Windows"
Write-Host "This script will set up Hubs for local development or Azure cloud deployment."
Write-Host ""

# =============================================================================
# Select Deployment Target
# =============================================================================
Write-Host "Where would you like to deploy Hubs?"
Write-Host "1) Local (Docker Desktop) - For development and testing"
Write-Host "2) Azure AKS (Cloud) - For production deployment"
Write-Host ""
$deployTarget = Read-Host "Enter your choice (1 or 2)"

switch ($deployTarget) {
    "1" {
        $DEPLOY_TARGET = "local"
        Write-Success "Local deployment selected"
    }
    "2" {
        $DEPLOY_TARGET = "azure"
        Write-Success "Azure AKS deployment selected"
    }
    default {
        Write-Warning2 "Invalid choice, defaulting to Local"
        $DEPLOY_TARGET = "local"
    }
}

Write-Host ""
Read-Host "Press Enter to continue"

# =============================================================================
# Step 1: Install Chocolatey
# =============================================================================
Write-Header "Step 1: Checking Chocolatey"

if (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Success "Chocolatey is already installed"
} else {
    Write-Info "Installing Chocolatey..."
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
    Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

    # Refresh environment
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    Write-Success "Chocolatey installed"
}

# =============================================================================
# Step 2: Install required tools
# =============================================================================
Write-Header "Step 2: Installing Required Tools"

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Success "Git is already installed"
} else {
    Write-Info "Installing Git..."
    choco install git -y
    Write-Success "Git installed"
}

# kubectl
if (Get-Command kubectl -ErrorAction SilentlyContinue) {
    Write-Success "kubectl is already installed"
} else {
    Write-Info "Installing kubectl..."
    choco install kubernetes-cli -y
    Write-Success "kubectl installed"
}

# Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Success "Node.js is already installed"
} else {
    Write-Info "Installing Node.js..."
    choco install nodejs -y
    Write-Success "Node.js installed"
}

# Refresh environment variables
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# pem-jwk
Write-Info "Installing pem-jwk..."
npm install -g pem-jwk 2>$null
Write-Success "pem-jwk installed"

# Azure CLI (only for Azure deployment)
if ($DEPLOY_TARGET -eq "azure") {
    if (Get-Command az -ErrorAction SilentlyContinue) {
        Write-Success "Azure CLI is already installed"
    } else {
        Write-Info "Installing Azure CLI..."
        choco install azure-cli -y
        # Refresh environment
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        Write-Success "Azure CLI installed"
    }
}

# mkcert (only for local deployment)
if ($DEPLOY_TARGET -eq "local") {
    if (Get-Command mkcert -ErrorAction SilentlyContinue) {
        Write-Success "mkcert is already installed"
    } else {
        Write-Info "Installing mkcert..."
        choco install mkcert -y
        Write-Success "mkcert installed"
    }
}

# Refresh environment variables again
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# =============================================================================
# Get script directory and change to it
# =============================================================================
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir
Write-Info "Working directory: $scriptDir"

# =============================================================================
# Local Deployment Path
# =============================================================================
if ($DEPLOY_TARGET -eq "local") {

    # =========================================================================
    # Step 3: Setup mkcert (Local only)
    # =========================================================================
    Write-Header "Step 3: Setting up SSL Certificates"

    Write-Info "Installing mkcert root CA..."
    mkcert -install
    Write-Success "mkcert root CA installed"

    # =========================================================================
    # Step 4: Check Docker Desktop (Local only)
    # =========================================================================
    Write-Header "Step 4: Checking Docker Desktop"

    if (Get-Command docker -ErrorAction SilentlyContinue) {
        Write-Success "Docker is installed"

        # Check if Kubernetes is enabled
        $kubeCheck = kubectl cluster-info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Kubernetes is running"
        } else {
            Write-Warning2 "Kubernetes may not be enabled in Docker Desktop."
            Write-Host ""
            Write-Host "Please ensure:" -ForegroundColor Yellow
            Write-Host "1. Docker Desktop is running" -ForegroundColor Yellow
            Write-Host "2. Kubernetes is enabled (Settings > Kubernetes > Enable Kubernetes)" -ForegroundColor Yellow
            Write-Host ""
            Read-Host "Press Enter after verifying"
        }
    } else {
        Write-Warning2 "Docker Desktop is not installed or not running."
        Write-Host ""
        Write-Host "Please complete these manual steps:" -ForegroundColor Yellow
        Write-Host "1. Download Docker Desktop from: https://www.docker.com/products/docker-desktop/" -ForegroundColor Yellow
        Write-Host "2. Install and open Docker Desktop" -ForegroundColor Yellow
        Write-Host "3. Go to Settings > Kubernetes" -ForegroundColor Yellow
        Write-Host "4. Check 'Enable Kubernetes'" -ForegroundColor Yellow
        Write-Host "5. Click 'Apply & Restart'" -ForegroundColor Yellow
        Write-Host "6. Wait for Kubernetes to show green/running status" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter after completing these steps"
    }

    # =========================================================================
    # Step 5: Configure hosts file (Local only)
    # =========================================================================
    Write-Header "Step 5: Configuring hosts file"

    $hostsPath = "$env:windir\System32\drivers\etc\hosts"
    $hostsContent = Get-Content $hostsPath -Raw

    if ($hostsContent -match "hubs\.local") {
        Write-Success "hosts file already configured"
    } else {
        Write-Info "Adding hubs.local entries to hosts file..."
        $newEntries = @"

# Hubs Local Development
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
"@
        Add-Content -Path $hostsPath -Value $newEntries
        Write-Success "hosts file configured"
    }

    $HUB_DOMAIN = "hubs.local"

    # =========================================================================
    # Step 6: Select deployment template (Local)
    # =========================================================================
    Copy-Item "templates\hcce-chutvrc-local.yam" "hcce.yam" -Force
    Write-Success "Chutvrc template configured"

# =============================================================================
# Azure AKS Deployment Path
# =============================================================================
} else {

    # =========================================================================
    # Step 3: Azure Login
    # =========================================================================
    Write-Header "Step 3: Azure Login"

    Write-Info "Logging in to Azure..."
    Write-Host "A browser window will open for authentication."
    az login
    Write-Success "Azure login successful"

    # =========================================================================
    # Step 4: Configure Azure Resources
    # =========================================================================
    Write-Header "Step 4: Configure Azure Resources"

    $resourceGroup = Read-Host "Enter resource group name (default: HubsResourceGroup)"
    if ([string]::IsNullOrWhiteSpace($resourceGroup)) { $resourceGroup = "HubsResourceGroup" }

    $azureRegion = Read-Host "Enter Azure region (default: westeurope)"
    if ([string]::IsNullOrWhiteSpace($azureRegion)) { $azureRegion = "westeurope" }

    $clusterName = Read-Host "Enter AKS cluster name (default: HubsCluster)"
    if ([string]::IsNullOrWhiteSpace($clusterName)) { $clusterName = "HubsCluster" }

    # Create resource group
    Write-Info "Creating resource group..."
    az group create --name $resourceGroup --location $azureRegion
    Write-Success "Resource group created"

    # =========================================================================
    # Step 5: Create Network Security Group
    # =========================================================================
    Write-Header "Step 5: Creating Network Security Group"

    Write-Info "Creating NSG..."
    az network nsg create --resource-group $resourceGroup --name HubsNSG

    Write-Info "Adding firewall rules..."
    az network nsg rule create --resource-group $resourceGroup --nsg-name HubsNSG `
        --name AllowStream --priority 1000 --direction Inbound --access Allow `
        --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 4443

    az network nsg rule create --resource-group $resourceGroup --nsg-name HubsNSG `
        --name AllowTurn --priority 1001 --direction Inbound --access Allow `
        --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 5349

    az network nsg rule create --resource-group $resourceGroup --nsg-name HubsNSG `
        --name AllowUDP --priority 1002 --direction Inbound --access Allow `
        --protocol Udp --source-address-prefixes '*' --destination-port-ranges 35000-60000

    Write-Success "Network security group configured"

    # =========================================================================
    # Step 6: Create AKS Cluster
    # =========================================================================
    Write-Header "Step 6: Creating AKS Cluster"

    Write-Warning2 "This step takes 5-10 minutes. Please wait..."
    az aks create `
        -g $resourceGroup `
        -n $clusterName `
        -l $azureRegion `
        -s Standard_F2s_v2 `
        --enable-node-public-ip `
        --node-count 2 `
        --network-plugin azure

    Write-Success "AKS cluster created"

    # Get credentials
    Write-Info "Getting cluster credentials..."
    az aks get-credentials --resource-group $resourceGroup --name $clusterName
    Write-Success "Cluster credentials configured"

    # =========================================================================
    # Step 7: Configure Domain
    # =========================================================================
    Write-Header "Step 7: Configure Domain"

    Write-Host "Enter the domain name you will use for Hubs."
    Write-Host "Example: hubs.yourdomain.com"
    Write-Host ""
    $HUB_DOMAIN = Read-Host "Enter your domain"

    if ([string]::IsNullOrWhiteSpace($HUB_DOMAIN)) {
        Write-Error2 "Domain is required for Azure deployment."
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Success "Domain set to: $HUB_DOMAIN"

    # =========================================================================
    # Step 8: Select deployment template (Azure)
    # =========================================================================
    Copy-Item "templates\hcce-chutvrc.yam" "hcce.yam" -Force
    Write-Success "Chutvrc template configured"
}

# =============================================================================
# Common Steps: SMTP Configuration
# =============================================================================
Write-Header "Configure Email Settings"

Write-Host "Hubs requires SMTP settings to send login emails."
Write-Host "You can use Gmail with an App Password."
Write-Host ""
Write-Host "To get a Gmail App Password:" -ForegroundColor Cyan
Write-Host "1. Go to Google Account > Security" -ForegroundColor Cyan
Write-Host "2. Enable 2-Step Verification" -ForegroundColor Cyan
Write-Host "3. Go to Security > 2-Step Verification > App passwords" -ForegroundColor Cyan
Write-Host "4. Create an app password for 'Mail'" -ForegroundColor Cyan
Write-Host ""

$userEmail = Read-Host "Enter your email address"
$smtpServer = Read-Host "Enter SMTP server (default: smtp.gmail.com)"
if ([string]::IsNullOrWhiteSpace($smtpServer)) { $smtpServer = "smtp.gmail.com" }
$smtpPort = Read-Host "Enter SMTP port (default: 587)"
if ([string]::IsNullOrWhiteSpace($smtpPort)) { $smtpPort = "587" }
$smtpUser = Read-Host "Enter SMTP username (your email)"
$smtpPass = Read-Host "Enter SMTP password (App Password)" -AsSecureString
$smtpPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpPass))

# Write secrets to overlay env file
Write-Info "Updating configuration..."

$secretsContent = @"
export ADM_EMAIL="$userEmail"
export DB_PASS="123456"
export SMTP_SERVER="$smtpServer"
export SMTP_PORT="$smtpPort"
export SMTP_USER="$smtpUser"
export SMTP_PASS="$smtpPassPlain"
export NODE_COOKIE="changeMe"
export GUARDIAN_KEY="changeMe"
export PHX_KEY="changeMe"
export SKETCHFAB_API_KEY="?"
export TENOR_API_KEY="?"
"@
Set-Content "overlays\secrets.env" -Value $secretsContent

# Update HUB_DOMAIN in the appropriate overlay env file
if ($DEPLOY_TARGET -eq "local") {
    $envContent = Get-Content "overlays\local.env" -Raw
    $envContent = $envContent -replace 'export HUB_DOMAIN=.*', "export HUB_DOMAIN=`"$HUB_DOMAIN`""
    Set-Content "overlays\local.env" -Value $envContent -NoNewline
} else {
    $envContent = Get-Content "overlays\production.env" -Raw
    $envContent = $envContent -replace 'export HUB_DOMAIN=.*', "export HUB_DOMAIN=`"$HUB_DOMAIN`""
    Set-Content "overlays\production.env" -Value $envContent -NoNewline
}

Write-Success "Configuration updated"

# =============================================================================
# Verify Kubernetes Context
# =============================================================================
Write-Header "Verifying Kubernetes Context"

$currentContext = kubectl config current-context 2>$null
Write-Info "Current Kubernetes context: $currentContext"

if ($DEPLOY_TARGET -eq "local") {
    if ($currentContext -ne "docker-desktop") {
        Write-Warning2 "Switching to docker-desktop context..."
        kubectl config use-context docker-desktop
        if ($LASTEXITCODE -ne 0) {
            Write-Error2 "Could not switch to docker-desktop context."
            Write-Error2 "Make sure Docker Desktop is running with Kubernetes enabled."
            Read-Host "Press Enter to exit"
            exit 1
        }
    }
}
Write-Success "Kubernetes context verified"

# =============================================================================
# Deploy
# =============================================================================
Write-Header "Deploying Hubs"

# Find Git Bash
$gitBashPath = "C:\Program Files\Git\bin\bash.exe"
if (-not (Test-Path $gitBashPath)) {
    $gitBashPath = "C:\Program Files (x86)\Git\bin\bash.exe"
}

if ($DEPLOY_TARGET -eq "local") {
    Write-Host "Ready to deploy Hubs locally."
    Write-Host ""
    Write-Host "The deployment will run in Git Bash." -ForegroundColor Yellow
    Read-Host "Press Enter to start deployment"

    if (Test-Path $gitBashPath) {
        $deployScript = @"
cd '$scriptDir'
chmod +x deploy_local.sh
./deploy_local.sh
echo ''
echo 'Deployment complete! Press Enter to close...'
read
"@
        $deployScript | & $gitBashPath
    } else {
        Write-Error2 "Git Bash not found. Please run the following commands manually in Git Bash:"
        Write-Host ""
        Write-Host "cd '$scriptDir'" -ForegroundColor Yellow
        Write-Host "chmod +x deploy_local.sh" -ForegroundColor Yellow
        Write-Host "./deploy_local.sh" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter after running the deployment"
    }
} else {
    Write-Host "Ready to deploy Hubs to Azure AKS."
    Read-Host "Press Enter to start deployment"

    if (Test-Path $gitBashPath) {
        $deployScript = @"
cd '$scriptDir'
chmod +x render_hcce.sh
bash render_hcce.sh production
kubectl apply -f hcce.yaml
echo ''
echo 'Deployment complete!'
echo ''
echo 'Next steps:'
echo '1. Run: kubectl get svc -n hcce'
echo '2. Wait for EXTERNAL-IP to appear for the lb service'
echo '3. Configure DNS A records for your domain'
echo '4. Run cbb.sh to set up SSL certificates'
echo ''
echo 'Press Enter to close...'
read
"@
        $deployScript | & $gitBashPath
    } else {
        Write-Error2 "Git Bash not found. Please run the following commands manually in Git Bash:"
        Write-Host ""
        Write-Host "cd '$scriptDir'" -ForegroundColor Yellow
        Write-Host "bash render_hcce.sh production" -ForegroundColor Yellow
        Write-Host "kubectl apply -f hcce.yaml" -ForegroundColor Yellow
        Write-Host ""
        Read-Host "Press Enter after running the deployment"
    }
}

# =============================================================================
# Done!
# =============================================================================
Write-Header "Setup Complete!"

if ($DEPLOY_TARGET -eq "local") {
    Write-Host "Hubs has been deployed locally!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "1. Close your browser completely"
    Write-Host "2. Open your browser and go to: https://hubs.local"
    Write-Host ""
    Write-Host "If you see an SSL warning, try:"
    Write-Host "- Closing and reopening your browser"
    Write-Host "- Clearing your browser cache"
} else {
    Write-Host "Hubs has been deployed to Azure AKS!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "1. Get the external IP: kubectl get svc -n hcce"
    Write-Host "2. Configure DNS A records for your domain"
    Write-Host "3. Run cbb.sh to set up SSL certificates"
    Write-Host "4. Access your Hubs at: https://$HUB_DOMAIN"
}

Write-Host ""
Write-Success "Enjoy using Hubs!"
Write-Host ""
Read-Host "Press Enter to exit"
