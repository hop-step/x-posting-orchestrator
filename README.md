# X Posting Orchestrator

Cloudflare Workers 上で動く、X投稿専用の安全なバックエンドです。管理画面、社内ツール、AIエージェント、バッチ処理は直接 X API を呼ばず、必ず Publication を作成し、ポリシー判定・必要な人間承認・Queue Consumer 経由で投稿します。

## 実装範囲

- Cloudflare Workers 単一デプロイ: `fetch`, `scheduled`, `queue`
- D1 schema/migration, R2 media storage, Queues + DLQ
- 内部APIキー認証、scope、Xアカウント別 permission level 0-3
- Publication preview/create/list/get/patch/submit/approve/reject/cancel/retry/reconcile
- TEXT, IMAGE, POLL, THREAD, Poll follow-up
- `twitter-text` による重み付き文字数判定
- Queue重複配信時のX投稿重複防止
- X OAuth 2.0 PKCE, AES-256-GCM token encryption, refresh
- Fake X Adapter と contract/unit/integration tests

## セットアップ

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
```

## Cloudflare Resource 作成

```bash
wrangler d1 create x-posting-orchestrator
wrangler r2 bucket create x-posting-media
wrangler queues create x-publish
wrangler queues create x-publish-dlq
```

`wrangler.jsonc` の `database_id` は、D1作成後に実IDへ差し替えてください。

```bash
wrangler d1 migrations apply x-posting-orchestrator --local
wrangler d1 migrations apply x-posting-orchestrator --remote
```

## Worker Secrets

値はコードや `wrangler.jsonc` に書かず、Worker Secret として登録します。

```bash
wrangler secret put API_KEY_PEPPER
wrangler secret put TOKEN_ENCRYPTION_KEY_V1
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put PUBLIC_BASE_URL
```

`TOKEN_ENCRYPTION_KEY_V1` は32 bytesのhexまたはbase64です。

## X Developer App

X Developer Portalで OAuth 2.0 Authorization Code Flow with PKCE を有効にし、callback URL を登録します。

```text
<PUBLIC_BASE_URL>/v1/x/oauth/callback
```

必要scope:

```text
tweet.read tweet.write users.read offline.access media.write
```

OAuth開始:

```http
GET /v1/x/oauth/authorize?xAccountId=acc_xxx
Authorization: Bearer <api-key>
```

## API Client 作成

ローカルでAPIキーを生成します。

```bash
API_KEY_PEPPER=<same-secret> pnpm create-api-key SERVICE "ops-client"
```

出力された `keyDigest` と `keyPrefix` を `api_clients` に保存します。APIキーの平文は再表示できないため、運用側で安全に保管してください。

AI actor には `publication:approve`, `publication:reject`, `publication:reconcile` を付与しないでください。アプリケーション実行時にも拒否します。

## Live Smoke Test

自動テストやCIから実投稿は行いません。テスト用Xアカウントだけで、明示環境変数がある場合に実行します。

```bash
LIVE_X_TEST=true X_TEST_ACCOUNT_ID=<test-account> pnpm live-x-smoke-test
```

手動確認項目:

- 通常投稿
- 画像1枚、画像4枚
- 投票
- 自分の投稿への返信
- 2件の自己スレッド
- 投票終了後の返信
- 長文投稿
- 長文非対応アカウントでのFallback
- Token refresh後の予約投稿

自己返信・投票後リプライ・長文が実アカウントで成功した後にだけ、以下を更新します。

```http
PATCH /v1/x/accounts/:id/capabilities
```

## DLQ と Delivery Unknown

Queue consumer は 5xx、timeout、接続断、解析不能レスポンスを `DELIVERY_UNKNOWN` とし、自動再送しません。X上で投稿有無を人間が確認し、次のどちらかで reconcile します。

```http
POST /v1/publications/:id/reconcile
```

```json
{ "stepId": "step_123", "outcome": "PUBLISHED", "xPostId": "1234567890" }
```

```json
{ "stepId": "step_123", "outcome": "NOT_PUBLISHED" }
```

`NOT_PUBLISHED` 確定後だけ `POST /v1/publications/:id/retry` を使用します。

DLQ は Cloudflare Queues の `x-publish-dlq` を確認し、古い revision/contentHash/lease の message は再投入せず破棄してください。

## 参考にした公式ドキュメント

- [X OAuth 2.0 Authorization Code Flow with PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X Create Post: POST /2/tweets](https://docs.x.com/x-api/posts/create-post)
- [X Counting Characters](https://docs.x.com/fundamentals/counting-characters)
- [X Upload media: POST /2/media/upload](https://docs.x.com/x-api/media/upload-media)
- [Cloudflare Workers Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
