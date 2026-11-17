# ZEN GAMEBOX — 友達と遊ぶブラウザゲームプラットフォーム

URLを共有するだけで、友達とそれぞれのスマホ・PCからすぐに遊べるブラウザゲーム集です。**アカウント登録もインストールも不要**。ゲームを選んでルームを作り、招待URLを送るだけで対戦が始まります。

現在遊べるゲーム：

2人対戦（オンライン）：

- ♟️ **リバーシ（オセロ）** — 正確な8×8ルール（自動パス・勝敗判定つき）
- ⭕ **○×ゲーム（三目並べ）** — 3つ並べたら勝ち
- 🔴 **四目並べ** — 7×6の盤でコマを落とし、縦・横・斜めに4つ並べたら勝ち
- ♚ **チェス** — 合法手・チェック・チェックメイト・キャスリング・アンパッサン・プロモーションに対応
- 🏯 **将棋** — 9×9・持ち駒・成り・駒打ち（二歩/打ち歩詰め禁止）・王手・詰みに対応
- 🃏 **神経衰弱** — 4×4の16枚からペアを多く取った方が勝ち

1人用アクション：

- 🛒 **トロッコダッシュ** — 自動で走るトロッコをタップでジャンプ。鉱山の切れ目・障害物・天井・高低差・動く障害物を攻略する横スクロールアクション（Canvas製・**全24ステージ / 難易度4段階 EASY・NORMAL・HARD・EXPERT**・進捗はlocalStorage保存）

新しいゲームは同じ手順で継続的に追加できます（[`docs/ADDING_GAMES.md`](docs/ADDING_GAMES.md)）。

- 🎯 登録・ログイン不要／インストール不要
- 🧩 トップページのゲーム一覧から選んで遊ぶ
- 🔗 ルーム作成 → URL共有 → その場で対戦
- 📱 スマホ縦画面を最優先したレスポンシブUI（320pxから対応）
- 🌙 ダークテーマの落ち着いたデザインでプラットフォーム全体を統一
- ➕ **ゲームを追加しやすい設計** — 詳細は [`docs/ADDING_GAMES.md`](docs/ADDING_GAMES.md)

> プロジェクトの全体像と設計原則は [`CLAUDE.md`](CLAUDE.md) にまとめています。

---

## 技術構成

| 項目 | 採用技術 |
| --- | --- |
| フレームワーク | Next.js 15（App Router） |
| 言語 | TypeScript（strict mode） |
| UI | React 19 / Tailwind CSS v4 |
| API | Next.js Route Handlers |
| データ保存 | Upstash Redis（REST） |
| 排他制御 | Redis Lua スクリプトによる compare-and-set + version管理 |
| 単体テスト | Vitest |
| E2Eテスト | Playwright |
| ホスティング | Vercel |

専用のWebSocketサーバーは使用せず、1.2秒間隔のポーリングで盤面を同期します（目の前の友達との対戦が目的のため、この程度の遅延は許容）。

---

## URL構成

| URL | 用途 |
| --- | --- |
| `/` | ゲーム一覧（トップ） |
| `/games/reversi` | リバーシの開始/詳細ページ |
| `/room/[roomId]` | リバーシの対局ページ（既存の共有URLと互換） |
| `/api/rooms/*` | リバーシのAPI（既存と互換） |

> 新しいゲームは `/games/<slug>` と `/api/games/<slug>/...` を使う規約です（[`docs/ADDING_GAMES.md`](docs/ADDING_GAMES.md)）。リバーシの `/room/*`・`/api/rooms/*` は後方互換のため維持しています。

---

## ディレクトリ構成（主要ファイル）

