# COLOR HIDE — 設計・実装メモ

3Dオンラインかくれんぼ。自分のキャラクターに絵を描いて景色に擬態し、鬼から隠れて
逃げ切るゲーム。URLを共有するだけで友達と2〜6人で遊べる（登録不要）。

> 本ドキュメントは `docs/ADDING_GAMES.md` の規約に沿った **COLOR HIDE 固有**の設計・
> 進捗・運用メモです。既存ゲーム（リバーシ等）には一切影響を与えません。

---

## 技術選定（確定）

| 項目 | 採用 | 理由 |
|---|---|---|
| 3D描画 | **React Three Fiber + drei + three.js** | React 19 / App Router と宣言的に統合。`dynamic(…, {ssr:false})` でWebGLをSSRから隔離。 |
| ペイント | **CanvasTexture + レイキャストUV描画 + UVアトラス** | 2Dオフスクリーンcanvasにブラシ→テクスチャ反映。各部位をアトラスの別領域にUV再マップし、部位ごとに塗り分け（頭を塗っても胴体に滲まない）。 |
| ロビー/部屋（永続・低頻度） | **既存KVストア（Upstash/メモリ、新prefix `color-hide:room:`）** | 低頻度操作はCASで十分。外部サービス不要・追加コスト0。 |
| リアルタイム（位置・向き・アニメ） | **トランスポート抽象 + ローカルWSサーバー（dev/test）**、本番は **PartyKit** 設計 | 3Dアクションはポーリング不可。netcodeはトランスポート非依存に実装（下記）。 |

### 2層ステート設計

- **永続・低頻度 = KVストア（`RoomState`）**: ロスター・ホスト・フェーズ＋フェーズ開始時刻・
  マップ・確定ペイント・結果。トークンは**ハッシュのみ**保存し公開状態に含めない。
- **揮発・高頻度 = リアルタイムチャネルのみ**: 位置・向き・アニメ。**永続化しない**。
  鬼クライアントには**可視なhiderの位置だけ**を配信（サーバーでレイキャスト判定）。

---

## セキュリティモデル（サーバー権威）

- **壁越しの不正発見を不可能に**: `lib/detection.ts` が距離＋視野角＋**遮蔽（線分×AABB）**で
  可視性を判定。鬼に送るスナップショットは受信者ごとにフィルタ（`net/realtime.ts`
  `buildSnapshot`）。隠れているhiderの座標は鬼クライアントに一切送られない。
- **発見はクライアント自己申告で決めない**: 捕獲は信頼されたリアルタイムホストが
  `canCatch`（距離＋視線）で検証し、共有シークレット付きの `POST .../catch` で確定。
- **移動のアンチチート**: `lib/movement.ts` `validateMove` がテレポートをクランプし、
  壁抜けを防ぐ（クライアント予測と同一コードをサーバーが再実行）。
- **ペイントの濫用防止**: `lib/paint.ts` がPNG/WebPのみ・48KB上限・SVG等を拒否。
  コミット間隔を制限、保存件数を上限化（`lib/paintService.ts`、別prefix `color-hide:paint:`）。
- タイマーは**サーバー時刻**基準（`phaseStartedAt`＋各フェーズ定数）。クライアント時刻に依存しない。

---

## 名前空間（既存と衝突しない）

| 項目 | 値 |
|---|---|
| ゲームコード | `src/games/color-hide/` |
| 開始/ルーム | `/games/color-hide`, `/games/color-hide/room/<id>` |
| API | `/api/games/color-hide/rooms/*` |
| Redisキー | `color-hide:room:<id>`, `color-hide:paint:<id>` |
| トークンヘッダ | `x-color-hide-token` |
| localStorage | `color-hide:token:<id>`, `color-hide:pid:<id>`, `color-hide:nickname` |
| RTホスト認証 | `x-color-hide-rt-secret`（env `COLOR_HIDE_RT_SECRET`、未設定時はdev既定値） |

---

## フェーズ

```
LOBBY → PREPARING(5s) → PAINTING(60s) → HIDING(30s) → SEEKING(180s) → RESULT(20s) → LOBBY
```

時間はすべて `lib/constants.ts` の定数。`lib/phases.ts` がサーバー時刻で遷移を計算し、
HTTP読み取り・リアルタイムホストの双方が同じ純関数を使うため全端末が同一フェーズに揃う。

---

## リアルタイム基盤：ローカル先行 → PartyKit

netcode（`net/realtime.ts` `ColorHideServer`）は**トランスポート非依存**（コールバック駆動）。
したがって同一コードが「ローカルWSホスト（開発/テスト）」でも「PartyKitホスト（本番）」でも動く。
部屋メタは `RoomMetaProvider` 経由で取得（ローカルホストはアプリのHTTP APIを読む）。

- **今できること（承認不要・コスト0）**: ローカルWSホスト＋既存KVストアで完全ローカル検証。
- **本番基盤の選定**: アカウント作成・provisioning・課金発生操作は **事前承認が必要**。
  - ⚠️ **2026-11 更新**: PartyKit のホスト型プラットフォームは **2026年10月に終了**。後継は
    「自分の Cloudflare アカウント上で動く PartyServer（= Worker + Durable Object）」。実質 **Cloudflare
    Durable Objects** が本番基盤。詳細・料金・比較は下記「Phase 2 — 本番前QA」を参照。netcode は
    トランスポート非依存なので、本番アダプタ差し替えだけで接続できる。

---

## コスト・運用（要確認事項を明記）

- 現状の承認不要範囲（ローカルWS＋Upstash無料枠の部屋メタデータ）は**追加コスト0**。
- 本番の常時接続基盤候補と確認すべき点（**数値は未確定**）：
  - PartyKit（Cloudflareベース）/ Cloudflare Durable Objects / Colyseus / Ably 等。
  - 無料枠の同時接続数・接続時間課金・転送量・リージョンを provisioning 前に確認。
- Redis使用量: 部屋レコードは小さく（位置は保存しない）、ペイントは別キー＋上限で抑制。TTL 6時間。

---

## ローカルでの動かし方

```bash
# メモリストアで起動（本番Redisに触れない）
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= \
KV_REST_API_URL= KV_REST_API_TOKEN= REVERSI_MEMORY_STORE=1 npm run dev
# → http://localhost:3000/games/color-hide
```

---

## 実装状況

### 完了・検証済み
- サーバー権威の純ロジック（phases / detection / movement / winner / paint / maps / geometry / uvAtlas）＋単体テスト
- リアルタイムnetcode（`ColorHideServer`、スナップショットのフィルタ＋捕獲検証）＋単体テスト
- ルームサービス（作成/参加/2〜6人・7人目拒否/再接続/準備/マップ/開始/捕獲/ロビー復帰）＋単体テスト
- HTTP API（`/api/games/color-hide/rooms/*`）＋クライアントAPI
- **3Dキャラクターペイント（最重要機能）**: ブラウザ実機で、キャラ描画・回転・UV分離・パレット・
  ブラシ・消しゴム・全体塗り・Undo・全消去を確認済み
- ロビーUI（招待URL・マップ選択・ロスター・準備/開始ゲーティング）: ブラウザ実機で確認済み

### 未実装（次フェーズ）
- 対戦3Dシーン（移動・三人称カメラ・他プレイヤー描画・発見/捕獲アクション・HUD・モバイル操作）
- ローカルWSホスト（`server/localServer.ts`）＋クライアントWSトランスポート＋Playwright 2つ目のwebServer
- E2E（ロビー・参加上限・ペイント同期・遮蔽越し不発見・時間切れ終了・再接続・再戦）
- 対戦が遊べるようになった時点でレジストリを `available`＋`href` に更新（現在は正直に `coming-soon`）

---

# Phase 2 — 本番前QA（2026-11-17）

## 実対戦E2E（real-socket, WebGL不要）

`e2e/color-hide-realtime.spec.ts` が、**実際のローカルWSホスト＋本物のWebSocketクライアント＋HTTPアプリ**を
使って対戦を検証（WebGLに依存しないためCIで安定）。短縮タイマー（`playwright.config.ts` の webServer env）で
1ラウンドを約15秒で走破。検証済み：

- WebSocket認証：不正トークン → `error`＋切断、welcome無し。正しいトークン → welcome＋ロール。
- 2人対戦：ロール配布、位置同期、**アンチテレポート**（x=9999申告→相手視点でクランプ）、
  **情報漏洩なし**（鬼が壁方向を向くと隠れているプレイヤーの座標を一切受信しない／隠れる側は鬼を常に受信）、
  **捕獲→鬼勝利**（シークレット無しの捕獲要求は403、信頼ホスト経路のみ成立）。
- 時間切れ → 隠れる側勝利。
- **6人対戦**：鬼1＋隠れる5、全員welcome。
- 切断・再接続：ソケットを落として同一トークン/IDで再接続 → 再welcome。

既存の `e2e/color-hide.spec.ts`（ロビー・参加上限・7人目拒否・開始）＋全既存ゲームE2Eも継続pass（計26 E2E）。

## パフォーマンス（実測）

**PC実測（本開発機 / 実Chrome / ウィンドウ、エミュレーションではない）**。rAFで3秒サンプリング：

| マップ | FPS | 最悪フレーム | ヒープ |
|---|---|---|---|
| カラフルな部屋 | 120（vsync上限） | — | 101 MB |
| 倉庫 | 120（vsync上限） | 9.3 ms | 106 MB |
| おもちゃの街 | 120（vsync上限） | 11.4 ms | 105 MB |

3マップとも表示の120Hz vsync上限に到達（＝**PC 60fps目標を余裕で超過**、フレーム落ちなし）。
低品質強制でも120fps・canvas正常。

**通信量（実測）**：6人対戦のseeking中、1クライアントが2秒で **29スナップショット / 17.6 KB**
（≈14.5 Hz、≈8.8 KB/s、≈607 B/スナップショット）。

**スマートフォンは未計測**（実機なし。利用中のブラウザ自動化ツールはCDP CPUスロットリングを公開しておらず、
エミュレーションを実機計測として扱わない方針）。低ポリ・~15Hz通信・~100MBヒープから実機でも動作見込みだが**要実機検証**。

**低品質モード**：`src/games/color-hide/lib/quality.ts`。端末ヒント（コア数/メモリ/タッチ）で自動判定し、
低tierはDPRを抑制＋リアルタイム影を無効化。`localStorage["color-hide:quality"] = "high"|"low"` で手動上書き可。

## セキュリティ検証まとめ

