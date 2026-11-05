# chutvrc 保守の引き継ぎ

chutvrc の保守を引き継ぐ人のための手引きである。

この文書では次の3つを扱う。

- このリポジトリと4つのサービスのリポジトリの保守
- デモサーバーの保守
- 保守に使うアカウントと費用

## この文書の書き方

- 作業を1つ終えるたびに、その手順と判断を3節の該当する項に短く書き足す。清書は最後にまとめて行う。
- このリポジトリは公開されている。パスワード、API キー、秘密鍵などの値は書かない。サーバーのホスト名やアカウント名もここには書かず、非公開の控え（2節）に書く。ここには控えの場所だけを書く。
- 構造や接点に影響する設計の判断は [`decisions/`](decisions/) に ADR として残し、ここからはリンクを張る。

---

## 1. リポジトリの構成

| リポジトリ | 内容 | ローカルの場所 |
| --- | --- | --- |
| [pf-hubs/chutvrc-hubs-compose](https://github.com/pf-hubs/chutvrc-hubs-compose) | このリポジトリ。compose の構成、セットアップスクリプト、k8s のテンプレート、手順書 | ルート |
| [pf-hubs/chutvrc-reticulum](https://github.com/pf-hubs/chutvrc-reticulum) | サーバー（Elixir / Phoenix）。ルーム、認証、SFU の設定とトークン | `services/reticulum` |
| [pf-hubs/chutvrc-dialog](https://github.com/pf-hubs/chutvrc-dialog) | 同梱の SFU（mediasoup） | `services/dialog` |
| [pf-hubs/chutvrc-hubs](https://github.com/pf-hubs/chutvrc-hubs) | クライアントと管理画面 | `services/hubs` |
| [pf-hubs/chutvrc-spoke](https://github.com/pf-hubs/chutvrc-spoke) | シーンエディター | `services/spoke` |

- 4つのサービスは、`bin/init` が各リポジトリの `develop` ブランチを `services/` に clone する（[`bin/init`](bin/init) の `clone_or_skip`）。`services/` はこのリポジトリの管理外（`.gitignore`）で、それぞれが独立した git リポジトリである。
- 上流は [Hubs Foundation](https://github.com/Hubs-Foundation) の各リポジトリ（hubs、reticulum、dialog、Spoke）。

---

## 2. アカウント・費用・デモサーバー

> **非公開の控えの場所：**（未記入）

### 2.1 アカウントと費用

該当しない行は消す。

| 対象 | 用途 | 権限を持つ人 | 費用と期限 |
| --- | --- | --- | --- |
| GitHub organization `pf-hubs` | 5つのリポジトリ | | |
| Azure（AKS、ACR） | k8s のサンプルインスタンス | | |
| ドメイン | デモサーバーと k8s のサンプルインスタンス | | |
| SMTP | ログイン用メールの送信 | | |
| Sora | SFU | | |
| LiveKit | SFU | | |
| 寄付の受け口（GitHub Sponsors、東京大学基金） | README の Funding and Sponsor | | |

### 2.2 デモサーバー

- 置き場所と URL：
- ログイン方法：
- `.env`、鍵、証明書の置き場所：
- 管理者アカウント：
- 起動と停止：

---

## 3. 保守の手順

各項は対応する作業を終えたときに書き足す。

### 3.1 上流 Hubs Foundation の取り込みと add-on API

（未記入）

### 3.2 compose とセットアップスクリプト

（未記入）

### 3.3 デモサーバーの更新・バックアップ・証明書

（未記入）

### 3.4 リリースと配布

（未記入）

### 3.5 WebRTC トランスポート層と SFU（Dialog・Sora・LiveKit・Cloudflare）

（未記入）

### 3.6 アバターと IK

（未記入）

### 3.7 Behavior Graph と Spoke

（未記入）

### 3.8 libpeer

（未記入）。現状の資料はクライアントの [`docs/libpeer-integration.md`](https://github.com/pf-hubs/chutvrc-hubs/blob/develop/docs/libpeer-integration.md)。

### 3.9 k8s（凍結中）

（未記入）。現状の資料は [`k8s/docs/deploy-manual/`](k8s/docs/deploy-manual/)（英日）と [`k8s/docs/COTURN_WEBRTC_FIX_PLAN.md`](k8s/docs/COTURN_WEBRTC_FIX_PLAN.md)。
