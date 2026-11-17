# ゲームの追加方法

このドキュメントは、本プラットフォームに**新しいブラウザゲームを追加する手順**をまとめたものです。
既存の設計思想（責務の分離・サーバー権威・楽観的排他制御）を維持したまま追加できるよう、
規約とテンプレートを定義します。

> 対象読者: このリポジトリでゲームを追加する開発者、および Claude Code。
> 既存の構成全体像は [`CLAUDE.md`](../CLAUDE.md) を参照してください。
>
> **リファレンス実装**: `src/games/tic-tac-toe/`（○×ゲーム）がこのガイドの規約どおりに
> 実装された最小の実例です。新しいゲームを追加するときは、これを雛形としてコピー・改変すると早いです。
> （リバーシ `src/games/reversi/` は `/room/*`・`/api/rooms/*` という後方互換URLを使う歴史的例外です。）

---

## 設計の全体像

- **1つのNext.jsアプリ**に複数ゲームを同居させます（マイクロサービス化はしません）。
- **ゲーム固有のコードは `src/games/<slug>/` に閉じ込めます**（ロジック・UI・型）。
- **複数ゲームで明確に共有するものだけ** `src/lib/` と `src/components/` に置きます。
  - `src/lib/store/` … バージョン付きレコードの汎用KVストア（Redis / メモリ、キー接頭辞でゲームを分離）
  - `src/lib/tokens.ts` … ルームID・プレイヤートークンの生成/ハッシュ（ゲーム非依存）
  - `src/lib/apiHelpers.ts` … HTTPレスポンス共通処理（no-store, 503 など）
  - `src/lib/site.ts` … サイト名・SEO用の定数
  - `src/components/layout/` `src/components/game/` … ヘッダー/フッター/ゲームカード
- **ゲーム一覧はデータ駆動**です。`src/games/registry.ts` にメタデータを追加すれば一覧に出ます。

```
src/
├── app/
│   ├── page.tsx                 # ゲーム一覧（トップ）
│   ├── games/<slug>/page.tsx    # 各ゲームの開始/詳細ページ
│   ├── room/[roomId]/           # リバーシの対局ページ（既存URLを維持）
│   └── api/...                  # 各ゲームのAPI
├── games/
│   ├── registry.ts              # ゲームカタログ（唯一の真実）
│   ├── types.ts                 # GameMeta など共通型
│   └── <slug>/                  # ← 新しいゲームはここに作る
│       ├── index.ts             # GameMeta（カタログ登録用の定義）
│       ├── types.ts             # ゲーム/ルームの型
│       ├── lib/
│       │   ├── engine.ts        # 純粋なゲームロジック（UI/IOなし）
│       │   ├── engine.test.ts
│       │   ├── roomService.ts   # サーバー側の検証・状態遷移（ストア利用）
│       │   ├── roomService.test.ts
│       │   ├── clientApi.ts     # クライアントfetch + localStorage
│       │   └── api.ts           # ルート用の薄いヘルパ（トークンヘッダ等）
│       ├── hooks/
│       └── components/
├── components/{layout,game}/
└── lib/{store,tokens.ts,apiHelpers.ts,site.ts}
```

---

## 追加手順（チェックリスト）

新しいゲーム `my-game`（slug）を追加する例です。

### 1. ゲーム固有のロジックを作成する

`src/games/my-game/lib/engine.ts` に**純粋関数**でルールを実装します。
UI・ネットワーク・ストレージへの依存を持たせないでください（サーバーとクライアントの双方で同じ関数を使い、サーバーが正とします）。
同じ場所に `engine.test.ts` を置いて、合法手・勝敗判定などを Vitest で検証します。

### 2. 型を定義する

`src/games/my-game/types.ts` に、保存するルーム状態（`RoomState`）とクライアントに返す公開状態（`PublicRoomState`）を定義します。

- `RoomState` には **`version: number`** を必ず持たせます（楽観ロックのキー）。
- トークンは**ハッシュのみ**を保存し、公開状態には**絶対に含めない**でください。

### 3. サーバー側のサービスを実装する

`src/games/my-game/lib/roomService.ts` に、作成・参加・着手などを実装します。

- Redisキーの接頭辞を決めます（規約: **`<slug>:room:`**、例 `my-game:room:`）。
  既存の値は変えないでください（リバーシは `reversi:room:` 固定）。
- ストアは汎用の `getStore<RoomState>("my-game:room:")` を使うか、
  テスト用に `KvStore<RoomState>` を引数で受け取る形（依存注入）にします（リバーシ準拠）。
- 書き込みは必ず `store.compareAndSwap(id, expectedVersion, next, ttl)` を使い、
  `conflict` のときは再取得して再検証するループにします。