| 項目 | 方式 | 検証 |
|---|---|---|
| トークン認証 | ハッシュ照合、raw非保存 | roomService単体 |
| WS接続認証 | ホストがトークン→playerId照合後に接続許可 | realtime E2E（不正→切断） |
| ホスト権限 | map/start/lobby はホストのみ | roomService単体 |
| 参加制限 | 2〜6人、7人目409、進行中join不可 | roomService単体＋E2E |
| 移動速度不正/壁抜け | サーバー `validateMove`（クランプ＋衝突） | movement単体＋realtime E2E（テレポートクランプ） |
| 不正な捕獲 | クライアント自己申告不可。距離＋視線をサーバー検証、確定はシークレット付き経路 | detection/realtime単体＋E2E（403） |
| 隠れプレイヤーの情報漏洩 | 受信者別スナップショットフィルタ（鬼は可視hiderのみ） | realtime単体＋**realtime E2E（漏洩なし）** |
| ペイント濫用 | PNG/WebPのみ・48KB上限・SVG拒否・頻度/件数制限 | paint/paintService単体 |
| 再接続時の権限 | 同一トークン/IDで復帰、席維持 | realtime E2E |
| サーバー状態とクライアント表示の整合 | 位置はサーバー権威、表示はスナップショット＋状態ポーリング | realtime E2E |

## 本番リアルタイム基盤の比較（2026-11時点・要point-in-time確認）

| | PartyKit | Cloudflare Durable Objects | Colyseus |
|---|---|---|---|
| 状態 | **ホスト終了(2026-10)**→PartyServerとしてCloudflare上で自前運用 | Cloudflare中核、積極投資 | OSS成熟 / Cloud($15/mo〜) |
| 料金 | = DO（PartyKit手数料なし） | Workers Paid $5/mo〜（100万req/月込、超過$0.15/M req、帯域課金なし） | 自前=サーバー代 / Cloud $15/mo〜（無料枠なし） |
| 権威型適合 | ◎（DOの薄いラッパ） | ◎（1ルーム=1DO、単一スレッド権威） | ◎（Roomクラス） |
| Vercel統合 | フロントVercel、ブラウザ→Worker/DOに直WS | 同左 | フロントVercel、→Colyseusサーバー |
| 無料枠 | （Cloudflare準拠） | Workers Free: 10万req/日・1.3万GB-s/日（超過はエラー） | なし |

**想定月額（6人/5分/15Hz・前提明記）**：接続分=試合×6×5、受信課金=18×6×300/20≈1,620req/試合（DOは送信無料）、
継続時間=300s×0.128GB=38.4GB-s/試合。

| 試合/月 | Cloudflare DO / PartyServer | Colyseus Cloud | Colyseus自前 |
|---|---|---|---|
| 100 | **$5**（無料枠内、Paid基本料のみ） | $15 | ~$5-7（VPS） |
| 1,000 | **~$5.1** | $15 | ~$5-7 |
| 10,000 | **~$7.3**（req超過$2.3、継続時間384k<400k込） | $15 | ~$5-7＋従量egress（AWS/GCP時~$14-21、Hetzner/DO等は込み） |

> 価格は公式ページ（2026-11-17取得）に基づく概算。Colyseus Cloudの入門インスタンス仕様・上位価格はダッシュボード
> 非公開のため**未確定**。10,000試合はDO無料枠の日次上限（10万req/日）を超えるためWorkers Paid前提。

**推奨：Cloudflare Durable Objects（PartyServerライブラリでルーム抽象）**。全スケールで最安（$5〜$7/mo、
帯域非課金）、1ルーム=1DOが権威型に最適、Vercelフロントと綺麗に分離。
次点はゼロ運用重視なら Colyseus Cloud（$15/mo・無料枠なし）。
**本番provisioning・契約・デプロイは未実施（要承認）。**

## ローカルで“友達と実対戦”する手順

```bash
# ターミナル1：アプリ（メモリストア、本番Redisに触れない）
UPSTASH_REDIS_REST_URL= UPSTASH_REDIS_REST_TOKEN= KV_REST_API_URL= KV_REST_API_TOKEN= \
REVERSI_MEMORY_STORE=1 npm run dev
# ターミナル2：リアルタイムホスト（dev/test用、課金なし）
COLOR_HIDE_APP_URL=http://localhost:3000 npm run dev:color-hide-rt
# → http://localhost:3000/games/color-hide を各自のブラウザで開き、招待URLを共有
```

## 本番公開までの残課題

- **本番リアルタイム基盤（Cloudflare DO/PartyServer）の承認・provisioning・デプロイ**（未実施）。
  本番WS URLを `NEXT_PUBLIC_COLOR_HIDE_WS_URL`、`COLOR_HIDE_RT_SECRET` を強いランダム値に設定。
- **スマートフォン実機でのFPS/操作性検証**（未計測）。
- 2ブラウザの3D描画同期の自動E2E（現状はreal-socket netcode E2E＋手動ブラウザ確認でカバー）。
- アニメーション拡充・効果音・捕獲後のスペクテイト導線。
- dev限定のR3F+React19 StrictMove警告（本番ビルドでは出ない）。

---

# Phase 3 — Cloudflare本番基盤の実装（2026-11-17）

**承認範囲：コード実装＋ローカル検証のみ。** Cloudflareへのデプロイ・課金変更・本番env変更・mainマージは**未実施**（別途承認が必要）。

## 実装

- **`cloudflare/color-hide/`**：Cloudflare Worker + **1ルーム=1 Durable Object**（`ColorHide`、PartyServer）。
  既存の `ColorHideServer` netcode を**そのまま再利用**（トランスポート差し替えのみ）。DOは**揮発的な位置情報のみ**を保持し、
  永続化はしない。部屋メタ（ロスター/フェーズ/マップ）はVercelアプリをHTTPで読む（`server/httpProvider.ts` を
  ローカルホストと**共有**）。ルーティング：`/parties/color-hide/<roomId>`。
- **ローカルホスト（`server/localServer.ts`）は維持**。クライアント transport はenv一本で切替：
  `NEXT_PUBLIC_COLOR_HIDE_WS_URL` 未設定→ローカルホスト、設定→PartyServer（パスでDOへルーティング）。
- 運用・デプロイ・ロールバック・環境変数・ローカル実行手順は **`cloudflare/color-hide/README.md`**。
- コマンド：`npm run cf:dev`（workerdでローカル実行）、`npm run cf:typecheck`、`npm run test:partyserver`。

## 信頼境界（Vercel ↔ Cloudflare）と脅威モデル

**境界**：
- **Vercel（アプリ＋Upstash）** = 永続・権威データの源泉（ロスター、ホスト、フェーズ＋開始時刻、マップ、確定ペイント、結果、トークンハッシュ）。
- **Cloudflare DO** = 揮発的ライブ状態の権威（位置・向き・アニメ）。永続化なし。
- 2者は**共有シークレット `COLOR_HIDE_RT_SECRET`** で結ばれる：DO→アプリの `/catch`（捕獲確定）のみがシークレットを要する server-to-server 書き込み。
- クライアント（ブラウザ）は**どちらも信頼しない**：HTTPはトークン、WSはhelloでトークン認証。

| 脅威 | 対策 | 実装/検証 |
|---|---|---|
| 偽トークンでWS接続 | helloのトークンをアプリGETで検証（yourId一致）、不一致は切断 | party.ts / **partyserver E2E（bad token拒否）** |
| 他ルームへのアクセス | 1ルーム=1DO（`this.name`）、hello.roomId≠this.name は切断 | DO分離 / **E2E（cross-room isolation）** |
| 隠れプレイヤーの位置漏洩 | 受信者別スナップショットフィルタ（鬼は可視hiderのみ） | buildSnapshot / **E2E（no info leak, 実DO）** |
| クライアント自己申告の捕獲 | 捕獲はDOが距離＋視線で検証→シークレット付き`/catch`でのみ確定 | canCatch / markCaught / **E2E（catch→win）＋ `/catch` 403** |
| テレポート/壁抜け | サーバー `validateMove`（クランプ＋衝突）、同一コードで再計算 | movement / **E2E（teleport clamp）** |
| CSWSH（他サイトからのWS） | Origin許可リスト（`COLOR_HIDE_ALLOWED_ORIGINS`）を upgrade 前に検証 | index.ts onBeforeConnect |
| メッセージ洪水 | 接続ごと 40 msg/s 上限、超過は切断。stale seq 破棄 | party.ts rateOk |
| 接続過多 | 1ルーム6接続上限＋認証（ロスター≤6のみ接続可） | party.ts |
| ペイント濫用 | PNG/WebPのみ・48KB・頻度/件数制限 | paintService |
| 開発シークレットの本番使用 | `ENVIRONMENT=production` かつ secret 未設定/dev値 → DOは**fail closed**（接続拒否）。アプリ側も `VERCEL_ENV=production` で `/catch` を拒否 | party.ts `secret()` / api.ts `realtimeSecretConfig()` |
| シークレットのログ流出 | シークレット値は一切ログ出力しない（wranglerも "(hidden)" 表示） | 全体 |

**残リスク**：Origin検証はブラウザのみ（Node等Originなしクライアントはトークン認証が最終防衛線）。シークレットはVercel/Cloudflare双方に設定が必要（運用手順に明記）。

## ローカル統合テスト結果（実workerd + 実WebSocket）

`npm run test:partyserver`（workerdをwrangler devで起動し、実WSでDOを検証）— **7/7 pass**：
bad token拒否 / 2人対戦（ロール・位置同期・情報漏洩なし・アンチテレポート・**捕獲→鬼勝利**）/ 時間切れ→隠れる側勝利 /
6人welcome / **クロスルーム分離** / **ペイント共有** / 再接続。

## コスト（2026-11-17 公式ページ基準・launch前に要再確認）

- CF DO：100試合=**$5**、1,000=**~$5.1**、10,000=**~$7.3**（送信・帯域は非課金、DO永続化なし）。
- **要注意（Cloudflareではなく Vercel 側）**：DOが約1秒毎にアプリ `GET /rooms/:id` を叩くため、Vercel関数呼び出しが試合秒数に比例（1万試合で約300万回/月）。緩和：`META_REFRESH_MS` を2–3秒へ、または push 型へ。
- スパイク対策：アプリ側の上限（6人/TTL/レート制限/Origin）＋Cloudflare自動DDoS＋必要ならWAF/Rate-Limitingルール。**Workers/DOにハード上限課金停止は（調査時点で）無し**、通知アラートのみ → launch前に最新の費用上限設定を要確認。

## デプロイ / ロールバック（手順書のみ・未実行）

