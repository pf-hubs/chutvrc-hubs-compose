# Hubs (Chutvrc / CE) を Kubernetes にデプロイ: Linux マニュアル

## セットアップ方法を選択

| オプション | 対象者 | 説明                          |
|--------|----------|-----------------------------|
| **[1. クイックセットアップ](#オプション-1-クイックセットアップ初心者におすすめ)** | 初心者 | 自動スクリプトがほとんどの手順を処理          |
| **[2. 手動セットアップ](#オプション-2-手動セットアップ)** | 上級者 | 各ステップを完全にコントロール             |

---

## オプション 1: クイックセットアップ（初心者におすすめ）

### 始める前に：Docker と Kubernetes のインストール

セットアップスクリプトでは Docker をインストールできません。先に Docker と Kubernetes をセットアップしてください。

**オプション A: Docker Desktop for Linux（最も簡単）**

1. https://www.docker.com/products/docker-desktop/ にアクセス
2. `.deb`（Ubuntu/Debian）または `.rpm`（Fedora）パッケージをダウンロード
3. パッケージをインストール：
   - Ubuntu/Debian: `sudo apt install ./docker-desktop-<version>.deb`
   - Fedora: `sudo dnf install ./docker-desktop-<version>.rpm`
4. アプリケーションメニューから Docker Desktop を開く
5. **Settings** > **Kubernetes** に移動
6. **「Enable Kubernetes」**にチェック
7. **「Apply & Restart」**をクリック
8. Kubernetes が緑色/実行中のステータスになるまで待つ

**オプション B: Docker Engine + minikube**

1. Docker Engine をインストール: https://docs.docker.com/engine/install/
2. minikube をインストール：
   ```bash
   curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
   sudo install minikube-linux-amd64 /usr/local/bin/minikube
   ```
3. minikube を起動：
   ```bash
   minikube start
   ```

### クイックセットアップスクリプトを実行

ターミナルを開いて以下のコマンドを実行：

```bash
# コードをダウンロード（すでにある場合はスキップ）
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git

# community-edition フォルダに移動
cd chutvrc-hubs-cloud/community-edition

# セットアップスクリプトを実行
chmod +x setup_linux.sh && ./setup_linux.sh
```

スクリプトが自動的に行うこと：
- ディストリビューションに応じた必要なツールのインストール（kubectl、mkcert、Node.js）
- hosts ファイルの設定
- SSL 証明書のセットアップ
- SMTP 設定のガイド
- Hubs のローカルデプロイ

手動で設定する場合は、以下の手順に従ってください。

---

## オプション 2: 手動セットアップ

このガイドでは、Mozilla Hubs（Community Edition または Chutvrc バージョン）を **ローカル Linux 環境**（Kubernetes 対応 Docker 使用）または **Microsoft Azure AKS** にデプロイする方法を説明します。

> **ターミナル初心者の方へ:** ご安心ください！このガイドでは、すべての手順を詳しく説明します。入力するコマンドはグレーのボックスに表示されます。コピーしてターミナルに貼り付けるだけです。

---

## ステップ 1: 前提条件

### 1.1. ターミナルを開く

ターミナルは、コマンドを入力してコンピュータを操作する場所です。

**Ubuntu/Debian:**
- `Ctrl + Alt + T` を押す
- または アクティビティ をクリック >「ターミナル」と検索

**Fedora:**
- `Ctrl + Alt + T` を押す
- または アクティビティ をクリック >「ターミナル」と検索

**Arch Linux:**
- `Ctrl + Alt + T` を押す
- または アプリケーションメニューからターミナルエミュレータを開く

> **ヒント:** セットアップ中はこのターミナルウィンドウを開いたままにしてください。

### 1.2. 必要なツールのインストール

お使いの Linux ディストリビューションに合ったセクションを選んでください。

#### Ubuntu/Debian

パッケージリストを更新：
```bash
sudo apt update
```
> `sudo` は管理者としてコマンドを実行します。プロンプトが表示されたらパスワードを入力してください（文字が表示されません - これは正常です）。

Git をインストール：
```bash
sudo apt install -y git
```
> Git をインストールします。インターネットからコードをダウンロードするためのツールです。

kubectl をインストール：
```bash
sudo apt install -y kubectl
```
> Kubernetes クラスターを制御する kubectl をインストールします。

mkcert の依存関係をインストール：
```bash
sudo apt install -y libnss3-tools
```

mkcert をダウンロードしてインストール：
```bash
curl -JLO "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64"
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert
```
> 安全な接続用の SSL 証明書を作成する mkcert をインストールします。

mkcert をセットアップ：
```bash
mkcert -install
```

Node.js と npm をインストール：
```bash
sudo apt install -y nodejs npm
```

pem-jwk をインストール：
```bash
sudo npm install -g pem-jwk
```
> render スクリプトに必要です。

#### Fedora/RHEL

パッケージを更新：
```bash
sudo dnf update -y
```

Git をインストール：
```bash
sudo dnf install -y git
```

kubectl をインストール：
```bash
sudo dnf install -y kubectl
```

mkcert の依存関係をインストール：
```bash
sudo dnf install -y nss-tools
```

mkcert をダウンロードしてインストール：
```bash
curl -JLO "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-linux-amd64"
sudo mv mkcert-v1.4.4-linux-amd64 /usr/local/bin/mkcert
sudo chmod +x /usr/local/bin/mkcert
```

mkcert をセットアップ：
```bash
mkcert -install
```

Node.js と npm をインストール：
```bash
sudo dnf install -y nodejs npm
```

pem-jwk をインストール：
```bash
sudo npm install -g pem-jwk
```

#### Arch Linux

パッケージを更新：
```bash
sudo pacman -Syu
```

必要なパッケージをインストール：
```bash
sudo pacman -S git kubectl mkcert nodejs npm nss
```

mkcert をセットアップ：
```bash
mkcert -install
```

pem-jwk をインストール：
```bash
sudo npm install -g pem-jwk
```

### 1.3. Docker と Kubernetes のインストール

ローカルで Kubernetes を実行するにはいくつかのオプションがあります。1つ選んでください：

#### オプション A: Docker Desktop for Linux（初心者にお勧め）

1. https://www.docker.com/products/docker-desktop/ にアクセス
2. Docker Desktop for Linux をダウンロード
3. お使いのディストリビューション用のインストール手順に従う
4. Docker Desktop を起動
5. Settings > Kubernetes に移動
6. 「Enable Kubernetes」にチェック
7. 「Apply & Restart」をクリック
8. Docker と Kubernetes の両方が緑色/実行中のステータスになるまで待つ

#### オプション B: Minikube

Minikube をインストール：
```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube-linux-amd64
sudo install minikube-linux-amd64 /usr/local/bin/minikube
```

Minikube を起動：
```bash
minikube start
```
> ローカル Kubernetes クラスターを作成します。初回は数分かかる場合があります。

#### オプション C: Kind（Kubernetes in Docker）

Kind をインストール：
```bash
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

クラスターを作成：
```bash
kind create cluster
```

### 1.4. 共通要件

- **SMTP サーバー**: ログインメールの送信に必要です。Gmail を使用できます：
  1. Google アカウント > セキュリティ にアクセス
  2. 「2段階認証プロセス」を有効化
  3. セキュリティ > 2段階認証プロセス > アプリパスワード にアクセス
  4. 「メール」用のアプリパスワードを作成
  5. この16文字のパスワードを保存 - 後で必要になります

---

## ステップ 2: リポジトリのクローン

Hubs のコードをコンピュータにダウンロードしましょう。

### 2.1. プロジェクトの保存場所を選択

プロジェクトをホームフォルダに保存します：

```bash
cd ~
```
> このコマンドでホームフォルダ（例：`/home/yourname`）に移動します。

### 2.2. コードをダウンロード

```bash
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```
> すべてのコードをダウンロードします。1分ほどかかる場合があります。

### 2.3. プロジェクトフォルダに移動

```bash
cd chutvrc-hubs-cloud/community-edition
```
> デプロイファイルがあるプロジェクトフォルダに移動します。

正しい場所にいるか確認するには：
```bash
ls
```
> `deploy_local.sh`、`render_hcce.sh`、`hcce.yam` などのファイルが表示されるはずです。

---

## ステップ 3: デプロイテンプレートの選択

異なるシナリオ用の設定ファイルがあります。

### ローカルデプロイメントの場合

**Chutvrc（カスタムバージョン）をデプロイする場合：**
```bash
cp hcce-chutvrc-local.yam hcce.yam
```

**Community Edition（標準版）をデプロイする場合：**
```bash
cp hcce-ce-local.yam hcce.yam
```

### Azure クラウドデプロイメントの場合

**Chutvrc をデプロイする場合：**
```bash
cp hcce-chutvrc.yam hcce.yam
```

**Community Edition をデプロイする場合：**
```bash
cp hcce-ce.yam hcce.yam
```

> **`cp` とは？** ファイルをコピーするコマンドです。ここではテンプレートファイルをコピーして `hcce.yam` という名前にしています。これはスクリプトが期待するファイル名です。

---

## ステップ 4: 設定の構成

### 4.1. base64 コマンドの修正（Linux では重要）

render スクリプトは Mac 固有のコマンドを使用しているため、Linux 用に変更が必要です。

ファイルを開く：
```bash
nano render_hcce.sh
```

> **nano がない場合** `sudo apt install nano`（Ubuntu/Debian）、`sudo dnf install nano`（Fedora）、または `sudo pacman -S nano`（Arch）でインストールしてください。

以下の行を見つけます（`Ctrl + W` で検索）：
```bash
export initCert=$(base64 -i cert.pem | tr -d '\n')
export initKey=$(base64 -i key.pem | tr -d '\n')
```

以下のように変更（`-i` フラグを削除）：
```bash
export initCert=$(base64 cert.pem | tr -d '\n')
export initKey=$(base64 key.pem | tr -d '\n')
```

> **なぜ？** Mac の `base64` コマンドは入力ファイルに `-i` を使用しますが、Linux 版では必要ありません。

### 4.2. 設定を編集

エディタを開いたまま、以下の設定を見つけて変更してください：

#### ローカルデプロイメントの場合

以下の行を見つけて更新：
```bash
export HUB_DOMAIN="hubs.local"
export ADM_EMAIL="your-email@example.com"
```
> `your-email@example.com` を実際のメールアドレスに変更してください。

SMTP 設定を見つけて更新（Gmail の例）：
```bash
export SMTP_SERVER="smtp.gmail.com"
export SMTP_PORT="587"
export SMTP_USER="your-gmail@gmail.com"
export SMTP_PASS="your-16-char-app-password"
```
> Gmail アドレスと先ほど作成したアプリパスワードに置き換えてください。

#### Azure デプロイメントの場合

```bash
export HUB_DOMAIN="yourdomain.com"
export ADM_EMAIL="your-email@example.com"
```
> 実際のドメインとメールアドレスに変更してください。

以下も更新してください：
- `SMTP_*` 設定をメールプロバイダーの詳細に
- `DB_PASS` - セキュリティのためデフォルトから変更

### 4.3. 保存して閉じる

1. `Ctrl + O`（O はゼロではなく文字の O）を押して保存
2. `Enter` を押して確認
3. `Ctrl + X` を押して終了

---

## ステップ 5: 環境セットアップ

### オプション A: ローカルセットアップ

#### 5.1. hosts ファイルの設定

hosts ファイルは、`hubs.local` が自分のマシンを指すようにコンピュータに伝えます。

hosts ファイルを開く：
```bash
sudo nano /etc/hosts
```
> プロンプトが表示されたらパスワードを入力してください。

ファイルの最後に以下の行を追加：
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

保存して終了：
1. `Ctrl + O` を押す
2. `Enter` を押す
3. `Ctrl + X` を押す

#### 5.2. ステップ 6（デプロイ）に進む

### オプション B: Azure AKS セットアップ

#### 5.1. Azure CLI のインストール

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
> yay がない場合は他の AUR ヘルパーを使用してください。

#### 5.2. Azure にログイン

```bash
az login
```
> ブラウザウィンドウが開きます。Azure アカウントでログインしてください。

#### 5.3. リソースグループの作成

```bash
az group create --name HubsResourceGroup --location westeurope
```
> Azure リソースのコンテナを作成します。`westeurope` をお近くのリージョンに変更できます。

#### 5.4. ネットワークセキュリティグループの作成

Hubs に必要なポートを開くコマンド：

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

#### 5.5. Kubernetes クラスターの作成

```bash
az aks create -g HubsResourceGroup -s Standard_F2s_v2 -n HubsCluster -l westeurope --enable-node-public-ip --node-count 2 --network-plugin azure
```
> クラスターを作成します。5〜10分かかります。完了するまでお待ちください。

#### 5.6. kubectl を Azure に接続

```bash
az aks get-credentials --resource-group HubsResourceGroup --name HubsCluster
```
> kubectl が Azure クラスターと通信できるように設定します。

---

## ステップ 5.5: Kubernetes コンテキストの確認

デプロイ前に、kubectl が正しいクラスターを指しているか確認してください。

```bash
kubectl config current-context
```

表示されるべき内容：
- **Docker Desktop の場合:** `docker-desktop`
- **Minikube の場合:** `minikube`
- **Kind の場合:** `kind-kind`
- **Azure の場合:** `HubsCluster`

切り替えが必要な場合：
```bash
kubectl config get-contexts
```
> 利用可能なすべてのクラスターをリストします。

```bash
kubectl config use-context docker-desktop
```
> `docker-desktop` を使用したいクラスター名に変更してください。

---

## ステップ 6: デプロイ

### 6.1. ローカルへのデプロイ

正しいフォルダにいることを確認：
```bash
cd ~/chutvrc-hubs-cloud/community-edition
```

デプロイスクリプトを実行：
```bash
chmod +x deploy_local.sh
./deploy_local.sh
```
> 最初のコマンドはスクリプトを実行可能にします。2番目のコマンドで実行します。

デプロイが完了するまで待ちます。証明書の作成やサービスのデプロイに関するメッセージが表示されます。

#### デプロイ後

1. **ブラウザを完全に閉じる**（または再起動する）
2. ブラウザを開いて **https://hubs.local** にアクセス
3. Hubs のホームページが表示されるはずです！

> **注意:** 初回はすべてのサービスが起動するまで1分ほどかかる場合があります。

### 6.2. Azure へのデプロイ

正しいフォルダにいることを確認：
```bash
cd ~/chutvrc-hubs-cloud/community-edition
```

デプロイを実行：
```bash
bash render_hcce.sh && kubectl apply -f hcce.yaml
```

サービスの起動を待つ：
```bash
kubectl get svc -n hcce
```
> `lb` サービスの `EXTERNAL-IP` に IP アドレスが表示されるまで、30秒ごとにこのコマンドを実行してください。

#### ドメインの設定

1. `EXTERNAL-IP` アドレスをコピー
2. ドメインレジストラ（ドメインを購入した場所）にアクセス
3. その IP を指す以下の DNS A レコードを作成：
   - `@`（またはルートドメインの場合は空白）
   - `assets`
   - `cors`
   - `stream`

#### SSL 証明書のセットアップ

1. `cbb.sh` をテキストエディタで開く：
   ```bash
   nano cbb.sh
   ```
2. メールアドレスとドメインを更新
3. 保存して終了（`Ctrl + O`、`Enter`、`Ctrl + X`）
4. 実行：
   ```bash
   bash cbb.sh
   ```

---

## ステップ 7: トラブルシューティング

### よくある問題

**「command not found」エラー**
- ステップ 1 ですべてのツールをインストールしたか確認
- ターミナルを閉じて再度開いてみる
- コマンドが PATH にあるか確認：`which <command>`

**https://hubs.local にアクセスできない**
- Docker/Kubernetes が実行中か確認
- Docker Desktop の場合：アプリケーションでステータスを確認
- Minikube の場合：`minikube status` を実行
- ブラウザを完全に閉じて再度試す
- hosts ファイルのエントリが正しく追加されているか確認

**503 エラー**
- 数分待つ - サービスがまだ起動中の可能性があります
- Pod のステータスを確認：`kubectl get pods -n hcce`
- すべての Pod が「Running」ステータスを表示するはずです

**メールリンクが機能しない**
- `render_hcce.sh` の SMTP 設定を再確認
- Gmail の場合、通常のパスワードではなくアプリパスワードを使用しているか確認

**「base64: invalid option -- 'i'」エラー**
- ステップ 4.1 で base64 コマンドの修正を忘れています
- `render_hcce.sh` を編集して base64 コマンドから `-i` を削除してください

**スクリプト実行時に Permission denied**
- スクリプトを実行可能にしたか確認：`chmod +x script_name.sh`

### 便利なコマンド

実行中のものを確認：
```bash
kubectl get pods -n hcce
```

特定のサービスのログを見る：
```bash
kubectl logs -n hcce deployment/reticulum
```

デプロイを再実行：
```bash
./deploy_local.sh
```

Minikube のステータスを確認（Minikube 使用時）：
```bash
minikube status
```

Minikube を起動（停止している場合）：
```bash
minikube start
```

---

## ステップ 8: コスト管理（Azure のみ）

### クラスターを一時停止（節約）

Hubs を使用していないとき：
```bash
kubectl scale --replicas=0 deployment --all -n hcce
```

### クラスターを再開

再び使用したいとき：
```bash
kubectl scale --replicas=1 deployment --all -n hcce
```

### 予想コスト

Standard_F2s_v2 クラスターを24時間365日稼働させると、月額約80〜100ドルかかります。使用していないときに一時停止すると、コストを大幅に削減できます。
