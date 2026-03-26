# Hubs (Chutvrc / CE) を Kubernetes にデプロイ: Mac マニュアル

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
2. 「Download for Mac」をクリック（お使いの Mac に応じて **Apple Chip** または **Intel** を選択）
3. ダウンロードした `.dmg` ファイルを開き、Docker を Applications にドラッグ
4. Applications フォルダから Docker を開く
5. Docker が起動するまで待つ（メニューバーにクジラのアイコンが表示されます）
6. クジラアイコン > **Settings**（歯車アイコン）> **Kubernetes** をクリック
7. **「Enable Kubernetes」**にチェック
8. **「Apply & Restart」**をクリック
9. Docker と Kubernetes の両方が緑色/実行中のステータスになるまで待つ

> **注意:** 初めて Kubernetes を有効にする場合、数分かかることがあります。

### コードをダウンロード

**オプション A: ZIP でダウンロード（最も簡単）**

1. https://github.com/pf-hubs/chutvrc-hubs-cloud にアクセス
2. 緑色の **「Code」** ボタンをクリック
3. **「Download ZIP」** をクリック
4. ダウンロードした ZIP ファイルを開いて展開
5. `chutvrc-hubs-cloud`（または類似の名前）というフォルダができます

**オプション B: Git でクローン（Git がインストールされている場合）**

ターミナルを開いて（`Cmd + Space` を押して「Terminal」と入力し、Enter を押す）以下を実行：
```bash
cd ~
git clone https://github.com/pf-hubs/chutvrc-hubs-cloud.git
```

### クイックセットアップスクリプトを実行

1. Finder でダウンロードしたフォルダ内の `community-edition` フォルダに移動
2. **`setup_mac.command`** をダブルクリック
3. 画面の指示に従う

スクリプトが自動的に行うこと：
- 必要なツールのインストール（Homebrew、kubectl、mkcert、Node.js）
- hosts ファイルの設定
- SSL 証明書のセットアップ
- SMTP 設定のガイド
- Hubs のローカルデプロイ

手動で設定する場合は、以下の手順に従ってください。

---

## オプション 2: 手動セットアップ

このガイドでは、Mozilla Hubs（Community Edition または Chutvrc バージョン）を **ローカル Mac 環境**（Docker Desktop 使用）または **Microsoft Azure AKS** にデプロイする方法を説明します。

> **ターミナル初心者の方へ:** ご安心ください！このガイドでは、すべての手順を詳しく説明します。入力するコマンドはグレーのボックスに表示されます。コピーしてターミナルに貼り付けるだけです。

---

## ステップ 1: 前提条件

### 1.1. ターミナルを開く

ターミナルは、コマンドを入力してコンピュータを操作するアプリケーションです。

1. `Cmd + Space` を押して Spotlight 検索を開く
2. `Terminal` と入力して `Enter` を押す
3. コマンドプロンプトのあるウィンドウが表示されます - ここにコマンドを入力します

> **ヒント:** セットアップ中はこのターミナルウィンドウを開いたままにしてください。

### 1.2. Homebrew（パッケージマネージャー）のインストール

Homebrew は Mac にソフトウェアを簡単にインストールするためのツールです。既にインストールされているか確認：

```bash
brew --version
```

バージョン番号が表示されたら、次のセクションへ進んでください。「command not found」と表示されたら、Homebrew をインストール：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

画面の指示に従ってください。Mac のパスワードを求められる場合があります（入力中は文字が表示されません - これは正常です）。

### 1.3. 必要なツールのインストール

以下のコマンドを1つずつコピー＆ペーストしてください：

```bash
brew install git
```
> Git をインストールします。インターネットからコードをダウンロードするためのツールです。

```bash
brew install kubectl
```
> kubectl をインストールします。Kubernetes クラスターを制御するためのツールです。

```bash
brew install mkcert
```
> mkcert をインストールします。安全な接続用の SSL 証明書を作成するためのツールです。

```bash
brew install node
```
> Node.js をインストールします。一部のスクリプトの実行に必要です。

```bash
npm install -g pem-jwk
```
> render スクリプトに必要なツールをインストールします。

mkcert の証明書を信頼するように設定：
```bash
mkcert -install
```
> パスワードを求められる場合があります。これは正常です。

### 1.4. Docker Desktop のインストール

Docker Desktop は Hubs アプリケーションをコンテナで実行します。

1. https://www.docker.com/products/docker-desktop/ にアクセス
2. 「Download for Mac」をクリック（Mac の種類に応じて Apple Chip または Intel を選択）
3. ダウンロードした `.dmg` ファイルを開き、Docker を Applications にドラッグ
4. Applications フォルダから Docker を開く
5. Docker が起動するまで待つ（メニューバーにクジラのアイコンが表示されます）
6. クジラアイコン > Settings（歯車アイコン）> Kubernetes をクリック
7. 「Enable Kubernetes」にチェック
8. 「Apply & Restart」をクリック
9. Docker と Kubernetes の両方が緑色/実行中のステータスになるまで待つ

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

### 2.1. プロジェクトの保存場所を選択

プロジェクトをホームフォルダに保存します：

```bash
cd ~
```
> このコマンドでホームフォルダ（例：`/Users/yourname`）に移動します。

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

### ローカルデプロイメント（Mac 上）の場合

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

`render_hcce.sh` をテキストエディタで開く：

```bash
open -e render_hcce.sh
```
> TextEdit でファイルが開きます。お好みのテキストエディタを使用しても構いません。

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

`Cmd + S` で保存し、エディタを閉じてください。

---

## ステップ 5: 環境セットアップ

### オプション A: ローカルセットアップ（Mac 上）

#### 5.1. hosts ファイルの設定

hosts ファイルは、`hubs.local` が自分のマシンを指すようにコンピュータに伝えます。

hosts ファイルを開く：
```bash
sudo nano /etc/hosts
```
> `sudo` は管理者としてコマンドを実行します。Mac のパスワードを入力する必要があります。

ファイルの最後に以下の行を追加：
```
127.0.0.1   hubs.local
127.0.0.1   assets.hubs.local
127.0.0.1   cors.hubs.local
127.0.0.1   stream.hubs.local
```

保存して終了：
1. `Ctrl + O`（O はゼロではなく文字の O）を押す
2. `Enter` を押して確認
3. `Ctrl + X` を押して終了

#### 5.2. ステップ 6（デプロイ）に進む

### オプション B: Azure AKS セットアップ

#### 5.1. Azure CLI のインストール

```bash
brew install azure-cli
```

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

1. **ブラウザを完全に終了**（Cmd + Q）- キャッシュされた SSL 証明書をクリアします
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
- ターミナルを閉じて再度開いてみる

**https://hubs.local にアクセスできない**
- Docker Desktop が実行中か確認（メニューバーのクジラアイコン）
- Kubernetes が有効で実行中か確認（緑色のステータス）
- ブラウザを完全に終了して再度試す
- hosts ファイルのエントリが正しく追加されているか確認

**503 エラー**
- 数分待つ - サービスがまだ起動中の可能性があります
- Pod のステータスを確認：`kubectl get pods -n hcce`
- すべての Pod が「Running」ステータスを表示するはずです

**メールリンクが機能しない**
- `render_hcce.sh` の SMTP 設定を再確認
- Gmail の場合、通常のパスワードではなくアプリパスワードを使用しているか確認

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