`cloudflare/color-hide/README.md` 参照。デプロイ＝`wrangler secret put` ＋ `wrangler deploy`（本番var上書き）＋Vercelに
`NEXT_PUBLIC_COLOR_HIDE_WS_URL`/`COLOR_HIDE_RT_SECRET` 設定。ロールバック＝**キルスイッチ**（Vercelの
`NEXT_PUBLIC_COLOR_HIDE_WS_URL` を外す→ロビー/ペイント/結果はHTTPで継続、ライブ対戦のみ停止）／`wrangler rollback`／`wrangler delete`。

---

# Phase 4 — 本番公開前の最終監査（2026-11-17）

**承認範囲：監査・必要な修正・テスト・リリース手順確定のみ。** 本番デプロイ／Cloudflare課金プラン変更／Vercel本番env変更／mainマージは**未実施**。

## GitHub状態
HEAD = PR #5 HEAD = `11a24a7`→（Phase4で更新）。`mergeable: MERGEABLE` / `mergeStateStatus: CLEAN`（**競合なし・判定完了**）。mainの3コミット先行、遅れなし。リポジトリCIワークフローは無し。VercelのPR**プレビュー**デプロイチェックはpass（プレビューであり本番ではない／`NEXT_PUBLIC_COLOR_HIDE_WS_URL`未設定なのでプレビューはRT未接続でロビー/ペイントのみ動作）。Draftのため自動マージされない（意図通り）。

## コスト最適化（Vercel API呼び出し削減）

- **DOのメタ取得**：`META_REFRESH_MS` を 1s→**2.5s** に（env `COLOR_HIDE_META_REFRESH_MS` で上書き可）。さらに**障害耐性**：取得失敗時は**直前のmetaを保持**（一時的なVercel障害でラウンドが停止しない）＋**指数バックオフ**（最大8倍）で障害時の負荷を抑制（単体テスト追加）。DOは**hiding/seeking中のみ接続**＝アクティブなので、ラウンド終了（RoundViewアンマウント）でポーリング自動停止。
- **クライアントのポーリング**（こちらが支配的コスト）：フェーズ連動化。ロビー/準備/結果=1.5s、**painting/hiding/seeking=3s**（カウントダウンはサーバー時刻、捕獲はWS経由なので対戦中はHTTP頻度を落とせる）。1試合あたりのクライアントGETを**約50%削減**。
- push型は見送り（過剰変更回避）。現状のlazy-tick＋低頻度ポーリングで十分安定・低コスト。フェーズ遷移はクライアント/DOいずれのGETでも進む（どちらか速い方）。

## コスト試算（2026-11-17 公式料金・前提明記／launch前に要再確認）

前提：6人/試合、1試合≈ラウンド+ロビーで約300秒アクティブ。最適化後の概算で、1試合あたり Vercel関数呼び出し ≈ **~1,000**、Upstashコマンド ≈ **~1,900**（各認証GETが get + lastSeen の CAS を伴うため）、Cloudflare課金リクエスト ≈ 1,626（受信WS 20:1、送信無料）。

| 試合/月 | Cloudflare | Vercel Functions | Upstash Redis | **合計(概算)** |
|---|---|---|---|---|
| 100 | **$5**(基本) | 無料枠内(~0.1M<1M)※商用はPro | 無料枠内(~0.19M<0.5M) | **$5〜**（商用Pro併用で$25前後）|
| 1,000 | **~$5** | ~1M＝Hobby上限際 → **Pro $20**基本でカバー | ~1.9M → PAYG **~$4** or 固定$10 | **~$30** |
| 10,000 | **~$7** | ~10M：Hobbyは停止 → **Pro ~$20〜27**（呼び出し$6＋Active CPU数百円＋$20クレジット相殺）| ~19M → PAYG **~$38** | **~$65〜75** |

- **区分**：Cloudflare=基本$5/月＋従量（帯域・保存なし）。Vercel=Hobby無料(1M呼び出し/1M CDN、超過は**課金ではなく一時停止**、商用不可)／Pro=$20/席＋$20クレジット＋従量（呼び出し$0.60/1M、Active CPUは実行中のみ・I/O待ち非課金、リージョン別$0.128〜0.221/CPU-hr）。Upstash=無料500K cmd/250MB/10GB、PAYG $0.20/100K cmd・保存$0.25/GB・帯域$0.03/GB（200GB無料）。
- **支配的変動費＝ポーリング由来のVercel呼び出し＋Upstashコマンド**（上記最適化で約半減済み）。さらに削るなら lastSeen ハートビート頻度低減が次の一手（現状は将来対応）。
- **予算管理**：Vercelは Spend Management（上限で一時停止・要確認）、Upstashは予算上限設定可、Cloudflareは**通知アラートのみ（ハード上限なし・要確認）**。異常トラフィックはアプリ側上限（6人/TTL/40msg/s/Origin/ルームID検証）＋Cloudflare自動DDoS＋必要時WAF。**課金操作は未実施。**

## セキュリティ監査（本番Secret・接続）

Phase 3の脅威モデル表に加え、本監査で確認・強化：
- **本番Secret必須＋dev拒否**：DO（`ENVIRONMENT=production` かつ空/dev値→接続拒否）、アプリ `/catch`（`VERCEL_ENV=production` かつ空/dev→403 fail closed）。シークレット値はログ非出力（wranglerも "(hidden)"）。**実値は表示・記録・コミットしない。**
- **追加硬化**：WorkerでルームID形式検証（`/^[a-z0-9]{6,64}$/`、不正→400でDO生成阻止）、Origin許可リスト（**E2Eで不正Origin拒否を検証**）、接続ごと40msg/s、1ルーム6接続上限、クロスルーム分離（1ルーム=1DO、hello.roomId≠this.name拒否）。
- **本番で必要なenv（設定先）**：
  - Cloudflare Worker：`COLOR_HIDE_RT_SECRET`(secret), `COLOR_HIDE_APP_URL`, `COLOR_HIDE_ALLOWED_ORIGINS`, `ENVIRONMENT=production`（任意 `COLOR_HIDE_REALTIME_ENABLED`, `COLOR_HIDE_META_REFRESH_MS`）。
  - Vercel(本番)：`NEXT_PUBLIC_COLOR_HIDE_WS_URL=wss://<worker>`, `COLOR_HIDE_RT_SECRET`(同値), 既存 `KV_REST_API_*`/`UPSTASH_*`。フェーズタイマー上書きは**未設定**にする。

## ロールバック / 緊急停止（実行可能ランブック）

**重要**：`NEXT_PUBLIC_*` はビルド時にクライアントへ焼き込まれる。Vercel envの解除だけでは既存配信・既存タブは止まらない（再ビルド＋再デプロイが必要、既存タブはリロードまで旧URL）。即時停止はCloudflare側で行う：
- **Tier1（秒・新規接続停止）**：`wrangler deploy --var COLOR_HIDE_REALTIME_ENABLED:0`（新規WS→503）。
- **Tier2（秒・既存も切断）**：`wrangler rollback` / `wrangler delete`（DO退避で全切断→クライアントは再接続失敗→"RT未接続"、ロビー/ペイント/結果はHTTP継続）。
- **Tier3（分・新規ページ配信停止）**：Vercelで `NEXT_PUBLIC_COLOR_HIDE_WS_URL` 解除＋再デプロイ。
- DO障害＝永続データ無しのため位置情報のみ消失、ラウンドはアプリ権威のphase/rosterから継続。**Redis/Upstashは一切不変。** 詳細は `cloudflare/color-hide/README.md`。

## 最終統合テスト（実workerd + 実WS）

`npm run test:partyserver` — **9/9 pass**：bad token拒否 / **不正Origin拒否** / **7人目拒否** / 2人対戦（ロール・同期・情報漏洩なし・アンチテレポート・捕獲→鬼勝利）/ 時間切れ→隠れる側勝利 / 6人welcome / クロスルーム分離 / ペイント共有 / 再接続。
ブラウザ実機確認（PC）：`NEXT_PUBLIC_COLOR_HIDE_WS_URL=ws://localhost:8787` でブラウザ→**Durable Objectにライブ接続**（Workerログ `101 Switching Protocols`、"RT未接続"なし、3Dシーン描画、コンソールエラー無し）。スマホ実機のFPS/タッチは未計測（実機必要・残課題）。

## デプロイチェックリスト（順序・要承認）

1. `wrangler login` → `wrangler whoami`（アカウント確認）。
2. Workers **Paid($5/月〜)** 課金プラン確認（本番はHobby不可）。
3. `wrangler secret put COLOR_HIDE_RT_SECRET`（強いランダム値）。
4. `wrangler deploy --config cloudflare/color-hide/wrangler.toml --var ENVIRONMENT:production --var COLOR_HIDE_APP_URL:<vercel> --var COLOR_HIDE_ALLOWED_ORIGINS:<origin>`（初回で v1 SQLite migration 適用）。
5. `curl https://<worker>/health` → `ok`。
6. Vercel(本番)に `NEXT_PUBLIC_COLOR_HIDE_WS_URL=wss://<worker>` と `COLOR_HIDE_RT_SECRET`(同値) を設定、フェーズタイマー上書きを解除 → 再デプロイ。
7. Vercel Spend Management / Upstash 予算上限 / Cloudflare 課金アラートを設定。
8. 2ブラウザで実対戦スモーク → 問題時は上記ロールバックTier1/2。

---

# Phase 5 — 段階的本番公開の準備（2026-11-17）

**承認範囲：第1段階の実行直前確認＋第2段階（限定公開）テスト準備のみ。** Cloudflareデプロイ／課金有効化／本番Secret設定／Vercel本番変更／mainマージは**未実施**。公開は3段階に分離：①Cloudflare本番基盤構築 → ②Preview（限定公開）で動作確認 → ③mainマージ＋Vercel本番。

## 状態・アカウント・デプロイ事前確認（dry-run）

- Git/PR：HEAD = PR #5 HEAD、`mergeable: MERGEABLE / CLEAN`（競合なし・4コミット先行・遅れ0）。VercelのPRプレビュー・チェックpass（プレビューであり本番ではない）。Draft維持。
- **Cloudflareアカウント**：`wrangler whoami` により認証済み（OAuthトークン、Workers書込権限あり）＝ユーザー本人のアカウント `s.ide@zen-llc.co.jp`（Account ID `6b759fbb…c11f`）。**デプロイ可能な状態だが、本フェーズでは一切デプロイ・作成していない。**
- **`wrangler deploy --dry-run`（アップロードなし）成功**：バンドル 61 KiB（gzip 17.8）。デプロイで作成されるもの＝Worker 1個（`color-hide-realtime`）＋ Durable Object クラス 1個（`ColorHide`、v1 SQLiteマイグレーションで宣言、永続データは保存しない）。`--var` 値は出力でも "(hidden)" 表示（漏洩なし）。
- **本番／ステージング両方の deploy コマンドを dry-run で検証済み**（下記）。`--name` 上書きでステージング用の別Workerをトップレベル設定（DO binding＋migration）再利用で作成できることを確認。

