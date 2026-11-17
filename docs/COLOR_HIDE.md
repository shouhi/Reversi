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
- **本番基盤の選定（PartyKit）**: アカウント作成・provisioning・課金発生操作は **事前承認が必要**。
  無料枠・同時接続・従量課金は provisioning 前に公式ドキュメントで実測確認する（現時点で金額は断定しない）。

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
