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

**方針（2026-11-05 に決定、[ADR 0003](decisions/0003-cherry-pick-upstream-changes.md)）**：上流とは git の履歴も中身も一致させない。四半期に1回、上流の新しい PR を確認し、必要なものだけを cherry-pick で取り込む。上流 master の全面マージはしない。chutvrc は過去の取り込みを squash してきたため、git が見る共通祖先が古く（hubs では 2024-02）、全面マージは取り込み済みの変更まで衝突するからである。

**手順**

1. 各リポジトリに `upstream` リモート（Hubs-Foundation の hubs、reticulum、dialog、Spoke）を追加して fetch する。4リポジトリとも 2026-11-05 に追加済み。
2. 新しい PR を一覧する：`git log --first-parent --format='%h %ad %s' --date=short <前回確認した最新>..upstream/master`
3. 必要な PR を、develop から作った作業ブランチで `git cherry-pick -x -m 1 <PR のマージコミット>` で取り込む。件名は内容が分かるものに書き換え、本文の `(cherry picked from commit …)` は残す。コミットメッセージには日付、PR や文書の番号、分かりにくい略語を書かない。衝突は chutvrc の値を残して解く。
4. 取り込んだもの、見送ったもの、確認した上流の最新をこの節に書く。
5. develop への PR は merge commit で取り込む。上流の PR ごとのコミットが残り、出どころを追えるようにするため。

**2026-11-05 の取り込み（1回目）**

確認した上流の最新：hubs master `986d07a75`（2026-08-23）、hubs `addons` ブランチ `76e20a04f`（2025-07-29）、reticulum `10364b17`（2026-08-23）、spoke `6a198071`（2026-10-29）、dialog `a927823`（2026-10-29）。

取り込んだもの。作業ブランチは各リポジトリの `feature/upstream-merge-2026-11`（develop への PR は未作成）。

| リポジトリ | 上流 | 内容 | コミット |
| --- | --- | --- | --- |
| hubs | `addons` ブランチ（`e29d3f281`..`76e20a04f` の差分をパッチとして適用） | add-on API（`src/addons.ts`、`src/hubs.js`、`addons.json`）と、Behavior Graph が使う物理・メディアフレーム・テキスト・動画・同期の拡張 | `5568bf114`、`39a238ecb`（add-on を `c29b4f1` に固定、lockfile）、`3d6cbbe47`（`addons_config` の防護） |
| hubs | #6575 | モバイル VR で PDF のページ送りが効かない不具合の修正 | `5353bbbc8` |
| hubs | #6588 | reticulum.io を指す既定値の無効化（同じ置換を chutvrc 側の既定値にも適用） | `67cfe526c`、`6fe06328e` |
| hubs | #6506 | 代名詞の区切りにカンマと空白も使えるようにする | `5ebe488ed` |
| reticulum | #757 | reticulum.io を指す既定値の無効化（`config/dev.exs` の `dialog_hostname` の既定値も同様に） | `1dca9654` |
| spoke | #1316 | reticulum.io を指す既定値の無効化 | `cde518a9` |

あわせて、`evaluation-module` ブランチにあった LiveKit のミュートの修正 `b3105a26f`（ミュートしても音声が止まらない）を `fix/livekit-mic-mute` ブランチに切り出した（`cb3bcf6ac`）。

見送ったものと理由：

- hubs：#6569 pdf.js 4→5（chutvrc の 4.2.67 は CVE-2024-4367 を修正済み）、ESLint 9、Storybook 9、CI、pre-commit、ブランド表記、ツアーの文言、文書。
- reticulum：#743 Icosa Gallery（CORS プロキシの書き換えを含み、外部 URL のメディア全体に影響する）、#750 Bamboo→Swoosh（今のメール送信で足りる）、#740 と #730（原因になった上流の変更が chutvrc にない）、Elixir 1.16 / OTP 25（後回し）、Discord、CI、ブランド表記、JSON-LD。
- spoke：#1301 Icosa Gallery（reticulum #743 と組）、#1317 Node 22（後回し）。
- dialog：Node 24（後回し）、CI、ブランド表記。取り込んだものはない。

add-on API について：

- Behavior Graph の add-on（`hubs-behavior-graphs-addon`）はリポジトリに `dist` を含まず、`npm install` 時に `prepare` で webpack ビルドされる。`@types/hubs` は add-on 自身の lockfile で固定されている。
- add-on は bitECS ローダー（newLoader）のルームでしか有効にならない。chutvrc の機能を add-on にするのは、chutvrc の機能が bitECS ローダーで動くことを確かめた後にする。
- 管理画面の `features.addons_config` と `features.bitecs_loader` は空のままにする。空なら add-on は無効、ローダーは旧ローダーになる。ルーム設定で add-on と bitECS ローダーを有効にしたルームだけで Behavior Graph が動く。
- `/duck` のチャットコマンドは、上流が duck の add-on に移したため使えなくなった（duck の add-on は入れていない）。
- 上流の add-on API（`src/addons.ts`）には次の不具合がある。上流には報告していない。
  - `registerSystem` の `getNextIdx` の比較関数に `return` がなく、`order` が無視される。各システムは枠の末尾の1つ手前に入るので、最初に登録したものが最後に動く。直していない。
  - `order` が 300〜399 のシステムが postPhysics の枠に入り、beforeMatricesUpdate の枠は使われない。Behavior Graph の add-on は10個のシステムをすべて 300 で登録しているので、この影響を受ける。直していない。Blender 製グラフの互換試験の後に、直すかを決める。
  - `getAddonConfig` は `features.addons_config` をオブジェクトとして扱うが、reticulum は `theme.themes` 以外の JSON 型の設定を文字列で渡す。chutvrc 側で文字列なら parse するようにした（`3d6cbbe47`）。