- クライアントから来た盤面は信用せず、サーバーが `engine.ts` で再計算します。

### 4. API ルートを実装する

`src/app/api/...` にルートハンドラを追加します。

- **APIの名前空間はゲームごとに分けます**（規約: 新規ゲームは **`/api/games/<slug>/...`**）。
  - 例: `POST /api/games/my-game/rooms`、`GET /api/games/my-game/rooms/[roomId]` など。
  - リバーシは歴史的経緯により `/api/rooms/*` を使用（**後方互換のため変更しない**）。
- 各ルートは `export const dynamic = "force-dynamic";` を付けます（キャッシュ無効）。
- `src/games/my-game/lib/api.ts` に、トークンヘッダ名（規約: **`x-<slug>-token`**）や
  エラーコード→HTTPステータスの対応表、`resolve<Game>Store()` をまとめます。
- レスポンスは `src/lib/apiHelpers.ts` の `jsonResponse` / `storageUnavailable` を使います
  （全レスポンスに `Cache-Control: no-store`）。

### 5. クライアント層とUIを実装する

- `src/games/my-game/lib/clientApi.ts`: `fetch` ラッパと localStorage トークン管理。
  - localStorage キーの規約: **`<slug>:token:<roomId>`**（リバーシは `reversi:token:` 固定）。
  - リクエストヘッダにトークンを載せます（`x-<slug>-token`）。
- `src/games/my-game/hooks/`・`src/games/my-game/components/`: 盤面・対局画面など。
  - リアルタイム同期はポーリングで十分（リバーシは 1.2 秒間隔。`useRoom` を参考に）。
- 開始/詳細ページ `src/app/games/my-game/page.tsx` を作成し、
  共通の `SiteHeader` / `SiteFooter` でラップします（プラットフォーム統一感）。
  ゲーム固有の独自デザインを入れても構いません。

### 6. ゲームレジストリへ登録する

`src/games/my-game/index.ts` に `GameMeta` を定義し、`src/games/registry.ts` に import して配列へ追加します。

```ts
// src/games/my-game/index.ts
import type { GameMeta } from "../types";

export const myGame: GameMeta = {
  id: "my-game",
  slug: "my-game",
  title: "マイゲーム",
  description: "短い説明（1行）。",
  category: "ボードゲーム",
  minPlayers: 2,
  maxPlayers: 2,
  supportedModes: ["online-2p"],
  status: "available",   // まだ遊べないなら "coming-soon"
  displayOrder: 60,
  accent: "#60a5fa",
  href: "/games/my-game", // available のときは必須・実在するルートにする
};
```

```ts
// src/games/registry.ts
import { myGame } from "./my-game";
const GAMES: GameMeta[] = [reversiGame, myGame, /* ... */];
```

> **重要な不変条件**: `status: "available"` のゲームは必ず `href` を持ち、実在するルートを指すこと。
> `coming-soon` は `href` を持たないこと（カードがリンクにならず、未実装ページへ飛ばない）。
> この不変条件は `src/games/registry.test.ts` で検証しています。

### 7. テストを追加する

- **単体（Vitest）**: `engine.test.ts`（ルール）、`roomService.test.ts`（権限・二重操作・競合・終局）。
  メモリストアを使い、`createMemoryStore<RoomState>("<slug>:room:")` で分離します。
- **E2E（Playwright）**: `e2e/<slug>.spec.ts` に、一覧からの選択 → 対局開始 → 同期 → リロード復帰 などを追加。
  E2E はメモリストアで実行されます（`REVERSI_MEMORY_STORE=1`、外部Redis不要）。

### 8. 一覧に公開する

`status` を `"available"` にし、品質チェックを全て通します。

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

---

## 規約まとめ（命名の一貫性）

| 項目 | 規約 | リバーシ（既存・変更不可） |
|---|---|---|
| ゲームコード | `src/games/<slug>/` | `src/games/reversi/` |
| 開始ページ | `/games/<slug>` | `/games/reversi` |
| Redisキー | `<slug>:room:<id>` | `reversi:room:<id>` |
| localStorageキー | `<slug>:token:<id>` | `reversi:token:<id>` |
| トークンヘッダ | `x-<slug>-token` | `x-reversi-token` |
| API名前空間 | `/api/games/<slug>/...` | `/api/rooms/*`（歴史的経緯） |

> リバーシの値は**後方互換のため固定**です。既存の共有URL・保存済みデータ・保存トークンが
> 引き続き機能するよう、絶対に変更しないでください。

---

## やらないこと（スコープ）

ユーザー登録・ログイン・課金・広告・ランキング・フレンド・チャット・管理画面・
大規模ゲームエンジン・マイクロサービス化は、現時点では実装しません。
「URLを共有して友達と遊ぶ」に必要な最小限に保ってください。
