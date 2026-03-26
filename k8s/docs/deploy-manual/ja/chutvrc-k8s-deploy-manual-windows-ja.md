# Hubs (Chutvrc / CE) を Kubernetes にデプロイ: Windows マニュアル

## セットアップ方法を選択

| オプション | 対象者 | 説明                          |
|--------|----------|-----------------------------|
| **[1. クイックセットアップ](#オプション-1-クイックセットアップ初心者におすすめ)** | 初心者 | 自動スクリプトがほとんどの手順を処理          |
| **[2. 手動セットアップ](#オプション-2-手動セットアップ)** | 上級者 | 各ステップを完全にコントロール             |

---

## オプション 1: クイックセットアップ（初心者におすすめ）

### 始める前に：Docker Desktop のインストール

セットアップスクリプトでは Docker Desktop をインストールできません。先にインストールしてください：

1. https://www.docker.com/products/docker-desktop/ にアクセス
2. 「Download for Windows」をクリック
3. ダウンロードしたインストーラーを実行
4. インストールウィザードに従う（デフォルトオプションのまま）
5. 求められたらコンピュータを再起動
6. 再起動後、Docker Desktop が自動的に起動します（システムトレイにクジラのアイコン）
7. クジラアイコンを右クリック > **Settings** > **Kubernetes**
8. **「Enable Kubernetes」**にチェック
9. **「Apply & Restart」**をクリック
10. Docker と Kubernetes の両方が緑色/実行中のステータスになるまで待つ（Docker Desktop の左下）

> **注意:** 初めて Kubernetes を有効にする場合、数分かかることがあります。

### コードをダウンロード

**オプション A: ZIP でダウンロード（最も簡単）**

1. https://github.com/pf-hubs/chutvrc-hubs-cloud にアクセス
2. 緑色の **「Code」** ボタンをクリック
3. **「Download ZIP」** をクリック
4. ダウンロードした ZIP ファイルを開いて **「すべて展開」** をクリック
5. 展開先を選択（例：ドキュメントフォルダ）
6. `chutvrc-hubs-cloud`（または類似の名前）というフォルダができます

**オプション B: Git でクローン（Git がインストールされている場合）**

PowerShell を開いて以下を実行：
```powershell
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```

### クイックセットアップスクリプトを実行

1. エクスプローラーでダウンロードしたフォルダ内の `community-edition` フォルダに移動
2. **`setup_windows.bat`** をダブルクリック
3. 管理者権限の確認が表示されたら「はい」をクリック
4. 画面の指示に従う

スクリプトが自動で行うこと：
- 必要なツールのインストール（Chocolatey、kubectl、mkcert、Node.js、Git）
- hosts ファイルの設定
- SSL 証明書のセットアップ
- SMTP 設定のガイド
- Hubs のローカルデプロイ

手動で手順を進めたい場合は、以下を続けてお読みください。

---

## オプション 2: 手動セットアップ

このガイドでは、Mozilla Hubs（Community Edition または Chutvrc バージョン）を **ローカル Windows 環境**（Docker Desktop 使用）または **Microsoft Azure AKS** にデプロイする方法を説明します。

> **コマンドライン初心者の方へ:** ご安心ください！このガイドでは、すべての手順を詳しく説明します。入力するコマンドはグレーのボックスに表示されます。コピーして貼り付けるだけです。

> **注意:** このガイドはネイティブ Windows ツール（PowerShell/Chocolatey）を使用します。bash スクリプトを修正なしで使用したい場合は、[WSL マニュアル](chutvrc-k8s-deploy-manual-wsl-ja.md)の使用をご検討ください。

---

## ステップ 1: 前提条件

### 1.1. 管理者として PowerShell を開く

PowerShell は Windows のコマンドラインインターフェースです。多くのインストールコマンドには管理者権限が必要です。

1. `Win + X`（Windows キー + X）を押す
2. 「Windows ターミナル（管理者）」または「PowerShell（管理者）」をクリック
3. 「このアプリがデバイスに変更を加えることを許可しますか？」と表示されたら「はい」をクリック
4. 青いウィンドウが表示されます - これが PowerShell です

> **ヒント:** セットアップ中はこのウィンドウを開いたままにしてください。

### 1.2. Chocolatey（パッケージマネージャー）のインストール

Chocolatey は Windows にソフトウェアを簡単にインストールするためのツールです。

既にインストールされているか確認：
```powershell
choco --version
```

バージョン番号が表示されたら、次のセクションへ進んでください。エラーが表示されたら、Chocolatey をインストール：

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
```

> **注意:** これは1つの長いコマンドです。全体をコピー＆ペーストしてください。

インストール後、管理者として PowerShell を閉じて再度開いてください。

### 1.3. 必要なツールのインストール

以下のコマンドを1つずつコピー＆ペーストしてください：

```powershell
choco install git -y
```
> Git をインストールします。インターネットからコードをダウンロードするためのツールです。

```powershell
choco install kubernetes-cli -y
```
> kubectl をインストールします。Kubernetes クラスターを制御するためのツールです。

```powershell
choco install mkcert -y
```
> mkcert をインストールします。安全な接続用の SSL 証明書を作成するためのツールです。

```powershell
choco install nodejs -y
```
> Node.js をインストールします。一部のスクリプトの実行に必要です。

管理者として PowerShell を閉じて再度開き、以下を実行：

```powershell
npm install -g pem-jwk
```
> render スクリプトに必要なツールをインストールします。

mkcert の証明書を信頼するように設定：
```powershell
mkcert -install
```
> 証明書のインストールを確認するメッセージが表示されたら「はい」をクリックしてください。

### 1.4. Docker Desktop のインストール

Docker Desktop は Hubs アプリケーションをコンテナで実行します。

1. https://www.docker.com/products/docker-desktop/ にアクセス
2. 「Download for Windows」をクリック
3. ダウンロードしたインストーラーを実行
4. インストールウィザードに従う（デフォルトオプションのまま）
5. 求められたらコンピュータを再起動
6. 再起動後、Docker Desktop が自動的に起動します（システムトレイにクジラのアイコン）
7. クジラアイコンを右クリック > Settings > Kubernetes
8. 「Enable Kubernetes」にチェック
9. 「Apply & Restart」をクリック
10. Docker と Kubernetes の両方が緑色/実行中のステータスになるまで待つ（Docker Desktop の左下）

> **注意:** 初めて Kubernetes を有効にする場合、ダウンロードと起動に数分かかることがあります。

### 1.5. 共通要件

- **SMTP サーバー**: ログインメールの送信に必要です。Gmail を使用できます：
  1. Google アカウント > セキュリティ にアクセス
  2. 「2段階認証プロセス」を有効化
  3. セキュリティ > 2段階認証プロセス > アプリパスワード にアクセス
  4. 「メール」用のアプリパスワードを作成
  5. この16文字のパスワードを保存 - 後で必要になります

---

## ステップ 2: リポジトリのクローン

Hubs のコードをコンピュータにダウンロードしましょう。

### 2.1. Git Bash を開く

Git Bash はデプロイスクリプトを実行できる Unix ライクなターミナルを提供します。

1. `Win` キーを押して「Git Bash」と入力
2. 「Git Bash」をクリックして開く
3. コマンドプロンプトのある黒いウィンドウが表示されます

> **重要:** ここからは、特に指定がない限り、コマンドの実行には **Git Bash**（PowerShell ではなく）を使用してください。

### 2.2. プロジェクトの保存場所を選択

プロジェクトをユーザーフォルダに保存します：

```bash
cd ~
```
> このコマンドでホームフォルダ（例：`/c/Users/YourName`）に移動します。

### 2.3. コードをダウンロード

```bash
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```
> すべてのコードをダウンロードします。1分ほどかかる場合があります。

### 2.4. プロジェクトフォルダに移動

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

### ローカルデプロイメント（PC 上）の場合

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

### 4.1. 設定ファイルを開く

`render_hcce.sh` をテキストエディタで開く。メモ帳を使用できます：

```bash
notepad render_hcce.sh
```
> メモ帳でファイルが開きます。

### 4.2. 設定を編集

デプロイタイプに応じて以下の行を見つけて変更してください：

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

`Ctrl + S` で保存し、メモ帳を閉じてください。

---

## ステップ 5: 環境セットアップ

### オプション A: ローカルセットアップ（PC 上）

#### 5.1. hosts ファイルの設定

hosts ファイルは、`hubs.local` が自分のマシンを指すようにコンピュータに伝えます。

1. `Win` キーを押して「メモ帳」と入力
2. 「メモ帳」を右クリックして「管理者として実行」を選択
3. 確認メッセージが表示されたら「はい」をクリック
4. メモ帳で ファイル > 開く
5. `C:\Windows\System32\drivers\etc` に移動
6. ファイルフィルターを「テキスト文書 (*.txt)」から「すべてのファイル (*.*)」に変更
7. `hosts` を選択して「開く」をクリック

ファイルの最後に以下の行を追加：
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

ファイルを保存（Ctrl + S）してメモ帳を閉じてください。

#### 5.2. ステップ 6（デプロイ）に進む

### オプション B: Azure AKS セットアップ

#### 5.1. Azure CLI のインストール

管理者として PowerShell を開いて実行：
```powershell
choco install azure-cli -y
```

管理者として PowerShell を閉じて再度開いてください。

#### 5.2. Azure にログイン

```powershell
az login
```
> ブラウザウィンドウが開きます。Azure アカウントでログインしてください。

#### 5.3. リソースグループの作成

```powershell
az group create --name HubsResourceGroup --location westeurope
```
> Azure リソースのコンテナを作成します。`westeurope` をお近くのリージョンに変更できます。

#### 5.4. ネットワークセキュリティグループの作成

Hubs に必要なポートを開くコマンド：

```powershell
az network nsg create --resource-group HubsResourceGroup --name HubsNSG
```

```powershell
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowStream --priority 1000 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 4443
```

```powershell
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowTurn --priority 1001 --direction Inbound --access Allow --protocol Tcp --source-address-prefixes '*' --destination-port-ranges 5349
```

```powershell
az network nsg rule create --resource-group HubsResourceGroup --nsg-name HubsNSG --name AllowUDP --priority 1002 --direction Inbound --access Allow --protocol Udp --source-address-prefixes '*' --destination-port-ranges 35000-60000
```

#### 5.5. Kubernetes クラスターの作成

```powershell
az aks create -g HubsResourceGroup -s Standard_F2s_v2 -n HubsCluster -l westeurope --enable-node-public-ip --node-count 2 --network-plugin azure
```
> クラスターを作成します。5〜10分かかります。完了するまでお待ちください。

#### 5.6. kubectl を Azure に接続

```powershell
az aks get-credentials --resource-group HubsResourceGroup --name HubsCluster
```
> kubectl が Azure クラスターと通信できるように設定します。

---

## ステップ 5.5: Kubernetes コンテキストの確認

デプロイ前に、kubectl が正しいクラスターを指しているか確認してください。

Git Bash を開いて実行：
```bash
kubectl config current-context
```

表示されるべき内容：
- **ローカルの場合:** `docker-desktop`
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

**Git Bash** を開いて、正しいフォルダにいることを確認：
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

1. **ブラウザを完全に閉じる**（タスクバーのブラウザアイコンを右クリック > すべてのウィンドウを閉じる）
2. ブラウザを開いて **https://hubs.local** にアクセス
3. Hubs のホームページが表示されるはずです！

> **注意:** 初回はすべてのサービスが起動するまで1分ほどかかる場合があります。

### 6.2. Azure へのデプロイ

**Git Bash** を開いて、正しいフォルダにいることを確認：
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

1. `cbb.sh` をテキストエディタで開き、メールアドレスとドメインを更新
2. 実行：
   ```bash
   bash cbb.sh
   ```

---

## ステップ 7: トラブルシューティング

### よくある問題

**「command not found」エラー**
- ステップ 1 ですべてのツールをインストールしたか確認
- Git Bash または PowerShell を閉じて再度開いてみる
- PowerShell コマンドの場合、管理者として実行しているか確認

**https://hubs.local にアクセスできない**
- Docker Desktop が実行中か確認（システムトレイのクジラアイコン）
- Kubernetes が有効で実行中か確認（Docker Desktop で緑色のステータス）
- すべてのブラウザウィンドウを閉じて再度試す
- hosts ファイルのエントリが正しく追加されているか確認（管理者として）

**503 エラー**
- 数分待つ - サービスがまだ起動中の可能性があります
- Pod のステータスを確認：`kubectl get pods -n hcce`
- すべての Pod が「Running」ステータスを表示するはずです

**メールリンクが機能しない**
- `render_hcce.sh` の SMTP 設定を再確認
- Gmail の場合、通常のパスワードではなくアプリパスワードを使用しているか確認

**PowerShell でスクリプトが実行できない**
- `.sh` スクリプトの実行には PowerShell ではなく Git Bash を使用
- デプロイスクリプトは bash 用に書かれており、PowerShell 用ではありません

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
