# Deploy Hubs (Chutvrc / CE) to Kubernetes: Linux Manual

## Choose Your Setup Method

| Option | Best For | Description                                 |
|--------|----------|---------------------------------------------|
| **[1. Quick Setup](#option-1-quick-setup-recommended-for-beginners)** | Beginners | Automated script handles most steps for you |
| **[2. Manual Setup](#option-2-manual-setup-instructions)** | Advanced users | Full control over each step                 |

---

## Option 1: Quick Setup (Recommended for Beginners)

### Before You Start: Install Docker and Kubernetes

The setup script cannot install Docker for you. Please set up Docker and Kubernetes first.

**Option A: Docker Desktop for Linux (Easiest)**

1. Go to https://www.docker.com/products/docker-desktop/
2. Download the `.deb` (Ubuntu/Debian) or `.rpm` (Fedora) package
3. Install the package:
   - Ubuntu/Debian: `sudo apt install ./docker-desktop-<version>.deb`
   - Fedora: `sudo dnf install ./docker-desktop-<version>.rpm`
4. Open Docker Desktop from your applications menu
5. Go to **Settings** > **Kubernetes**
6. Check **"Enable Kubernetes"**
7. Click **"Apply & Restart"**
8. Wait for Kubernetes to show green/running status

**Option B: Docker Engine + minikube**

1. Install Docker Engine: https://docs.docker.com/engine/install/
2. Install minikube:
   ```bash
   curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
   sudo install minikube-linux-amd64 /usr/local/bin/minikube
   ```
3. Start minikube:
   ```bash
   minikube start
   ```

### Run the Quick Setup Script

Open a terminal and run these commands:

```bash
# Download the code (skip if you already have it)
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git

# Go to the community-edition folder
cd chutvrc-hubs-cloud/community-edition

# Run the setup script
chmod +x setup_linux.sh && ./setup_linux.sh
```

The script will automatically:
- Install required tools (kubectl, mkcert, Node.js) based on your distribution
- Configure your hosts file
- Set up SSL certificates
- Guide you through SMTP configuration
- Deploy Hubs locally

If you prefer to follow the manual steps, continue reading below.

---

## Option 2: Manual Setup Instructions

This guide covers deploying Mozilla Hubs (Community Edition or Chutvrc version) to either a **Local Linux Environment** (using Docker with Kubernetes) or **Microsoft Azure AKS**.

> **New to the terminal?** Don't worry! This guide will walk you through every step. Commands you need to type are shown in gray boxes. Just copy and paste them into your terminal.

---

## Step 1: Prerequisites

### 1.1. Opening the Terminal

The Terminal is where you type commands to control your computer.

**Ubuntu/Debian:**
- Press `Ctrl + Alt + T`
- Or click on Activities > search for "Terminal"

**Fedora:**
- Press `Ctrl + Alt + T`
- Or click on Activities > search for "Terminal"

**Arch Linux:**
- Press `Ctrl + Alt + T`
- Or open your terminal emulator from the application menu

> **Tip:** Keep this terminal window open throughout the entire setup process.

### 1.2. Install Required Tools

Choose the section that matches your Linux distribution.

#### Ubuntu/Debian

Update package list:
```bash
sudo apt update
```
> `sudo` runs commands as administrator. Enter your password when prompted (characters won't show - this is normal).

Install Git:
```bash
sudo apt install -y git
```
> Git lets you download code from the internet.

Install kubectl:
```bash
sudo apt install -y kubectl
```
> kubectl controls Kubernetes clusters.

Install dependencies for mkcert:
```bash
sudo apt install -y libnss3-tools
```

Download and install mkcert:
```bash
curl -JLO "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64"
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert
```
> mkcert creates SSL certificates for secure connections.

Set up mkcert:
```bash
mkcert -install
```

Install Node.js and npm:
```bash
sudo apt install -y nodejs npm
```

Install pem-jwk:
```bash
sudo npm install -g pem-jwk
```
> This is needed by the render script.

#### Fedora/RHEL

Update packages:
```bash
sudo dnf update -y
```

Install Git:
```bash
sudo dnf install -y git
```

Install kubectl:
```bash
sudo dnf install -y kubectl
```

Install dependencies for mkcert:
```bash
sudo dnf install -y nss-tools
```

Download and install mkcert:
```bash
curl -JLO "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64"
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert
```

Set up mkcert:
```bash
mkcert -install
```

Install Node.js and npm:
```bash
sudo dnf install -y nodejs npm
```

Install pem-jwk:
```bash
sudo npm install -g pem-jwk
```

#### Arch Linux

Update packages:
```bash
sudo pacman -Syu
```

Install required packages:
```bash
sudo pacman -S git kubectl mkcert nodejs npm nss
```

Set up mkcert:
```bash
mkcert -install
```

Install pem-jwk:
```bash
sudo npm install -g pem-jwk
```

### 1.3. Install Docker and Kubernetes

You have several options for running Kubernetes locally. Choose one:

#### Option A: Docker Desktop for Linux (Recommended for beginners)

1. Go to https://www.docker.com/products/docker-desktop/
2. Download Docker Desktop for Linux
3. Follow the installation instructions for your distribution
4. Start Docker Desktop
5. Go to Settings > Kubernetes
6. Check "Enable Kubernetes"
7. Click "Apply & Restart"
8. Wait for both Docker and Kubernetes to show green/running status

#### Option B: Minikube

Install Minikube:
```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

Start Minikube:
```bash
minikube start
```
> This creates a local Kubernetes cluster. It may take several minutes the first time.

#### Option C: Kind (Kubernetes in Docker)

Install Kind:
```bash
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

Create a cluster:
```bash
kind create cluster
```

### 1.4. Common Requirements

- **SMTP Server**: Required for sending login emails. You can use Gmail:
  1. Go to your Google Account > Security
  2. Enable "2-Step Verification"
  3. Go to Security > 2-Step Verification > App passwords
  4. Create an app password for "Mail"
  5. Save this 16-character password - you'll need it later

---

## Step 2: Clone the Repository

Now let's download the Hubs code to your computer.

### 2.1. Choose Where to Store the Project

We'll store the project in your home folder:

```bash
cd ~
```
> This moves you to your home folder (e.g., `/home/yourname`).

### 2.2. Download the Code

```bash
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```
> This downloads all the code. It may take a minute.

### 2.3. Navigate to the Project Folder

```bash
cd chutvrc-hubs-cloud/community-edition
```
> This moves you into the project folder where all the deployment files are.

To verify you're in the right place, type:
```bash
ls
```
> You should see files like `deploy_local.sh`, `render_hcce.sh`, `hcce.yam`, etc.

---

## Step 3: Select Your Deployment Template

We have different configuration files for different scenarios.

### For Local Deployment

**If deploying Chutvrc (Custom Version):**
```bash
cp hcce-chutvrc-local.yam hcce.yam
```

**If deploying Community Edition (Standard):**
```bash
cp hcce-ce-local.yam hcce.yam
```

### For Azure Cloud Deployment

**If deploying Chutvrc:**
```bash
cp hcce-chutvrc.yam hcce.yam
```

**If deploying Community Edition:**
```bash
cp hcce-ce.yam hcce.yam
```

> **What does `cp` do?** It copies a file. Here we're copying a template file and naming it `hcce.yam`, which is what the scripts expect.

---

## Step 4: Configure Settings

### 4.1. Fix the Base64 Command (Important for Linux)

The render script uses a Mac-specific command that needs to be changed for Linux.

Open the file:
```bash
nano render_hcce.sh
```

> **Don't have nano?** Install it with `sudo apt install nano` (Ubuntu/Debian) or `sudo dnf install nano` (Fedora) or `sudo pacman -S nano` (Arch).

Find these lines (use `Ctrl + W` to search):
```bash
export initCert=$(base64 -i cert.pem | tr -d '\n')
export initKey=$(base64 -i key.pem | tr -d '\n')
```

Change them to (remove the `-i` flag):
```bash
export initCert=$(base64 cert.pem | tr -d '\n')
export initKey=$(base64 key.pem | tr -d '\n')
```

> **Why?** Mac's `base64` command uses `-i` for input files, but Linux's version doesn't need it.

### 4.2. Edit the Settings

While still in the editor, find and change these settings:

#### For Local Deployment

Find these lines and update them:
```bash
export HUB_DOMAIN="hubs.local"
export ADM_EMAIL="your-email@example.com"
```
> Change `your-email@example.com` to your actual email.

Find the SMTP settings and update them (example for Gmail):
```bash
export SMTP_SERVER="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USER="your-gmail@gmail.com"
export SMTP_PASS="your-16-char-app-password"
```
> Replace with your Gmail address and the app password you created earlier.

#### For Azure Deployment

```bash
export HUB_DOMAIN="yourdomain.com"
export ADM_EMAIL="your-email@example.com"
```
> Change to your actual domain and email.

Also update:
- `SMTP_*` settings with your email provider details
- `DB_PASS` - change from the default for security

### 4.3. Save and Close

1. Press `Ctrl + O` (letter O, not zero) to save
2. Press `Enter` to confirm
3. Press `Ctrl + X` to exit

---

## Step 5: Environment Setup

### Option A: Local Setup

#### 5.1. Configure Hosts File

The hosts file tells your computer that `hubs.local` points to your own machine.

Open the hosts file:
```bash
sudo nano /etc/hosts
```
> Enter your password when prompted.

Add these lines at the bottom of the file:
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

Save and exit:
1. Press `Ctrl + O`
2. Press `Enter`
3. Press `Ctrl + X`

#### 5.2. Skip to Step 6 (Deployment)

### Option B: Azure AKS Setup

#### 5.1. Install Azure CLI

**Ubuntu/Debian:**
```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```

**Fedora/RHEL:**
```bash
sudo rpm --import https://packages.microsoft.com/keys/microsoft.asc
sudo dnf install -y https://packages.microsoft.com/config/rhel/9.0/packages-microsoft-prod.rpm
sudo dnf install -y azure-cli
```

**Arch Linux:**
```bash
yay -S azure-cli
```
> Or use another AUR helper if you don't have yay.

#### 5.2. Log in to Azure

```bash
az login
```
> A browser window will open. Log in with your Azure account.

#### 5.3. Create Resource Group

```bash
az group create --name HubsResourceGroup --location westeurope
```
> This creates a container for all your Azure resources. You can change `westeurope` to a region closer to you.

#### 5.4. Create Network Security Group

These commands open the ports needed for Hubs:

```bash
az network nsg create --resource-group HubsResourceGroup --name HubsNSG
```

```bash
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowStream --priority 1000 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 4443
```

```bash
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowTurn --priority 1001 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 5349
```

```bash
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowUDP --priority 1002 --direction Inbound --access Allow --protocol Udp --source-address-prefixes '*' --destination-port-ranges 35000-60000
```

#### 5.5. Create Kubernetes Cluster

```bash
az aks create -g HubsResourceGroup -s Standard_F2s_v2 -n HubsCluster -l westeurope --enable-node-public-ip --node-count 2 --network-plugin azure
```
> This creates the cluster. It takes 5-10 minutes. Wait for it to complete.

#### 5.6. Connect kubectl to Azure

```bash
az aks get-credentials --resource-group HubsResourceGroup --name HubsCluster
```
> This configures kubectl to talk to your Azure cluster.

---

## Step 5.5: Verify Kubernetes Context

Before deploying, make sure kubectl is pointing to the right cluster.

```bash
kubectl config current-context
```

You should see:
- **For Docker Desktop:** `docker-desktop`
- **For Minikube:** `minikube`
- **For Kind:** `kind-kind`
- **For Azure:** `HubsCluster`

If you need to switch:
```bash
kubectl config get-contexts
```
> This lists all available clusters.

```bash
kubectl config use-context docker-desktop
```
> Change `docker-desktop` to the name of the cluster you want to use.

---

## Step 6: Deploy

### 6.1. Deploying to Local

Make sure you're in the right folder:
```bash
cd ~/chutvrc-hubs-cloud/community-edition
```

Run the deployment script:
```bash
chmod +x deploy_local.sh
./deploy_local.sh
```
> The first command makes the script executable. The second runs it.

Wait for the deployment to complete. You'll see messages about creating certificates and deploying services.

#### After Deployment

1. **Close your browser completely** (or restart it)
2. Open your browser and go to: **https://hubs.local**
3. You should see the Hubs homepage!

> **Note:** The first time may take a minute as all services start up.

### 6.2. Deploying to Azure

Make sure you're in the right folder:
```bash
cd ~/chutvrc-hubs-cloud/community-edition
```

Run the deployment:
```bash
bash render_hcce.sh && kubectl apply -f hcce.yaml
```

Wait for services to start:
```bash
kubectl get svc -n hcce
```
> Run this command every 30 seconds until you see an IP address under `EXTERNAL-IP` for the `lb` service.

#### Configure Your Domain

1. Copy the `EXTERNAL-IP` address
2. Go to your domain registrar (where you bought your domain)
3. Create these DNS A records pointing to that IP:
   - `@` (or leave blank for root domain)
   - `assets`
   - `cors`
   - `stream`

#### Set Up SSL Certificates

1. Open `cbb.sh` in a text editor:
   ```bash
   nano cbb.sh
   ```
2. Update your email and domain
3. Save and exit (`Ctrl + O`, `Enter`, `Ctrl + X`)
4. Run:
   ```bash
   bash cbb.sh
   ```

---

## Step 7: Troubleshooting

### Common Problems

**"command not found" errors**
- Make sure you installed all the tools in Step 1
- Try closing and reopening the terminal
- Check if the command is in your PATH: `which <command>`

**Can't access https://hubs.local**
- Make sure Docker/Kubernetes is running
- For Docker Desktop: check the status in the application
- For Minikube: run `minikube status`
- Close your browser completely and try again
- Check that you added the hosts file entries correctly

**503 Error**
- Wait a few minutes - services may still be starting
- Check pod status: `kubectl get pods -n hcce`
- All pods should show "Running" status

**Email links not working**
- Double-check your SMTP settings in `render_hcce.sh`
- For Gmail, make sure you're using an App Password, not your regular password

**"base64: invalid option -- 'i'" error**
- You forgot to fix the base64 command in Step 4.1
- Edit `render_hcce.sh` and remove `-i` from the base64 commands

**Permission denied when running scripts**
- Make sure you made the script executable: `chmod +x script_name.sh`

### Useful Commands

Check what's running:
```bash
kubectl get pods -n hcce
```

See logs for a specific service:
```bash
kubectl logs -n hcce deployment/reticulum
```

Restart the deployment:
```bash
./deploy_local.sh
```

Check Minikube status (if using Minikube):
```bash
minikube status
```

Start Minikube (if stopped):
```bash
minikube start
```

---

## Step 8: Cost Management (Azure Only)

### Pause Cluster (Save Money)

When you're not using Hubs:
```bash
kubectl scale --replicas=0 deployment --all -n hcce
```

### Resume Cluster

When you want to use it again:
```bash
kubectl scale --replicas=1 deployment --all -n hcce
```

### Expected Costs

A Standard_F2s_v2 cluster running 24/7 costs approximately $80-100/month. Pausing when not in use can significantly reduce costs.
