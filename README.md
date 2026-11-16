# REVERSI — 友達と2人でオンライン対戦

URLを共有するだけで、目の前の友達とそれぞれのスマホ・PCからすぐに遊べる、2人対戦専用のオンラインリバーシ（オセロ）です。**アカウント登録は不要**。ルームを作って招待URLを送るだけで対戦が始まります。

- 🎯 登録・ログイン不要
- 🔗 ルーム作成 → URL共有 → その場で対戦
- ♟️ 正確な8×8リバーシルール（自動パス・勝敗判定つき）
- 🔄 盤面はポーリングで自動同期（二重操作・競合に強い設計）
- 📱 スマホ縦画面を最優先したレスポンシブUI（320pxから対応）
- 🌙 ダークテーマ × 深緑の盤面の落ち着いたデザイン

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
| E2Eテスト | Playwright（2ブラウザコンテキスト） |
| ホスティング | Vercel |

専用のWebSocketサーバーは使用せず、1.2秒間隔のポーリングで盤面を同期します（目の前の友達との対戦が目的のため、この程度の遅延は許容）。

---

## ディレクトリ構成（主要ファイル）

```
src/
├── app/
│   ├── page.tsx                      # トップページ
│   ├── room/[roomId]/page.tsx        # 対局ページ
│   ├── not-found.tsx                 # 404
│   └── api/rooms/
│       ├── route.ts                  # POST   ルーム作成
│       └── [roomId]/
│           ├── route.ts              # GET    盤面取得（ポーリング）
│           ├── join/route.ts         # POST   白で参加
│           └── move/route.ts         # POST   着手
├── components/
│   ├── GameRoom.tsx                  # 対局画面のメインクライアント
│   ├── Board.tsx                     # 8×8盤面
│   ├── SharePanel.tsx                # 招待URLのコピー/共有
│   └── CreateRoomButton.tsx          # ルーム作成ボタン
├── hooks/useRoom.ts                  # ポーリング同期フック
└── lib/
    ├── reversi.ts                    # 純粋なゲームロジック
    ├── roomService.ts               # サーバー側の検証・状態遷移
    ├── tokens.ts                     # トークン生成・ハッシュ
    ├── apiHelpers.ts                 # APIレスポンス共通処理
    ├── clientApi.ts                  # クライアントfetch + localStorage
    ├── types.ts                      # 共有型
    └── store/                        # 保存層（Redis / メモリ）
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

---

## Upstash Redis（無料データベース）の作成方法

本番で盤面を保存するには Upstash Redis が必要です。無料枠で十分動作します。

1. https://console.upstash.com/ にアクセスしてサインアップ / ログイン。
2. **Create Database** をクリック。
   - Name: 任意（例 `reversi`）
   - Type / Primary Region: 近いリージョンを選択
3. 作成後、データベース詳細ページの **REST API** セクションを開く。
4. 次の2つの値をコピーする。
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
5. ローカルの `.env.local` に貼り付ける（本番はVercelの環境変数に設定）。

> 💡 Vercel Marketplace からも Upstash を数クリックで追加でき、環境変数が自動で注入されます（Vercelダッシュボード → プロジェクト → **Storage** → **Upstash Redis**）。

---

## 必要な環境変数

| 変数名 | 必須 | 説明 |
| --- | --- | --- |
| `UPSTASH_REDIS_REST_URL` | 本番で必須 | Upstash の REST API URL |
| `UPSTASH_REDIS_REST_TOKEN` | 本番で必須 | Upstash の REST API トークン |
| `REVERSI_MEMORY_STORE` | 任意（ローカル/テスト専用） | `1` でメモリストレージを使用。**本番では設定しないこと** |

- 認証情報は**サーバー側のみ**で使用され、クライアントには一切公開されません。
- `.env.local` などの秘密情報は `.gitignore` 済みでGitにコミットされません。

---

## Vercelへのデプロイ手順

### 方法A：ダッシュボード（推奨・最も簡単）

1. このリポジトリを GitHub などに push。
2. https://vercel.com/new からリポジトリを **Import**。
3. Framework は自動で **Next.js** と認識されます。
4. **Environment Variables** に以下を追加：
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   （または **Storage** タブから Upstash を接続すると自動設定）
5. **Deploy** を押す。数十秒で公開URLが発行されます。

### 方法B：Vercel CLI

```bash
npm i -g vercel          # CLIを導入
vercel login             # 認証（ブラウザ/メール）
vercel link              # プロジェクトに紐付け（初回のみ）

# 環境変数を登録
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production

vercel --prod            # 本番デプロイ
```

> ⚠️ 環境変数 `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を設定せずにデプロイすると、ルーム作成時に「Storage is not configured」エラーが表示されます（メモリストレージへ自動フォールバックしない安全設計のため）。

---

## 友達との対戦方法

1. 公開URL（例 `https://your-app.vercel.app`）を開く。
2. **「対戦ルームを作成」** を押す。あなたは **黒（先手）** になります。
3. 表示された **招待URL** を「URLをコピー」または「共有」ボタンで友達に送る。
4. 友達がURLを開くと **「白で参加する」** ボタンが表示されるので押してもらう。
5. 両方の画面で自動的に対局が始まります。交互に石を置いて対戦！
6. 終局すると石数と勝敗が表示され、**「新しい対戦を始める」** で次の対戦へ。

- 自分の手番のときだけ盤面を操作できます（合法手には小さなドットが表示されます）。
- 途中でリロードしても、同じプレイヤーとして復帰できます。
- 3人目が同じURLを開くと「このルームは満員です」と表示されます。

---

## テスト実行方法

```bash
# 単体テスト（ゲームロジック + API権限/二重操作/競合）
npm test

# 監視モード
npm run test:watch

# E2Eテスト（2ブラウザで対戦フローを検証。Redis不要、メモリストレージで実行）
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

E2Eは `playwright.config.ts` の `webServer` 設定により、自動で `npm run build && npm run start`（`REVERSI_MEMORY_STORE=1`）を起動してテストします。外部Redisの認証情報は不要です。

---

## 設計上のポイント（整合性・安全性）

- **サーバーが唯一の正**：クライアントは「置きたいマス」だけを送信。石の反転・手番・勝敗はすべてサーバーが `src/lib/reversi.ts` で再計算します。クライアントの盤面は信用しません。
- **原子的更新**：ルーム更新は Redis の Lua スクリプトで「読み出し→version照合→書き込み」を一気に実行し、競合する更新を検出します（version不一致なら再取得してリトライ）。
- **二重操作防止**：クライアントは送信中の入力を無効化し、サーバーも手番・合法手・versionを検証するため、連続タップや同時着手で状態が壊れません。
- **トークン**：プレイヤーごとに推測困難なトークンを発行し、**ハッシュのみ**をRedisに保存。生トークンはブラウザの localStorage に保持し、リロード後も同じプレイヤーとして復帰できます。
- **キャッシュ無効化**：すべてのAPIレスポンスに `Cache-Control: no-store` を付与。
- **自動期限切れ**：ルームは24時間でTTL失効。期限切れ・不存在のルームは分かりやすいエラー画面を表示します。
- **本番でのメモリフォールバック禁止**：Redis未設定の本番ではメモリに退避せず、明示的なエラーを返します。

---

## ライセンス

個人利用向けのサンプルアプリです。自由に改変してお使いください。