## セキュリティ（最終）

- Secret必須＋dev拒否（DO＝`ENVIRONMENT=production`で空/dev値→接続拒否、アプリ`/catch`＝`VERCEL_ENV=production`で空/dev→403）。実値は非表示・非ログ・非コミット。
- WS接続認証（helloトークンをアプリで検証）、**Origin制限（ワイルドカード対応・`isOriginAllowed`を単体テスト、不正Originは接続前に403—実workerdでE2E）**、ルーム単位分離（1ルーム=1DO＋roomId形式検証＋hello.roomId一致）、隠れプレイヤー位置保護（受信者別フィルタ）、捕獲のサーバー検証（距離+視線、確定はシークレット経路）、レート制限（40msg/s）、接続数上限（6）。
- **古いDOメタでの誤判定防止（検証済み）**：捕獲も試合終了もアプリが最終権威。`/catch`（markCaught）は `phase==="seeking"` かつ対象が未捕獲hiderの時のみ有効で、それ以外は**no-op**（単体テスト追加：painting中の捕獲→phase不変・result無し・未捕獲）。すでに捕獲済みなら冪等no-op。よってDOのmetaが最大2.5s古くても、無効な捕獲や誤った試合終了は永続化されない。

## 限定公開（Preview）テスト計画 — 本番ユーザー非影響

**本番から完全分離した別スタック**で検証する（ワーカー・アプリ・Redisを分離）：

1. **ステージングWorker**（別名 `color-hide-realtime-staging`、別DO名前空間 → 本番Workerとライブ状態を共有しない）：
   `wrangler deploy --name color-hide-realtime-staging --var ENVIRONMENT:production --var COLOR_HIDE_APP_URL:<preview/staging app URL> --var 'COLOR_HIDE_ALLOWED_ORIGINS:https://*.vercel.app'` ＋ `wrangler secret put COLOR_HIDE_RT_SECRET --name color-hide-realtime-staging`（**本番とは別のステージング用シークレット**）。
2. **Vercel Preview 環境変数**（Vercelは Production/Preview を別管理）：Preview スコープに
   - `NEXT_PUBLIC_COLOR_HIDE_WS_URL = wss://color-hide-realtime-staging.<subdomain>.workers.dev`
   - `COLOR_HIDE_RT_SECRET =`（ステージング用・同値をWorkerにも）
   - **`KV_REST_API_* = 別途用意したPreview専用 Upstash DB`**（本番Redisと分離＝テストルームが本番データに混ざらない）。
3. **Origin許可**：Preview URL は動的なので `https://*.vercel.app`（またはより厳しく `https://game-box-*-shouhis-projects.vercel.app`）をステージングWorkerの許可リストに設定（ワイルドカード対応済み）。
4. **テスト手順**：Preview URLを数名に共有 → 2〜6人で対戦・ペイント・捕獲・勝敗・再戦・再接続を確認。Preview の DO は staging app（別Redis）を読むため、**本番ルーム・本番ユーザーに一切影響しない**。
5. **分離の保証**：本番Worker・本番アプリ・本番Redis は上記のどの操作でも**不変**。ステージングは別Worker＋別デプロイ＋別DB。
6. **テスト終了後の停止**：新規停止 `wrangler deploy --name color-hide-realtime-staging --var COLOR_HIDE_REALTIME_ENABLED:0` ／ 撤去 `wrangler delete --name color-hide-realtime-staging`（本番に無影響）。

## デプロイコマンド（手順・要承認・未実行）

**第1段階（本番Worker）**
```bash
wrangler login && wrangler whoami                      # アカウント確認（本人：s.ide@zen-llc.co.jp）
# Workers Paid プラン有効化を確認（本番はHobby不可）
wrangler secret put COLOR_HIDE_RT_SECRET --config cloudflare/color-hide/wrangler.toml   # 強いランダム値
wrangler deploy --config cloudflare/color-hide/wrangler.toml \
  --var ENVIRONMENT:production \
  --var COLOR_HIDE_APP_URL:https://zen-gamebox.vercel.app \
  --var COLOR_HIDE_ALLOWED_ORIGINS:https://zen-gamebox.vercel.app   # 初回でv1 migration適用
curl https://color-hide-realtime.<subdomain>.workers.dev/health     # → ok
```
**第2段階（ステージング＋Preview）** … 上記「限定公開テスト計画」参照。
**第3段階（本番公開）** … Vercel本番に `NEXT_PUBLIC_COLOR_HIDE_WS_URL=wss://color-hide-realtime...` と `COLOR_HIDE_RT_SECRET`（同値）を設定・再デプロイ → PR #5 を main にマージ。

## 停止 vs 削除（明確に区別）

| 操作 | 種別 | 影響 | 可逆性 |
|---|---|---|---|
| `--var COLOR_HIDE_REALTIME_ENABLED:0` + deploy | **停止**（新規接続のみ） | 新規WS→503、既存は継続 | 即復帰（再deploy） |
| `wrangler rollback [<version>]` | **切り戻し** | 既存接続も切断、前バージョンへ | 可逆（再rollback/deploy） |
| `wrangler delete` | **削除（最終手段）** | Worker/DO撤去、全切断 | 再deployで再作成（DOは空から） |
| Vercel env解除＋再デプロイ | 配信停止 | 新規ページのみ（既存タブはリロードまで旧URL） | 再設定＋再デプロイ |

削除（`wrangler delete`）は最終手段。通常は「停止（REALTIME_ENABLED=0）」→「切り戻し（rollback）」の順。いずれも **Redis/Upstashデータは不変**、DOは永続データ無しのため切断時も位置情報のみ消失・アプリ権威状態から継続。

## コスト（再掲・2026-11-17）

Cloudflare DO：100試合 $5 ／1,000 ~$5 ／10,000 ~$7（送信・帯域非課金、永続化なし）。支配的変動費はポーリング由来の Vercel Functions（Pro $20/席＋従量）＋Upstashコマンド（PAYG $2/1M）。合計概算：100=$5〜25、1,000=~$30、10,000=~$65〜75。無料枠は商用不可＆10k試合で超過（Vercel 1M呼び出し／Upstash 500K cmd）。予算管理：Vercel Spend Management・Upstash予算上限・Cloudflareアラート（ハード上限は無し＝要確認）。**課金操作は未実施。**

---

# Phase 6 — Cloudflareステージング構築・実機対戦テスト（2026-11-18）

**承認範囲内で実施：ステージングWorker作成・DO作成・専用Secret生成/設定・ステージングへのデプロイ・実機対戦テスト。** 本番Workerデプロイ／Workers Paid変更／Vercel本番変更／本番Redis書込み／mainマージは**一切なし**。

## CLOUDFLARE（ステージング）
- Worker：**`color-hide-realtime-staging`** → **https://color-hide-realtime-staging.s-ide.workers.dev**（health 200、実インターネット）。アカウント：ユーザー本人（`s.ide@zen-llc.co.jp`）。
- Durable Object：`ColorHide`（SQLiteクラス、v1 migration適用、**永続データ0件**）。本番Workerとは別名＝**別DO名前空間**（本番Workerは未作成）。
- **Workers Free で SQLite-backed DO が動作することを実deployで確認**（Paidへの変更なし・課金発生なし）。初回deployはeventual-consistencyで一度10007エラー→再deployで `s-ide.workers.dev` サブドメイン付与・成功。
- 専用Secret `COLOR_HIDE_RT_SECRET` を生成・`wrangler secret put`（stdin経由、**値は非表示・非ログ・非コミット**）。`ENVIRONMENT=production` で本番同等のSecret強制。
- テスト後は `COLOR_HIDE_APP_URL=https://placeholder.invalid` に再設定し**無害な待機状態**で残置（再テスト用）。削除はしていない。

## 分離（本番非影響）
実対戦テストは **ngrokトンネル経由のローカル・メモリストアapp**（`REVERSI_MEMORY_STORE=1`、Redis資格情報を空に）で実施 → **本番Upstash Redisに一切アクセスせず**。Vercel本番/Preview envは未変更、本番Worker未作成。ローカルの`.env.local`には本番KV資格情報があるため、プロセスenvで空上書きして memory store を強制（Nextは既存process.envを上書きしない仕様）。

## MULTIPLAYER TESTS（デプロイ済みWorkerに対し実インターネットで16/16 PASS）
2人：作成+参加 / ロール割当 / welcome / **情報漏洩なし（鬼は隠れhider座標を受信しない）** / hiderは鬼を常に受信 / **アンチテレポート（クランプ）** / **捕獲→鬼勝利**。セキュリティ：**不正トークン拒否** / **不正Origin拒否**。6人：**7人目拒否(409)** / 鬼1+隠れ5 / 全員welcome。**クロスルーム分離** / **ペイント共有** / **再接続**。
ブラウザ実機（ngrok配信UI → デプロイ済みedge Workerにwss接続）：preparing→painting→hiding→seekingと進行、3Dシーン描画、"RT未接続"なし＝**デプロイ済みWorkerにライブ接続**を確認。

## PERFORMANCE（実測）
WS接続確立 ~330ms（TLS+edge込み）。スナップショット ~14.5Hz（6人で1クライアント2秒29件/17.6KB ≈ 8.8KB/s）。ローカルworkerd計測と整合。FPSは前フェーズのPC実測（120fps/3マップ）を踏襲、スマホ実機は未計測。

## COST（実測ベース）
テスト総量は数百リクエスト＋数分のDO稼働＝**Workers Free日次上限（10万req/日・1.3万GB-s/日）に対し誤差レベル**。DO保存0件＝storage課金なし。**想定外課金リスクなし**。本番でのWorkers Paid要否：低頻度（〜1,000試合/月）はFree日次枠内で可、1万試合/月（≈53万req/日）はFree日次上限超過→Paid必要。ステージング/初期公開はFreeで十分。

