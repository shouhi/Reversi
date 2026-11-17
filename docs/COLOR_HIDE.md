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