未了：コンテナー内での `npm run lint` とビルド、動作確認（実装計画の確認項目）、develop への PR、hubs と reticulum の `catchup-202510` ブランチの整理（タグを付けて削除）。

### 3.2 compose とセットアップスクリプト

（未記入）

### 3.3 デモサーバーの更新・バックアップ・証明書

（未記入）

### 3.4 リリースと配布

（未記入）

### 3.5 WebRTC トランスポート層と SFU（Dialog・Sora・LiveKit・Cloudflare）

**構成（2026-11 の整理後。[ADR 0004](decisions/0004-sfu-session-with-shared-layers.md)）**。すべて hubs の `src/sfu-adapters/` にある。

- `sfu-session.ts`：`APP.sfu` の実体。ページの間ずっと同じオブジェクトで、中にルームの SFU 用のアダプターを1つ持ち、SFU が変わるときだけ作り直す。アダプターのイベントはそのまま転送されるので、外のコードは `APP.sfu` だけを購読する。公開講演の送信・鏡・代理（`APP.publicSpeakingSfu` など）も同じクラス。
- `sfu-config.ts`：接続に要る値の型 `SfuConfig`（`kind` が `dialog` / `livekit` / `sora`）。`buildSfuConfig` が reticulum の join の返事から作る。公開講演用の `derivePublicSpeakingConfig`、Dialog のホスト変更用の `withDialogHost` もここ。
- `data-channel-bus.ts`：データチャンネルの表（ラベル、文字列かバイナリか、信頼性と順序、Sora での方向、生データを記録するか）、送信、記録、公開講演の中継キュー。ラベルの一覧はこの表だけにある。
- `media-session.ts`：リモートの MediaStream の台帳と `getMediaStream` の保留、ローカルトラック（マイク・カメラ・画面共有）の台帳、マイクの状態。
- `sfu-adapter.ts`：基底。`disconnect()` の順序はここに1か所で書いてある（接続を閉じる → ローカルトラックの unpublish（停止はしない） → 保留の reject と台帳の消去 → 中継キューの消去 → アバター同期の停止と相手のアバターの削除 → ハンドラーの後始末）。
- `dialog-adapter.ts`、`livekit-adapter.ts`、`sora-adapter.ts`：SFU ごとのドライバー。
- `switch-sfu.ts`：ルーム設定で SFU が変わったとき（`hub_refresh`）に、再読み込みなしで切り替える。

**新しい SFU を足すとき**：`sfu-types.ts` の列挙と reticulum の `hub.sfu` の値、管理画面とルーム設定の選択肢を合わせ、`SfuConfig` に `kind` を1つ足し、`SfuAdapter` を継承して abstract メソッドを実装する：`connect(config)`、`closeConnection()`、`sendData(label, bytes, spec)`、`publishTrack` / `replaceTrack` / `unpublishTrack`、`setMicEnabled` / `micEnabled`、`kick` / `block` / `unblock`、`isConnected`、`isBridgeChannelReady`。受信したトラックは `media.addRemoteTrack`、受信したデータは `bus.receive(label, bytes)` に渡す。最後に `adapter-factory.ts` に登録する。

**SFU ごとの差**：マイクのミュートは Dialog が producer の pause、LiveKit が track の mute、Sora が `track.enabled`。LiveKit は `connect()` の中で自分でマイクを取得して publish する。`getMediaStream` の 30 秒のタイムアウトは LiveKit だけ。姿勢の `#avatar-*` チャンネルは LiveKit だけ unreliable で、Dialog と Sora は既定（reliable、ordered）のまま。

**2026-11 の整理で直した不具合**：Dialog のホスト変更時の例外、LiveKit の再接続のリーク、マイクの二重 publish、意図した切断の後の再接続、Dialog の記録によるメモリ増、公開講演の送信側が LiveKit で接続できない、ルーム移動の後に旧ルームのアバターが残る（Dialog と Sora）、ルーム設定の SFU 切替が在室者に反映されない。

**残っている既知の問題**：Sora のミュートが `track.enabled` だけで無音を送り続けること、Sora で画面共有とカメラが同じ video トラックを使うこと（確認できる環境がないため据え置き）。

**確認**：`npm run check`（tsc）はホストでも動く。`npm run lint` と `npm run build` はコンテナーで行う。動作確認の項目は実装計画 `chutvrc_sfu-avatar-refactor-plan_2026-11.md` の5節（Dialog と LiveKit で確認する。Sora は環境がない）。

### 3.6 アバターと IK

（未記入）

### 3.7 Behavior Graph と Spoke

（未記入）

### 3.8 libpeer

（未記入）。現状の資料はクライアントの [`docs/libpeer-integration.md`](https://github.com/pf-hubs/chutvrc-hubs/blob/develop/docs/libpeer-integration.md)。

### 3.9 k8s（凍結中）

（未記入）。現状の資料は [`k8s/docs/deploy-manual/`](k8s/docs/deploy-manual/)（英日）と [`k8s/docs/COTURN_WEBRTC_FIX_PLAN.md`](k8s/docs/COTURN_WEBRTC_FIX_PLAN.md)。