```
src/
├── app/
│   ├── page.tsx                      # ゲーム一覧（トップ）
│   ├── layout.tsx                    # 共通レイアウト / SEOメタデータ
│   ├── not-found.tsx                 # 404
│   ├── games/reversi/page.tsx        # リバーシ開始ページ
│   ├── room/[roomId]/page.tsx        # 対局ページ（URL互換）
│   └── api/rooms/                    # リバーシAPI（URL互換）
├── games/
│   ├── registry.ts                   # ゲームカタログ（唯一の真実）
│   ├── types.ts                      # GameMeta など
│   └── reversi/                      # リバーシ固有（engine / service / UI / 型）
│       ├── index.ts                  #   カタログ登録用の GameMeta
│       ├── lib/{engine,roomService,clientApi,api}.ts
│       ├── hooks/useRoom.ts
│       └── components/{Board,GameRoom,SharePanel,CreateRoomButton}.tsx
├── components/
│   ├── layout/{SiteHeader,SiteFooter}.tsx
│   └── game/GameCard.tsx
└── lib/                              # 複数ゲームで共有する基盤
    ├── store/                        #   汎用の versioned KV ストア（Redis / メモリ）
    ├── tokens.ts                     #   ルームID・トークン生成/ハッシュ
    ├── apiHelpers.ts                 #   HTTPレスポンス共通処理
    └── site.ts                       #   サイト名・SEO定数
```

---

## 開発環境の起動方法

### 1. 依存関係のインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.example` をコピーして `.env.local` を作成します。

```bash
cp .env.example .env.local
```

ローカルで**Redisなしでもすぐ試したい**場合は、`.env.local` に次を設定してください（単一プロセス用のメモリストレージを使用します。**本番では使えません**）。

```env
REVERSI_MEMORY_STORE=1
```

本番同様にRedisを使いたい場合は、後述の「Upstash Redis」を設定します。

### 3. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開きます。2人対戦を手元で試すには、**通常タブとシークレットタブ**（または別ブラウザ）で同じルームURLを開いてください。localStorageが分かれるため、黒・白それぞれのプレイヤーとして参加できます。

> ⚠️ `.env.local` に本番の Upstash / `KV_REST_API_*` 認証情報が入っている場合、`REVERSI_MEMORY_STORE=1` を指定しても**Redisが優先**されます（認証情報があるときはRedisを使う設計）。本番データに触れずに動かすには、該当の環境変数を空にして起動してください。詳細は [`CLAUDE.md`](CLAUDE.md) の「Safety when testing locally」を参照。

---

## Upstash Redis（無料データベース）の作成方法

本番で盤面を保存するには Upstash Redis が必要です。無料枠で十分動作します。

1. https://console.upstash.com/ にアクセスしてサインアップ / ログイン。
2. **Create Database** をクリック。
   - Name: 任意（例 `zen-gamebox`）
   - Type / Primary Region: 近いリージョンを選択
3. 作成後、データベース詳細ページの **REST API** セクションを開く。
4. 次の2つの値をコピーする。
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. ローカルの `.env.local` に貼り付ける（本番はVercelの環境変数に設定）。

> 💡 Vercel Marketplace からも Upstash を数クリックで追加でき、`KV_REST_API_URL` / `KV_REST_API_TOKEN` が自動で注入されます（Vercelダッシュボード → プロジェクト → **Storage** → **Upstash for Redis**）。本アプリはどちらの命名でも動作します。

---

## 必要な環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | 本番で必須 | Upstash の REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | 本番で必須 | Upstash の REST API トークン |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | 任意 | Vercel Upstash Marketplace が自動注入（上記の代替） |
| `REVERSI_MEMORY_STORE` | 任意（ローカル/テスト専用） | `1` でメモリストレージを使用。**本番では設定しないこと** |
| `NEXT_PUBLIC_SITE_URL` | 任意 | OGP/canonical の絶対URL。未設定時はVercelの自動URL→localhost |

- 認証情報は**サーバー側のみ**で使用され、クライアントには一切公開されません。
- `.env.local` などの秘密情報は `.gitignore` 済みでGitにコミットされません。

---

## Vercelへのデプロイ手順

### 方法A：ダッシュボード（推奨・最も簡単）