## 残課題（本番公開=第3段階へ）
- 第3段階（要承認）：本番Worker `color-hide-realtime` のデプロイ、Vercel **Production** env（`NEXT_PUBLIC_COLOR_HIDE_WS_URL`/`COLOR_HIDE_RT_SECRET`）設定、PR #5 の main マージ。
- Vercel Previewでの**恒久的**ステージング運用には、ステージング専用 Upstash DB の作成（無料枠）＋ game-box プロジェクトの Preview スコープ env 設定が必要（本番Redis分離のため）。今回は本番Redis汚染回避のためトンネル方式で代替。
- 再テスト時は staging Worker の `COLOR_HIDE_APP_URL` を到達可能な分離appへ再設定（ngrok URLは揮発性）。

---

# Phase 7 — 本番公開前の最終準備・リリース計画（2026-11-18）

**今回の実施範囲：調査・設定確認・安全なローカル修正・テスト・Draft PR更新のみ。** 本番デプロイ／Production env変更／課金プラン変更／mainマージは**未実施**。

## VERCEL PROJECT（確認済み）
- アカウント：`shouhi` ／ Team：**shouhis-projects**（hobbyプラン、orgId `team_Xk3VLZ9d5yHyURyRyrXe9rEN`）。
- 本番プロジェクト：**game-box**（Project ID **`prj_YNs2Ut1Z8vZglPb1enDEPiNlRM2T`**）、Production URL **https://zen-gamebox.vercel.app**、Next.js、Node 26.x。GitHub連携でPRプレビュー＆mainの自動Productionデプロイ。
- **ローカル `.vercel` 修正済み**：以前は `projectName: reversi-online`（プロジェクトはID同一のまま game-box へ改名されていた）。`vercel link --project game-box --scope shouhis-projects` でローカルリンクのみ修正（`.vercel` は **.gitignore 済み**＝未コミット）。この操作は**デプロイもenv変更も発生させない**（確認済み）。副作用として gitignore 対象の `.env.local` の `VERCEL_OIDC_TOKEN` がローカル更新されたのみ（本番無影響）。
- **環境変数スコープ（重要）**：`KV_REST_API_*`/`KV_URL`/`REDIS_URL` は **Production・Preview・Development 全スコープ共有**＝**PreviewもProductionと同じUpstash Redisを使用**。よってPreviewでのテストはProd Redisを汚染する（Phase 6でトンネル方式にした根拠）。`COLOR_HIDE_*`・`NEXT_PUBLIC_COLOR_HIDE_WS_URL` は**全スコープ未設定**（公開時にProductionへ追加が必要）。

## CLOUDFLARE（本番Worker設定計画・未作成）
- 本番Worker `color-hide-realtime`（予定URL **https://color-hide-realtime.s-ide.workers.dev**）は**未作成**。ステージング `color-hide-realtime-staging` とは別名＝**別DO名前空間で完全独立**（確認済み）。
- 本番の環境変数（値はPhase 8で設定、ここには値を書かない）：

| 変数 | 設定先 | 値/スコープ | 公開範囲 |
|---|---|---|---|
| `ENVIRONMENT` | Worker var | `production`（Secret強制を有効化） | 公開可 |
| `COLOR_HIDE_APP_URL` | Worker var | `https://zen-gamebox.vercel.app` | 公開可 |
| `COLOR_HIDE_ALLOWED_ORIGINS` | Worker var | `https://zen-gamebox.vercel.app`（独自ドメイン追加時は追記） | 公開可 |
| `COLOR_HIDE_REALTIME_ENABLED` | Worker var | 省略（既定=有効）。緊急停止時のみ `0` | 公開可 |
| `COLOR_HIDE_RT_SECRET` | **Worker secret** (`wrangler secret put`) | 強いランダム値。**Vercelと同値** | **秘匿・出力禁止** |
| `NEXT_PUBLIC_COLOR_HIDE_WS_URL` | **Vercel Production env** | `wss://color-hide-realtime.s-ide.workers.dev` | 公開可（クライアントに焼込） |
| `COLOR_HIDE_RT_SECRET` | **Vercel Production env** | 上記Workerと同値 | **秘匿** |

## FREE PLAN（最新確認 2026-11-18・無料で開始可）
- Workers Free：**100,000 req/日**（00:00 UTCリセット、超過は Error 1027＝日次上限で翌日復帰、月次ロックではない）。CPU 10ms/req、128MB。
- Durable Objects on Free：**SQLite-backed DO 利用可**（KVバックエンドは有料のみ→本実装はSQLiteで適合）。**100,000 DO req/日 + 13,000 GB-s/日**（Workerとは別枠、日次リセット）。SQLite保存 5GB/5M行読/10万行書（本実装は保存0＝無料）。
- WS課金換算：接続=1req、**受信メッセージ 20:1**、**送信・pingは無料**。
- 時間課金：稼働秒×128MB。**15Hzの`setInterval`ループは対戦中ずっと"稼働"＝duration課金される**（ハイバネは対戦中は効かない）。→ **本実装は最後の接続が切れた時にintervalを停止**（`stopTick`）するので放置ルームは課金継続しない（確認済み・良好）。
- **判定**：〜1,000試合/月はFreeで安全（duration ~1,280 GB-s/日 ≪ 13,000枠）。**律速は受信メッセージ(20:1)**：現状クライアントは約18Hzで送信＝1試合 約1,620課金req → **1日あたり約60試合でDO 10万req/日 に到達**。**低頻度のホビー公開はFreeで十分**。超えたら Workers Paid（$5/月、10M Worker req＋400k GB-s/月）。
- **Free枠を広げる将来の最適化（今回は未実施・安定優先）**：クライアント送信をイベント駆動化（移動/視点変化時のみ＋停止時は低頻度ハートビート）すれば受信reqが激減し、1日の試合上限が大幅に上がる。サーバー送信は無料なので描画は現状維持可。

## RELEASE ORDER（安全な公開順序）
> 鉄則：`NEXT_PUBLIC_COLOR_HIDE_WS_URL` は**ビルド時にクライアントへ焼込**。Vercel Production envは**mainマージ（＝自動ビルド）より前**に設定する。自動Productionデプロイ（GitHub連携）があるので**手動 `vercel --prod` は実行しない**（二重デプロイ回避）。

1. **Cloudflare 本番Worker作成**：`wrangler deploy --config cloudflare/color-hide/wrangler.toml --var ENVIRONMENT:production --var COLOR_HIDE_APP_URL:https://zen-gamebox.vercel.app --var COLOR_HIDE_ALLOWED_ORIGINS:https://zen-gamebox.vercel.app`（Worker名はwrangler.tomlの `color-hide-realtime`）。
2. **Secret設定**：`wrangler secret put COLOR_HIDE_RT_SECRET`（強ランダム、stdin）。
3. **Worker動作確認**：`curl https://color-hide-realtime.s-ide.workers.dev/health` → `ok`（この時点でクライアントはまだ未接続＝安全）。
4. **Vercel Production env 設定**：`NEXT_PUBLIC_COLOR_HIDE_WS_URL=wss://color-hide-realtime.s-ide.workers.dev` と `COLOR_HIDE_RT_SECRET`（Workerと同値）を**Productionスコープのみ**に追加（env設定だけでは再デプロイされない＝現行本番は不変）。
5. **Draft解除 → mainマージ**：→ GitHub連携が game-box Production を自動ビルド＆デプロイし、手順4のWS URLが焼き込まれる。
6. **自動デプロイ完了を待機**（Vercelダッシュボードで確認、手動再デプロイはしない）。
7. **公開後スモークテスト**（下記）。
8. 異常時は**ロールバック**（下記）。

アプリがWS URL付きで公開される時点（手順6完了）には本番Workerは既に稼働（手順1-3）→ **ユーザーが対戦開始時に死んだWorkerに当たらない**。ロビー/ペイント/結果はHTTPなのでWorker未準備でも壊れない（グレースフル）。さらに慎重にするなら、COLOR HIDEを一旦 `coming-soon` でマージ→直URLで検証→`available` に切替、の2段も可（現ブランチは `available`）。

## SECRETS（安全な取り扱い・今回は生成/設定しない）
- `COLOR_HIDE_RT_SECRET`：`openssl rand -base64 33` 等の十分強いランダム値。**同一値**をCloudflare Worker（`wrangler secret put`）とVercel Production env の両方へ。
- **出力・コミット禁止**：wranglerは stdin 経由（`wrangler secret put ... < file` 等、`--var` で渡さない）。Vercelはダッシュボード貼付 or `vercel env add`（値は対話入力、コマンド行に残さない）。値をログ・チャット・GitHubに出さない。設定後は生成元ファイルを破棄。ローテーション時は両側を同時更新。

## SMOKE TESTS（公開後必須・https://zen-gamebox.vercel.app）
サイト表示／COLOR HIDE が一覧に表示／ルーム作成／招待URL共有／2人参加／ペイント＆同期／3D空間表示／WS接続（"RT未接続"が出ない）／移動同期／捕獲／勝敗判定／再戦／切断・復帰／**既存ゲーム（リバーシ等7本）が正常**。
**停止基準**：既存ゲームに不具合＝即ロールバック。COLOR HIDE が WS 恒常接続不可／情報漏洩・不正捕獲の兆候／Error 1027頻発＝COLOR HIDE停止（REALTIME_ENABLED=0）。軽微（たまにRT未接続）＝監視継続。

## ROLLBACK（緊急停止・復旧）
- **新規接続停止**：`wrangler deploy ... --var COLOR_HIDE_REALTIME_ENABLED:0`（新規WS→503、既存は継続）。
- **既存WS停止**：`wrangler rollback`（前バージョン）／最終手段 `wrangler delete`（全切断）。削除は最後。
- **Vercel本番復旧**：Vercelダッシュボードで**直前のProductionデプロイに即ロールバック（Instant Rollback）**、または `NEXT_PUBLIC_COLOR_HIDE_WS_URL` を外して再デプロイ（※焼込のため再ビルド必要＝即時ではない。即時はCloudflare側 or Vercel Instant Rollback）。
- **Secret再設定/ローテーション**：Worker と Vercel Production を同時更新→Worker再デプロイ＋Vercel再デプロイ。
- **利用者表示**：WS不通時はクライアントが「RT未接続」バッジ表示＋ロビー/ペイント/結果はHTTPで継続。
- **既存ゲーム**：COLOR HIDE は別slug/API/Workerで分離＝ロールバック操作の影響を受けない。**Redis本番データは削除しない**（DOは永続データ無しのため切断時も位置情報のみ消失、ルーム状態はRedis権威で保持）。

---

# Phase 9-D — リリース・リカバリ（安全な再デプロイ基盤）（2026-11-18）

