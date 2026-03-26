# Deploy Hubs (Chutvrc / CE) to Kubernetes: Mac Manual

## Choose Your Setup Method

| Option | Best For | Description                                 |
|--------|----------|---------------------------------------------|
| **[1. Quick Setup](#option-1-quick-setup-recommended-for-beginners)** | Beginners | Automated script handles most steps for you |
| **[2. Manual Setup](#option-2-manual-setup-instructions)** | Advanced users | Full control over each step                 |

---

## Option 1: Quick Setup (Recommended for Beginners)

### Before You Start: Install Docker Desktop

The setup script cannot install Docker Desktop for you. Please install it first:

1. Go to https://www.docker.com/products/docker-desktop/
2. Click "Download for Mac" (choose **Apple Chip** or **Intel** based on your Mac)
3. Open the downloaded `.dmg` file and drag Docker to Applications
4. Open Docker from your Applications folder
5. Wait for Docker to start (you'll see a whale icon in your menu bar)
6. Click the whale icon > **Settings** (gear icon) > **Kubernetes**
7. Check **"Enable Kubernetes"**
8. Click **"Apply & Restart"**
9. Wait for both Docker and Kubernetes to show green/running status

> **Note:** The first time you enable Kubernetes, it may take several minutes.

### Download the Code

**Option A: Download as ZIP (Easiest)**

1. Go to https://github.com/pf-hubs/chutvrc-hubs-cloud
2. Click the green **"Code"** button
3. Click **"Download ZIP"**
4. Open the downloaded ZIP file to extract it
5. You'll have a folder called `chutvrc-hubs-cloud` (or similar)

**Option B: Clone with Git (if you have Git installed)**

Open Terminal (`Cmd + Space`, type "Terminal", press Enter) and run:
```bash
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```

### Run the Quick Setup Script

1. Open Finder and navigate to the `community-edition` folder inside the downloaded folder
2. Double-click **`setup_mac.command`**
3. Follow the on-screen prompts

The script will automatically:
- Install required tools (Homebrew, kubectl, mkcert, Node.js)
- Configure your hosts file
- Set up SSL certificates
- Guide you through SMTP configuration
- Deploy Hubs locally

If you prefer to follow the manual steps, continue reading below.

---

## Option 2: Manual Setup Instructions

This guide covers deploying Mozilla Hubs (Community Edition or Chutvrc version) to either a **Local Mac Environment** (using Docker Desktop) or **Microsoft Azure AKS**.

> **New to the terminal?** Don't worry! This guide will walk you through every step. Commands you need to type are shown in gray boxes. Just copy and paste them into your terminal.

---

## Step 1: Prerequisites

### 1.1. Opening the Terminal

The Terminal is an application where you type commands to control your computer.

1. Press `Cmd + Space` to open Spotlight Search
2. Type `Terminal` and press `Enter`
3. A window with a command prompt will appear - this is where you'll type commands

> **Tip:** Keep this Terminal window open throughout the entire setup process.

### 1.2. Install Homebrew (Package Manager)

Homebrew is a tool that makes it easy to install software on Mac. Check if you already have it:

```bash
brew --version
```

If you see a version number, skip to the next section. If you see "command not found", install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions. You may need to enter your Mac password (characters won't show as you type - this is normal).

### 1.3. Install Required Tools

Copy and paste these commands one at a time:

```bash
brew install git
```
> This installs Git, which lets you download code from the internet.

```bash
brew install kubectl
```
> This installs kubectl, which controls Kubernetes clusters.

```bash
brew install mkcert
```
> This installs mkcert, which creates SSL certificates for secure connections.

```bash
brew install node
```
> This installs Node.js, needed to run some scripts.

```bash
npm install -g pem-jwk
```
> This installs a tool needed by the render script.

Now set up mkcert to trust its certificates:
```bash
mkcert -install
```
> You may be asked for your password. This is normal.

### 1.4. Install Docker Desktop

Docker Desktop runs the Hubs application in containers.

1. Go to https://www.docker.com/products/docker-desktop/
2. Click "Download for Mac" (choose Apple Chip or Intel based on your Mac)
3. Open the downloaded `.dmg` file and drag Docker to Applications
4. Open Docker from your Applications folder
5. Wait for Docker to start (you'll see a whale icon in your menu bar)
6. Click the whale icon > Settings (gear icon) > Kubernetes
7. Check "Enable Kubernetes"
8. Click "Apply & Restart"
9. Wait for both Docker and Kubernetes to show green/running status

> **Note:** The first time you enable Kubernetes, it may take several minutes to download and start.

### 1.5. Common Requirements

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

First, decide where you want to store the project. We'll use your home folder:

```bash
cd ~
```
> This command moves you to your home folder (e.g., `/Users/yourname`).

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

### For Local Deployment (on your Mac)

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

### 4.1. Open the Configuration File

Open `render_hcce.sh` in a text editor:

```bash
open -e render_hcce.sh
```
> This opens the file in TextEdit. You can also use any text editor you prefer.

### 4.2. Edit the Settings

Find and change these lines based on your deployment type:

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

Press `Cmd + S` to save, then close the editor.

---

## Step 5: Environment Setup

### Option A: Local Setup (on your Mac)

#### 5.1. Configure Hosts File

The hosts file tells your computer that `hubs.local` points to your own machine.

Open the hosts file:
```bash
sudo nano /etc/hosts
```
> `sudo` runs the command as administrator. You'll need to enter your Mac password.

Add these lines at the bottom of the file:
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

To save and exit:
1. Press `Ctrl + O` (that's the letter O, not zero)
2. Press `Enter` to confirm
3. Press `Ctrl + X` to exit

#### 5.2. Skip to Step 6 (Deployment)

### Option B: Azure AKS Setup

#### 5.1. Install Azure CLI

```bash
brew install azure-cli
```

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
- **For Local:** `docker-desktop`
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

1. **Quit your browser completely** (Cmd + Q) - this clears any cached SSL certificates
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

1. Open `cbb.sh` in a text editor and update your email and domain
2. Run:
   ```bash
   bash cbb.sh
   ```

---

## Step 7: Troubleshooting

### Common Problems

**"command not found" errors**
- Make sure you installed all the tools in Step 1
- Try closing and reopening Terminal

**Can't access https://hubs.local**
- Make sure Docker Desktop is running (whale icon in menu bar)
- Make sure Kubernetes is enabled and running (green status)
- Quit your browser completely and try again
- Check that you added the hosts file entries correctly

**503 Error**
- Wait a few minutes - services may still be starting
- Check pod status: `kubectl get pods -n hcce`
- All pods should show "Running" status

**Email links not working**
- Double-check your SMTP settings in `render_hcce.sh`
- For Gmail, make sure you're using an App Password, not your regular password

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
