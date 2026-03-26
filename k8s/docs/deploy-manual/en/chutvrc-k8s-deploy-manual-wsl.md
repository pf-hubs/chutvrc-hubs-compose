# Deploy Hubs (Chutvrc / CE) to Kubernetes: WSL Manual

## Choose Your Setup Method

| Option | Best For | Description                                 |
|--------|----------|---------------------------------------------|
| **[1. Quick Setup (WSL)](#quick-setup-recommended-for-beginners)** | Beginners | Automated script handles most steps for you |
| **[2. Windows Setup (No WSL)](#alternative-windows-setup-without-wsl)** | Beginners | Uses native Windows tools, no WSL needed    |
| **[3. Manual Setup](#manual-setup-instructions)** | Advanced users | Full control over each step                 |

---

## Option 1: Quick Setup (Recommended for Beginners)

This section helps you get Hubs running locally with minimal effort. Just complete the prerequisites below, then run our setup script!

### Before You Start: Prerequisites

You need to install these two things first. The setup script cannot install them for you.

#### 1. Install WSL2 and Ubuntu

WSL lets you run Linux inside Windows. Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

After installation completes, **restart your computer**. Then open Ubuntu from the Start menu and create a username and password when prompted.

> **Need more details?** See [Step 1.1](#11-install-wsl2) below for detailed instructions.

#### 2. Install Docker Desktop with Kubernetes

1. Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
2. During installation, make sure **"Use WSL 2 instead of Hyper-V"** is checked
3. After installation, open Docker Desktop and go to:
   - **Settings > Resources > WSL Integration** → Enable for Ubuntu
   - **Settings > Kubernetes** → Check "Enable Kubernetes"
4. Click "Apply & Restart" and wait for Kubernetes to show green status

> **Need more details?** See [Step 1.2](#12-install-docker-desktop) and [Step 1.3](#13-enable-docker-wsl-integration) below.

#### 3. Prepare SMTP Credentials (for login emails)

Hubs sends magic link emails for login. You'll need SMTP credentials ready. For Gmail:
1. Enable 2-Step Verification in your Google Account
2. Create an App Password at: Google Account > Security > App passwords
3. Save the 16-character password - you'll enter it during setup

### Run the Quick Setup Script

Once prerequisites are ready, open **Ubuntu** terminal and run these commands:

```bash
# Download the code (skip if you already have it)
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git

# Go to the community-edition folder
cd chutvrc-hubs-cloud/community-edition

# Run the setup script
chmod +x setup_wsl.sh && ./setup_wsl.sh
```

The script will guide you through:
- Installing required tools (kubectl, mkcert, Node.js, etc.)
- Setting up SSL certificates
- **Importing CA certificate to Windows** (follow the on-screen instructions carefully!)
- Configuring the Windows hosts file
- Entering your SMTP settings
- Deploying Hubs

### After Setup Completes

1. **Close your browser completely** (all windows)
2. Open your browser and go to: **https://hubs.local**
3. You should see the Hubs homepage!

> **SSL Warning?** Make sure you followed the CA certificate import step during setup. You may need to restart your browser.

---

## Option 2: Windows Setup (Without WSL)

If you prefer not to use WSL at all, you can use our Windows setup script instead:

1. Navigate to the `community-edition` folder in File Explorer
2. Double-click **`setup_windows.bat`**
3. Follow the on-screen prompts

---

## Option 3: Manual Setup Instructions

The rest of this guide provides detailed manual instructions if you prefer to understand and control each step, or if you encounter issues with the quick setup.

> **New to the terminal?** Don't worry! Commands you need to type are shown in gray boxes. Just copy and paste them.

> **Why WSL?** WSL (Windows Subsystem for Linux) lets you run Linux on Windows. The deployment scripts are written for Linux/bash, so they work perfectly in WSL without any modifications.

---

## Step 1: Prerequisites

### 1.1. Install WSL2

WSL lets you run Linux inside Windows.

#### Step 1: Open PowerShell as Administrator

1. Press `Win + X` (Windows key + X)
2. Click "Windows Terminal (Admin)" or "PowerShell (Admin)"
3. If prompted "Do you want to allow this app to make changes?", click "Yes"

#### Step 2: Install WSL

```powershell
wsl --install
```
> This installs WSL2 with Ubuntu by default. It may take several minutes.

#### Step 3: Restart Your Computer

After the installation completes, restart your computer.

#### Step 4: Set Up Ubuntu

1. After restart, a window titled "Ubuntu" should open automatically
2. If not, press `Win` key and type "Ubuntu", then click to open it
3. Wait for Ubuntu to finish installing (this takes a few minutes)
4. When prompted, create a username (lowercase, no spaces)
5. Create a password (characters won't show as you type - this is normal)
6. Remember this password - you'll need it for `sudo` commands

> **Tip:** Keep this Ubuntu window open throughout the setup process.

### 1.2. Install Docker Desktop

Docker Desktop runs the Hubs application in containers.

1. Go to https://www.docker.com/products/docker-desktop/
2. Click "Download for Windows"
3. Run the downloaded installer
4. Follow the installation wizard (keep default options)
5. **Important:** Make sure "Use WSL 2 instead of Hyper-V" is checked
6. Restart your computer when prompted

### 1.3. Enable Docker WSL Integration

After Docker Desktop starts:

1. Right-click the whale icon in the system tray (bottom-right of screen)
2. Click "Settings"
3. Go to "Resources" > "WSL Integration"
4. Toggle ON for "Ubuntu" (or your WSL distro)
5. Click "Apply & Restart"
6. Go to "Kubernetes" in the left menu
7. Check "Enable Kubernetes"
8. Click "Apply & Restart"
9. Wait for both Docker and Kubernetes to show green/running status (bottom-left)

> **Note:** The first time you enable Kubernetes, it may take several minutes.

### 1.4. Install Tools in Ubuntu

Open Ubuntu (press `Win` key, type "Ubuntu", click to open).

Update the package list:
```bash
sudo apt update
```
> `sudo` runs the command as administrator. Enter your Ubuntu password when prompted.

Install kubectl:
```bash
sudo apt install -y kubectl
```
> This installs kubectl, which controls Kubernetes clusters.

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
> This installs mkcert, which creates SSL certificates.

Set up mkcert:
```bash
mkcert -install
```

Install Node.js and npm:
```bash
sudo apt install -y nodejs npm
```

Install pem-jwk (needed by the render script):
```bash
sudo npm install -g pem-jwk
```

### 1.5. Import CA Certificate to Windows (Important!)

Since your browser runs on Windows, you need to tell Windows to trust the certificates created in WSL.

#### Step 1: Find the CA Location

In Ubuntu, run:
```bash
mkcert -CAROOT
```
> This shows a path like `/home/yourname/.local/share/mkcert`

#### Step 2: Open the Folder in Windows Explorer

```bash
cd $(mkcert -CAROOT) && explorer.exe .
```
> This opens the folder in Windows Explorer.

#### Step 3: Copy the File Path

1. In the Explorer window that opened, you'll see a file called `rootCA.pem`
2. Click in the address bar at the top
3. Copy the full path (it looks like `\\wsl.localhost\Ubuntu\home\yourname\.local\share\mkcert\rootCA.pem`)

#### Step 4: Import the Certificate to Windows

1. Press `Win + R` to open the Run dialog
2. Type `certmgr.msc` and press Enter
3. In the left panel, expand "Trusted Root Certification Authorities"
4. Click on "Certificates"
5. Right-click in the right panel > "All Tasks" > "Import..."
6. Click "Next"
7. Click "Browse...", then paste the path you copied in the filename field
8. Click "Open", then "Next"
9. Make sure "Place all certificates in the following store" is selected
10. The store should say "Trusted Root Certification Authorities"
11. Click "Next", then "Finish"
12. Click "Yes" if asked to confirm, then "OK"

### 1.6. Common Requirements

- **SMTP Server**: Required for sending login emails. You can use Gmail:
  1. Go to your Google Account > Security
  2. Enable "2-Step Verification"
  3. Go to Security > 2-Step Verification > App passwords
  4. Create an app password for "Mail"
  5. Save this 16-character password - you'll need it later

---

## Step 2: Clone the Repository

Now let's download the Hubs code to your computer.

### 2.1. Open Ubuntu Terminal

Press `Win` key, type "Ubuntu", and click to open it.

### 2.2. Choose Where to Store the Project

We'll store the project in your home folder:

```bash
cd ~
```
> This moves you to your home folder (e.g., `/home/yourname`).

### 2.3. Download the Code

```bash
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```
> This downloads all the code. It may take a minute.

### 2.4. Navigate to the Project Folder

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

### 4.1. Fix the Base64 Command (Important for WSL/Linux)

The render script uses a Mac-specific command that needs to be changed for Linux.

Open the file:
```bash
nano render_hcce.sh
```

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

**Important:** Edit the **Windows** hosts file (not the one in WSL), because your browser runs on Windows.

From Ubuntu, run this command to open the Windows hosts file:
```bash
powershell.exe -Command "Start-Process notepad 'C:\Windows\System32\drivers\etc\hosts' -Verb RunAs"
```
> This opens Notepad as Administrator. Click "Yes" if prompted.

Add these lines at the bottom of the file:
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

Save the file (Ctrl + S) and close Notepad.

#### 5.2. Skip to Step 6 (Deployment)

### Option B: Azure AKS Setup

#### 5.1. Install Azure CLI

```bash
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash
```
> This downloads and installs the Azure CLI. It may take a minute.

#### 5.2. Log in to Azure

```bash
az login
```
> This will show a message with a URL and a code.
> 1. Open a browser and go to the URL shown
> 2. Enter the code shown in your terminal
> 3. Log in with your Azure account

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

1. **Close your browser completely** (right-click browser icon in Windows taskbar > Close all windows)
2. Open your browser and go to: **https://hubs.local**
3. You should see the Hubs homepage!

> **Note:** The first time may take a minute as all services start up.

> **SSL Warning?** If you see an SSL warning, make sure you completed Step 1.5 (importing the CA certificate to Windows).

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
- Try closing and reopening the Ubuntu terminal

**Can't access https://hubs.local**
- Make sure Docker Desktop is running (whale icon in Windows system tray)
- Make sure Kubernetes is enabled and running (green status in Docker Desktop)
- Make sure WSL integration is enabled for Ubuntu in Docker Desktop settings
- Close all browser windows and try again
- Check that you added the hosts file entries to the **Windows** hosts file

**SSL Certificate Not Trusted (browser warning)**
- Make sure you completed Step 1.5 (importing the CA certificate to Windows)
- Try closing and reopening your browser completely

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