**今回の実施範囲：調査・設定ファイル追加・テスト追加・ドキュメント・Draft PR更新のみ。** 本番Workerデプロイ／本番Secret変更／Vercel本番env変更／本番再デプロイ／mainマージ／Draft解除は**未実施**。Cloudflare本番設定の確認は**読み取り専用**（名前と非秘匿値のみ。Secretは存在有無のみ確認、値は取得・表示していない）。

## 背景：なぜ単純な「マージ＋Vercelデプロイ」が危険か
Phase 9-D の変更（`net/realtime.ts`／`lib/balance.ts`／`lib/constants.ts`／`lib/maps.ts`）は **Cloudflare Worker にもコンパイルされて載る**（`cloudflare/color-hide/src/party.ts` が `src/games/color-hide/net/realtime.ts` を import）。したがって：
- **観戦情報漏洩の修正はサーバー（Worker）側**にある。Vercel だけ更新しても **Worker 側の漏洩は直らない**。
- 鬼速度 1.15×・新マップの当たり判定/遮蔽も **Worker 側の権威判定**。クライアントだけ新しくすると判定とズレる。

さらに、既存の本番デプロイ手順（Phase 7 の `wrangler deploy --config wrangler.toml --var ...`）は、**`--var` を1つでも付け忘れると `wrangler.toml` の開発用 [vars]（`ENVIRONMENT=development`／`http://localhost:3100`／空オリジン）が本番へ上書き**され、本番が即死する（`wrangler deploy` は `--keep-vars` なしだと平文varsを全削除→configの値を再適用する仕様）。Secret は別管理で消えないが、この平文vars上書きリスクが残っていた。

## 対策：本番専用config＋安全デプロイラッパ（構造的に事故れない）
- **`cloudflare/color-hide/wrangler.production.toml`（新規）**：本番の非秘匿varsを**固定**（`ENVIRONMENT=production`／`COLOR_HIDE_APP_URL=https://zen-gamebox.vercel.app`／`COLOR_HIDE_ALLOWED_ORIGINS=https://zen-gamebox.vercel.app`）。Worker名・DOクラス・migration tag(`v1`) は `wrangler.toml` と同一＝**既存Workerを対象にし、新規migrationを増やさない**。Secretは**書かない**（`wrangler secret` が永続）。`COLOR_HIDE_REALTIME_ENABLED` は**省略＝既定で有効**（＋万一の緊急停止値 `0` もクリーンデプロイで消える）。
- **`cloudflare/color-hide/deploy-production.sh`（新規, 実行可）**：唯一の正規デプロイ経路。無引数＝**dry-run（アップロードなし）**、`--go`＝本番デプロイ、`--stop`＝`REALTIME_ENABLED:0`（新規WS→503, 既存は継続）、`--resume`＝クリーン再デプロイ。preflight で **アカウント（`6b759fbb864b86c1189a3fb6a5f2c11f`）／対象Worker名／`COLOR_HIDE_RT_SECRET` の存在**を検証し、一致しなければ中止。
- **`src/games/color-hide/lib/wranglerConfig.test.ts`（新規, 6 tests）**：設定ドリフトの番兵。dev configがdev値のまま／prod configがprod値（本番は開発マーカーを含まない・コメントは除外）／Secret値を保存していない／Worker名一致／DOクラス・migration tag一致、を assert。
- **dry-run実証済み**（アップロードなし）：`./deploy-production.sh` が `env.ENVIRONMENT ("production")`／`env.COLOR_HIDE_APP_URL ("https://zen-gamebox.vercel.app")`／`env.COLOR_HIDE_ALLOWED_ORIGINS ("https://zen-gamebox.vercel.app")` を出力。開発値は一切載らないことを確認。

## 情報漏洩修正の評価（サーバー権威・クライアント隠蔽だけではない）
`net/realtime.ts` の `buildSnapshot` で、**捕獲済み（観戦）プレイヤーの受信スナップショットから未捕獲の隠れ役を除外**（`recipientIsActiveHider` のときだけ他隠れ役を含める）。鬼は公開情報なので観戦者も見える。**実DO（ローカルworkerd）でのE2Eで実証**（下記テスト10）：捕獲された隠れ役Aのスナップショットに未捕獲の隠れ役Bが**一度も現れず**、鬼は現れる。クライアント側の非表示ではなく**サーバーが送らない**＝仕様（「クライアント側で非表示にするだけの対策は禁止」）を満たす。新規プロトコルは追加していない（ワイヤ形状不変）。

## 新旧混在の互換性マトリクス（Worker × Client）
ワイヤ形状（スナップショット/入力）は**不変**（スペクテイター除外も速度も当たり判定もサーバー内部計算で、プロトコル追加なし）。よって解析エラーは起きない。差は「ゲーム体感」のみ。

| | **旧Client**（現本番） | **新Client**（PR #9） |
|---|---|---|
| **旧Worker**（現本番） | ✅ 現状（正常） | ❌ **危険**：鬼速度が新Clientは1.15×予測→旧Workerはbase上限でラバーバンド／新Clientが描く新障害物を旧WorkerのLOSは知らず遮蔽ズレ／**観戦漏洩が未修正のまま**。→ **Vercel先行デプロイは禁止** |
| **新Worker**（PR #9） | ⚠️ **許容（一時的）**：旧Clientはbase速度送信＝新上限内でOK／**漏洩は即修正**／旧Clientは新障害物を描かないので新Workerの当たり判定で「見えない壁」程度の軽微な一時ズレ。Workerデプロイ→Vercelビルド完了までの数分のみ | ✅ **目標状態**（全テスト合格） |

**結論＝デプロイ順序は Worker 先行 → Vercel（main マージ）後追い。** これにより「旧Worker×新Client」（危険セル）には**決して入らない**。間に入る「新Worker×旧Client」は許容範囲の一時状態。`NEXT_PUBLIC_COLOR_HIDE_WS_URL` は Phase 7/8 で設定済み＝**今回Vercel env変更は不要**。

## テスト結果（ローカル検証 vs Cloudflareデプロイ検証を区別）
**すべてローカル検証**。本番Cloudflareへのデプロイ検証は**未実施（承認待ち）**。
- `typecheck` ✅ ／ `cf:typecheck` ✅ ／ `lint` ✅
- `npm test`（vitest）✅ **522 tests / 34 files**（新 `wranglerConfig.test.ts` 6件・`balance`・`maps`・`roomService`・`realtime` 含む）
- `npm run build` ✅
- `npm run test:e2e`（chromium）✅ **26 passed**（既存7ゲーム含む）
- `npm run test:partyserver`（**実workerd＋実WebSocket＋メモリストア**）✅ **10 passed**。新テスト10＝観戦セキュリティ（実DOで捕獲後に未捕獲隠れ役が漏れないこと）。
- `deploy-production.sh` **dry-run**（アップロードなし）で本番vars固定を実証。

> 区別：上記は**ローカルworkerdで検証**した内容。実Cloudflare本番Workerランタイム・実インターネット経路・本番Secret経路での検証は、デプロイ承認後の公開後スモークテストで行う（未実施）。

## RELEASE PLAN（順序・要承認・未実行）
> 前提：本番Worker `color-hide-realtime` は既に稼働中（Phase 8で作成済み・現在は旧コード）。今回は**更新デプロイ**。Vercel `NEXT_PUBLIC_COLOR_HIDE_WS_URL`／`COLOR_HIDE_RT_SECRET` は設定済み＝env変更なし。

1. **（任意・推奨）メンテ停止**：`./deploy-production.sh --stop`（新規WS→503, 既存対戦は継続）。短時間なら省略可。
2. **Worker 先行デプロイ**：`./deploy-production.sh`（dry-run で再確認）→ `./deploy-production.sh --go`。本番varsは固定・Secretは保持・新規migrationなし。
3. **Worker 動作確認**：`curl https://color-hide-realtime.s-ide.workers.dev/health` → `ok`。`wrangler deployments list` で新バージョンを確認。
4. **（1を実施した場合）再開**：`./deploy-production.sh --resume`。
5. **Draft解除 → PR #9 を main へマージ**：GitHub連携が game-box Production を**自動ビルド＆デプロイ**（手動 `vercel --prod` はしない）。
6. **自動デプロイ完了待ち**（Vercelダッシュボード）。この間だけ「新Worker×旧Client」＝許容の一時状態。
7. **公開後スモークテスト**（Phase 7 の SMOKE TESTS 全項目＋観戦漏洩なし＋鬼速度の体感＋新マップ障害物の遮蔽＋既存7ゲーム正常）。
8. 異常時は下記ロールバック。

## ROLLBACK PLAN（緊急停止・復旧）
- **新規接続のみ停止**：`./deploy-production.sh --stop`（`REALTIME_ENABLED:0`＝新規WS 503・既存継続）。
- **Workerコードを前版へ**：`wrangler rollback`（本番Worker・直前バージョン＝旧コードに戻る）。これで「旧Worker」に戻るため、**同時にVercelも旧Clientへ戻す**（下記）こと＝危険セル回避。
- **Vercel本番を前版へ**：Vercelダッシュボードの **Instant Rollback** で直前Productionデプロイ（旧Client）に即時復帰。
- **順序（整合性維持）**：巻き戻しは **Vercel先（旧Client）→ Worker後（旧Worker）** が安全（「新Worker×旧Client」は許容、「旧Worker×新Client」は回避）。緊急時にまず止めたいだけなら `--stop` で新規接続遮断が最速。
- **最終手段**：`wrangler delete`（全切断）は最後。**Redis本番データは削除しない**（DOは永続データ無し＝切断で位置情報のみ消失、ルーム状態はRedis権威で保持）。
- **既存ゲーム**：別slug/API/Workerで分離＝ロールバック操作の影響なし。

---

# Phase 9-E — WebSocket通信最適化（netcode）（2026-11-18）

**今回の実施範囲：調査・計測・ネットコード改善・テスト・ドキュメント・Draft PRのみ。** 本番Worker/Vercelデプロイ・mainマージ・Secret/Redis変更・Workers Paidは**未実施**。ブランチ `perf/color-hide-netcode`。

## 9-E1 現状分析（変更前）
Cloudflareは**受信（client→Worker）WebSocketメッセージを20:1で課金**（送信・pingは無料）。よってコストの律速は**各クライアントの送信頻度**。