1. このリポジトリを GitHub などに push。
2. https://vercel.com/new からリポジトリを **Import**。
3. Framework は自動で **Next.js** と認識されます。
4. **Storage** タブから Upstash for Redis を接続（`KV_REST_API_*` が自動設定）。
   もしくは **Environment Variables** に `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を追加。
5. **Deploy** を押す。数十秒で公開URLが発行されます。

### 方法B：Vercel CLI

```bash
npm i -g vercel          # CLIを導入
vercel login             # 認証（ブラウザ/メール）
vercel link              # プロジェクトに紐付け（初回のみ）
vercel --prod            # 本番デプロイ
```

> ⚠️ Redis の認証情報を設定せずにデプロイすると、ルーム作成時に「Storage is not configured」エラーが表示されます（メモリストレージへ自動フォールバックしない安全設計のため）。

---

## 遊び方

1. 公開URL（例 `https://your-app.vercel.app`）を開く。
2. ゲーム一覧から **リバーシ** を選ぶ。
3. **「対戦ルームを作成」** を押す。あなたは **黒（先手）** になります。
4. 表示された **招待URL** を「URLをコピー」または「共有」で友達に送る。
5. 友達がURLを開くと **「白で参加する」** ボタンが表示されるので押してもらう。
6. 両方の画面で自動的に対局が始まります。交互に石を置いて対戦！
7. 終局すると石数と勝敗が表示されます。ゲーム一覧から別のゲームも選べます。

- 自分の手番のときだけ盤面を操作できます（合法手には小さなドットが表示されます）。
- 途中でリロードしても、同じプレイヤーとして復帰できます。
- 3人目が同じURLを開くと「このルームは満員です」と表示されます。

---

## ゲームの追加

新しいブラウザゲームの追加手順・規約・テンプレートは [`docs/ADDING_GAMES.md`](docs/ADDING_GAMES.md) にまとめています。

ゲーム固有のコードは `src/games/<slug>/` に閉じ込め、`src/games/registry.ts` にメタデータを追加するとトップの一覧に表示されます。

---

## テスト実行方法

```bash
# 単体テスト（ゲームロジック + API権限/二重操作/競合 + レジストリ）
npm test

# 監視モード
npm run test:watch

# E2Eテスト（2ブラウザで対戦フロー + 一覧/遷移/モバイルを検証。Redis不要）
npm run test:e2e

# 型チェック / Lint / 本番ビルド
npm run typecheck
npm run lint
npm run build
```

初回のみ Playwright のブラウザを導入してください。

```bash
npx playwright install chromium
```

E2Eは `playwright.config.ts` の `webServer` 設定により、自動で `npm run build && npm run start`（`REVERSI_MEMORY_STORE=1`）を起動してテストします。
`.env.local` に本番のRedis認証情報がある場合は、前述のとおり該当の環境変数を空にして実行してください（本番データに触れないため）。

---

## 設計上のポイント（整合性・安全性）

- **サーバーが唯一の正**：クライアントは「置きたいマス」だけを送信。石の反転・手番・勝敗はすべてサーバーが純粋ロジックで再計算します。クライアントの盤面は信用しません。
- **原子的更新**：ルーム更新は Redis の Lua スクリプトで「読み出し→version照合→書き込み」を一気に実行し、競合する更新を検出します（version不一致なら再取得してリトライ）。
- **二重操作防止**：クライアントは送信中の入力を無効化し、サーバーも手番・合法手・versionを検証するため、連続タップや同時着手で状態が壊れません。
- **トークン**：プレイヤーごとに推測困難なトークンを発行し、**ハッシュのみ**をRedisに保存。生トークンはブラウザの localStorage に保持し、リロード後も同じプレイヤーとして復帰できます。
- **キャッシュ無効化**：すべてのAPIレスポンスに `Cache-Control: no-store` を付与。
- **自動期限切れ**：ルームは24時間でTTL失効。期限切れ・不存在のルームは分かりやすいエラー画面を表示します。
- **本番でのメモリフォールバック禁止**：Redis未設定の本番ではメモリに退避せず、明示的なエラーを返します。

---

## ライセンス

個人利用向けのサンプルアプリです。自由に改変してお使いください。