- **client → Worker（課金対象）**：旧クライアントは `GameScene` の `useFrame` で**固定18Hz**（`SEND_INTERVAL=1000/18`）を**無条件**送信。移動中も**停止中も同じ**。60fpsのフレームゲート＋accumulatorゼロリセットのため**実効は約15Hz**。変化検知・ハートビート区別・デッドゾーンなし。`seq` 単調増加（サーバーは `seq<=last` を破棄）。
- **Worker → client（無料）**：`NET_TICK_HZ=15` の受信者別フィルタ済みスナップショットを毎tick全員へ。
- **Worker → Vercel**：メタ更新2.5s間隔（失敗時指数バックオフ）、catch/authは稀。
- **結論**：かくれんぼでは隠れ役が長時間静止するのに18Hz送信＝純粋な無駄。**最適化対象は送信頻度**。送信は「状態」同期（結果位置を送りサーバーが再検証）で、ワイヤ形式は `InputMsg`。

## 9-E3/4 実装（ハイブリッド送信＋サーバーfailsafe・**プロトコル非変更**）
- **`lib/inputSend.ts`（新規・純粋・単体テスト済）** `planInputSend(prev, cur, dtSince)`：
  - **event**：移動開始/停止・走行・しゃがみ/ポーズ変化で即時（`INPUT_EVENT_MIN_INTERVAL_MS=50`＝20Hz上限でバースト抑制。**停止は最優先**で≤50msで送出、旧55msより速い）。
  - **move**：連続移動/視点変更は位置/ヨーがデッドゾーン（`INPUT_POS_EPSILON=0.03` / `INPUT_YAW_EPSILON=0.02`）超過かつ `INPUT_MOVE_SEND_INTERVAL_MS=100`（10Hz）経過時のみ。
  - **heartbeat**：無操作時は `INPUT_HEARTBEAT_MS=1000`（1Hz）でキープアライブ＋ロス後の再同期。
  - 微小なアナログ揺れ（エプシロン未満）は送信しない。
- **`GameScene.tsx`**：固定送信を `planInputSend` に置換。**ローカル予測は従来どおり毎フレーム**＝自分の操作感は不変。(再)接続時は送信済みサンプルを破棄し即再同期。
- **サーバーfailsafe（`realtime.ts` tick）**：送信が疎になったため、**「停止」パケットがロスすると歩行/走行アニメが残る**恐れ。`INPUT_STALE_MS=2500` 無入力で移動アニメ（walk/run）を停止アニメへ矯正（`stoppedAnimFor`）。位置はそもそも入力なしでは動かない（サーバーは勝手に動かさない）ので**追加的・安全**。正常送信のクライアント（旧18Hz含む）では**決して発火しない**。
- **セキュリティは不変**：`validateMove`（反テレポート・速度上限・鬼1.15×）、衝突・境界、捕獲距離/FOV/LOS、レート制限（40/s）、**観戦者の移動禁止**、**非公開プレイヤーのスナップショット除外**をすべて維持。

## 9-E2/11 計測（実測 vs 試算を明示）
**実測（measured）**
- 送信レート（純粋プランナの決定論replay＝実コードで算出。受信==送信の1:1）：

| 条件 | Before(実効) | After | 削減 |
|---|---:|---:|---:|
| 停止時 | 〜15 Hz | **〜1 Hz** | **−93%** |
| 移動時 | 〜15 Hz | **〜10 Hz** | **−33%** |

- **実ソケット（local workerd + 実WebSocket + 実DO）**：混在シナリオ（2s静止→3s移動→1s静止）で `plannerSends=32` vs `legacySends=87` ＝ **−63%**、観戦者スナップショットでmover移動量 range=1.71 を観測＝**サーバーが実移動を正しく中継**（操作感維持）。
- 実ブラウザ（ローカル・local RT host）：2人ルームで鬼視点の3Dシーン描画・WS「接続済み」・WASD移動・視点ドラッグ・しゃがみ動作、**コンソールエラーなし**を確認。新マップ障害物も描画。

**試算（estimate・活動プロファイルは仮定）** 5分=295s（preparing5/painting60/hiding30/seeking180/result20）。DO課金req = ⌈受信/20⌉ + 接続数。

| 試合 | 受信(After) | 受信(Before) | DO req After | DO req Before | 削減 |
|---|---:|---:|---:|---:|---:|
| 2人 idle-heavy | 2,060 | 8,850 | 105 | 445 | −76% |
| 6人 idle-heavy | 4,800 | 26,550 | 246 | 1,334 | −82% |
| 2人 move-heavy | 5,370 | 8,850 | 271 | 445 | −39% |
| 6人 move-heavy | 16,110 | 26,550 | 812 | 1,334 | −39% |

## 9-E6 Cloudflare Freeプラン（点-in-time 2026-11-18・launch前要再確認）
Free：Workers 100,000 req/日、**DO 100,000 req/日**＋13,000 GB-s/日、WS受信20:1・送信/ping無料。
- **1日の試合数上限（6人 idle-heavy・DO req律速）**：After **〜406試合/日** vs Before 〜74試合/日（**約5.5倍**の余裕）。
- **悪条件（6人 move-heavy）**でも After **〜123試合/日** vs Before 〜74。
- 月間（6人 idle-heavy）：1,000試合＝After 246,000 req / Before 1,334,000 req。
- **誇張しない**：pathological（毎フレームで走行/しゃがみ連打）なら event上限20Hzに達し旧15Hzを上回り得るが、非人間的操作であり**40/s のレート制限が従来どおり上限を担保**（新たな濫用面はない）。duration課金は `stopTick`（最終接続切断で停止）のまま。

## 9-E8 バージョン互換性（**プロトコル非変更＝両方向安全**）
ワイヤ形式（`InputMsg`/スナップショット）不変・新メッセージ型なし。差は送信頻度＋サーバーの加算的anim failsafe（正常送信では無発火）だけ。

| | 旧Client | 新Client |
|---|---|---|
| 旧Worker | ✅現状 | ✅ 新Clientは送信が疎になるだけ／旧Workerは可変入力タイミングを従来どおり処理 |
| 新Worker | ✅ 旧Clientは18Hz送信＝failsafe無発火・従来挙動 | ✅ 最適（全テスト合格） |

→ **Worker先行・Client先行どちらでも安全**。既存タブが旧Clientのまま残っても問題なし。これがPhase 9-D（サーバー権威の修正が載るため順序制約あり）との大きな違い。

## 9-E RELEASE PLAN（要承認・未実行）
段階的公開は不要（どちらの順序でも安全）が、慣例どおり：
1. `./deploy-production.sh`（dry-run）→ `--go`（Worker更新。anim failsafeが入る）。
2. `curl .../health`=ok。
3. PR `perf/color-hide-netcode` を main へマージ → Vercel自動デプロイ（新Client）。
4. 公開後スモーク（移動/停止の即応・6人・観戦漏洩なし・既存ゲーム）＋Cloudflare利用量が低下していることを数日観測。
ロールバックはPhase 9-Dと同様（Worker `wrangler rollback` / Vercel Instant Rollback）。どの中間状態も互換なので緊急時の順序制約は緩い。

## 9-E 品質ゲート（全PASS・ローカル）
typecheck / cf:typecheck / lint / **vitest 543**（新 inputSend 16・realtime failsafe+spectator-move 等）/ build / **test:e2e 26** / **test:partyserver 11**（新 netcode 実測 −63% 含む）。テストの削除・無効化・スキップなし。

---

# Phase 10 — ワールド内ペイント・擬態システム（2026-11-18）

**今回の実施範囲：設計・実装・テスト・実ブラウザ検証・ドキュメント・Draft PRのみ。** 本番Worker/Vercelデプロイ・mainマージ・Secret/Redis変更は**未実施**。ブランチ `feat/color-hide-world-paint`。

## コンセプト転換
従来：ペイント画面で先に塗る → ワールドへ入る（何色に塗ればいいか分からない）。
Phase 10：**ワールドに入る → 隠れ場所を選ぶ → その場で周囲の色に合わせてペイントする → 鬼が探す。** ペイントは事前カスタマイズではなく、ゲーム中の戦略的アクションに。

## ゲームフロー変更（後方互換を優先）
`Lobby → Preparing → Hiding & Painting → Seeking → Result`。
- **独立した Painting フェーズは新規ラウンドで廃止**。`phases.ts` の `LINEAR_NEXT[preparing]="hiding"` で直接 hiding へ。
- **`"painting"` は型・`LINEAR_NEXT`（painting→hiding）・`PAINTING_MS` を残置**：デプロイ時に painting 中だったルームも安全に hiding へ進める（フェーズ削除はしない＝危険回避）。
- `HIDING_MS` を 30s → **120s**（旧 painting 60s + hiding 30s を吸収＋3D内で場所探し・色採取の分。設計目標値）。
- `hidersCanMove(hiding)` は従来どおり true＝隠れ役は hiding 中に移動可。

## ワールド内ペイントUI（既存PaintStudio/PaintEngineを再利用）
- `RoundView` が hiding 中の隠れ役に **「🎨 ペイント」ボタン**を表示。押すと **ライブの3Dワールドの上にオーバーレイ**で `PaintStudio` を開く（ワールドは背後に dim 表示＝消さない）。
- 既存 `PaintEngine`（256px UVアトラス・PNG・48KB上限・UVクリッピング・Undo）をそのまま使用。パーツ別描画・色選択・ブラシ・消しゴム・全体塗り・Undo・全消去・回転・3Dプレビューを継承。

## 移動／ペイントのモード切替（入力競合・押しっぱなし防止）
- `GameScene` に `inputLocked` prop を追加。オーバーレイを開くと：押下中キーを **keysRef.clear()** で解放、`move/look/running` をゼロ化、キーボード down/up と視点ドラッグを無視、`moving=false`。→ 「モード切替時の入力押しっぱなし」バグを構造的に防止。閉じると移動モードへ復帰。

## 周囲の色に合わせて塗る（スポイト）
- `maps.ts` の `mapPalette(mapId)` が、**描画で実際に使われるマテリアル色**（`MapScene`：壁=theme.wall / 床=theme.floor / 家具=theme.accent）を「壁 / 床 / 家具」としてラベル付きで返す。
- オーバーレイに **「周囲の色（タップで吸い取り）」** パレットとして表示＝タップで隠れ場所の色を採取して塗れる。
- **マテリアルカラー方式**（軽量・決定論的・照明非依存）を採用。静的なマップ定義のみ由来で、**隠れ役の位置・非公開プレイヤー情報は一切使用しない**。

## ペイント同期・保存（サーバー権威・既存機構維持）
- 確定は既存 `apiCommitPaint`（`x-color-hide-token` 認証・`validatePaintPayload`・48KB上限・1/s レート制限・CAS 保存・`color-hide:paint:` 名前空間）をそのまま使用。
- 確定成功で **自分のテクスチャを即時反映**（`paints[myId]` 更新→GameScene 再描画）。
- **タイマー終了時の自動確定**：`PaintStudio` が残り5秒で現在のテクスチャを一度だけ自動コミット（未完成でも保存）。
- **seeking 開始で**：オーバーレイを強制クローズ＋`apiGetPaints` を再取得（鬼・仲間に最終デザインを反映）。すべて**サーバー権威フェーズ駆動**（クライアント時計で判断しない）。
- **未確定なら安全なデフォルトテクスチャ**（`textureForPaint(undefined)`）。
- **保存の受付可否はサーバーが判定**：`phases.paintWindowOpen(phase)`（seeking/result で false）＝paint route が **seeking 以降のコミットを 409 `phase_closed` で拒否**。クライアントは paint 時間を延長できない。

## 鬼側の体験（非公開情報をサーバーで保証）
- hiding 中、鬼は **RoundView を描画しない待機UI**（`ColorHideRoom`）＝realtime transport を開かない → 隠れ役の位置・移動・ペイントを**一切受信しない**。残り時間は表示。探索操作は不可。
- さらに**サーバー側で二重保証**：`net/realtime.ts` の `buildSnapshot` に `seekerCanSee` を追加し、`snapshotFor` が `seekerCanSeek(phase)` を渡す → **seeking 前は、鬼の接続が存在しても未捕獲の隠れ役を一切シリアライズしない**（§従来は幾何学的に見え得た隙を解消）。

## セキュリティ（維持・強化）
サーバー権威の `validateMove`（反テレポート・速度上限・鬼1.15×）・衝突・境界・捕獲（距離+FOV+LOS）・認証・Origin 制限・ルーム分離・40req/s・観戦者の移動禁止・観戦者への非公開は**不変**（`handleInput`/`handleCatch`/catch 判定は main とバイト一致）。**追加**：seeking 前の鬼への隠れ役非送信、保存ウィンドウのサーバー判定。通信削減ではなくフロー変更のため不正移動の新経路は生じない。

## バージョン互換性（4パターン）
`InputMsg`/`SnapshotMsg` のワイヤ形式は**不変**（buildSnapshot の第4引数はサーバー内部のみ）。`RoomMeta.phase` は従来どおり文字列。
- **旧Client × 旧Worker**：現状（painting 経由）。
- **新Client × 旧Worker**：ワイヤ不変で接続可。旧Worker は seeking 前の鬼可視ゲートが無い（＝従来の挙動のまま）が、新Client の鬼は hiding 中そもそも RoundView を開かない（クライアント側保証）ので漏洩しない。ペイントは hiding 中に commit＝旧Worker は paint 非関与（appのみ）なので無影響。
- **旧Client × 新Worker**：旧Client は painting フェーズUIを使うが、新Worker（app）は新規ラウンドで painting をスキップ＝旧Clientは hiding で RoundView を表示（旧UXだが動作）。保存は新ゲートで hiding 中OK。
- **新Client × 新Worker**：目標（全テスト合格・実ブラウザ確認済み）。

**段階リリース**：Worker（app/Vercel）と Cloudflare Worker の双方に関わる。安全順序は **Cloudflare Worker 先行 → Vercel（main マージ）後追い**（Phase 9 と同様、`wrangler.production.toml`/`deploy-production.sh` を使用）。本変更はフェーズ名を増やさず（painting 残置）プロトコルも不変なので、新旧混在は上記のとおり許容。メンテ不要。**本PRではリリースを実行しない。**

## テスト（全ゲートPASS・ローカル）
typecheck / cf:typecheck / lint / **vitest 549**（新規：paintWindowOpen・mapPalette・seeker-blind-during-hiding・preparing→hiding など）/ build / **test:e2e 28**（新規：保存ウィンドウ 409・hiding 中の鬼への非送信）/ **test:partyserver 11**。削除・スキップ・無効化なし。

## 実ブラウザ検証（ローカル・隔離）
PC実機ブラウザ（localhost:3000＋ローカルRTホスト:1999、本番非接触、3人：ブラウザ＋bot×2）で確認：
- **鬼役**：hiding 中の待機UI（世界非表示・残り時間表示）。
- **隠れ役**：ワールド入場→3D移動→「🎨 ペイント」→**ワールド背景のままオーバーレイ**→スポイトで「壁」色を採取→全体塗りで壁色に擬態→3Dプレビュー→「この色で保存」（✓保存しました）→「閉じて移動にもどる」→seeking で自動クローズ＋**自キャラが壁色で描画（擬態）**。コンソールエラーなし。
- **モバイル**：レスポンシブCSS（PaintStudio は lg で横並び／狭幅で縦積み）＋ `MobileControls` のタッチ操作を実装。**実機では未検証**（レイアウト・タッチ対応のみ／実機性能は未確認）。

## 残課題
- 再戦時のペイント初期化は**現状維持**（paint 名前空間は round 記録と分離され、resetForLobby で消さない＝デザインが次ラウンドへ持ち越し）。意図的変更は本PR対象外。
- オーバーレイ中はワールドCanvas＋キャラCanvasの2つが同時描画（ペイント中のみ）＝低スペック端末で負荷増の可能性。必要なら将来 frameloop 抑制を検討。
- モバイル実機での操作感・性能は未検証。

---

# Phase 10（追加）— 操作性改善：矢印キー・ゲームパッド・入力統合（2026-11-18）

同じブランチ `feat/color-hide-world-paint` / Draft PR #11 に統合。本番デプロイ・マージは未実施。

## 入力統合アーキテクチャ
Keyboard / Gamepad / Touch を**共通の入力モデル**（`GameScene` の `GameInput` ref：move{x,y}・look{dx,dy}・running・poseIndex・catchReq）へ正規化。ゲームロジック（移動・衝突・速度・捕獲・送信）は入力デバイスで分岐せず、既存の `GameScene`・`inputSend`（Phase 9-Eハイブリッド送信）・クライアント予測・WebSocket送信を**そのまま再利用**。コントローラー対応で通信量は増えない（送信判定は従来どおり `planInputSend`）。プロトコル変更なし。

## PC矢印キー
`↑↓←→` を WASD と**併用**で移動（同じ移動・衝突・速度判定）。Shift走る／Ctrl・Cしゃがむ／Eペイント切替／Escapeで閉じる。**ゲーム中のみ矢印のページスクロールを `preventDefault`**、**入力欄フォーカス中はゲーム入力を無効化**（`input/textarea/select/contenteditable` 判定）、**blur・タブ切替で押下キーを全解放**（押しっぱなし防止）。

## Gamepad API
標準の `navigator.getGamepads()` を rAF で1ループポーリング（追加intervalなし）。`gamepadconnected`/`disconnected` で接続UX更新。**特定コントローラーIDに依存せず**、W3C "standard" マッピングを**ボタンINDEX/位置**で解釈。非standardマッピングは `readStandardGamepad` が `null` を返し**非対応として扱う**（推測しない）。Nintendo実機のABXY表記はインデックスと入れ替わるため、**機能/位置**で割り当て、**物理ラベルの対応は実機検証に委ねる**（未検証）。

## 操作マッピング
- 移動：左スティック / 十字ボタン（WASD・矢印と併用）
- カメラ：右スティック（感度・上下反転 設定可、rate方式）
- ZR：走る（hold）／ZL：しゃがむ（toggle）
- X：ペイント開閉／B：閉じる／Y：ポーズ切替／A：捕まえる（鬼）
- ペイント内（パッドのみの簡易擬態）：十字キーで「周囲の色」swatch選択→**Aで全身に塗る（擬態）**→**Yで保存**。自由描画はマウス/タッチ（既存）。
- 捕獲は鬼のseeking時のみ A に割当（空きボタン、既存Spaceと整合）。

## 入力の安全性
- **デッドゾーン**（既定0.2・ラジアル・Joy-Conドリフト対策）＋**斜め移動の正規化**（スティック+十字の合成を単位円にクランプ→速度上限を超えない）＋微小ノイズ除去。
- **ボタンは立ち上がり検出**（`EdgeDetector`）で連続誤発火防止。
- **感度・デッドゾーン・上下反転は localStorage 保持**（`useGamepad` が SSR既定→mount後にロード＝**Hydrationミスマッチなし**）。
- **切断時は入力を安全にリセット**（ポーリングが null→move/look/running ゼロ、エッジ検出もreset）。キーボード/マウスへ自然に復帰。接続状態バッジ（未接続/接続済み/非対応/切断）を表示、接続時は操作ガイドをパッド向けに表示。
- ペイントオーバーレイを開くと（`inputLocked`）キーボード・ゲームパッドの移動/視点を凍結＋押下キー解放（描画と競合しない）。

## セキュリティ・通信（不変）
ゲームパッド入力も既存の**サーバー権威型判定**を通過：反テレポート（`validateMove`）・役割別速度上限（鬼1.15×）・マップ衝突・捕獲（距離+FOV+LOS）・観戦者の移動禁止・非公開プレイヤーの位置保護（`seekerCanSeek` ゲート）・レート制限（40/s）・ハイブリッド送信。コントローラー対応のためのプロトコル変更なし。斜め正規化により複合入力でも速度上限を超えない。

## テスト（自動／実機の区別）
- **自動（モックGamepad・pure単体）**：`gamepad.test.ts` 15件（デッドゾーン・斜め正規化・ZR/ZL・ボタン機能割当・感度/反転・立ち上がり検出・SSR既定）。vitest 合計 **564**。
- **自動（全ゲート）**：typecheck / cf:typecheck / lint / build / e2e 28 / partyserver 11。
- **実ブラウザ（ローカル隔離）**：矢印キー移動＝実機確認。ゲームパッドは**ページへモックGamepadを注入**して「左スティックで移動／接続バッジ表示／ボタン読み取り（X：paint可否でゲート）／切断でバッジ『切断』＋入力リセット」を確認、コンソールエラーなし。
- **未検証**：**物理 Switch Pro Controller / Joy-Con の実機**（手元に実機なし）。単体Joy-Con・非standardマッピングは取得入力次第で、動作保証はしない。モバイル実機も未検証。

## 残課題（追加）
物理コントローラー実機検証（Pro Controller/Joy-Con のボタン物理ラベル対応）。単体Joy-Con/非standardマッピングは非対応扱い。ペイントの完全パッド自由描画は非対応（簡易擬態＝色選択+全身塗りで代替、自由描画はマウス/タッチ）。
