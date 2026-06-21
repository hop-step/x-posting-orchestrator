# 管理者セットアップ

この手順は、CloudflareとX Developer Platformのリソースを準備し、本番または検証環境でWorkerを動かす管理者向けです。

## 1. 依存関係を入れる

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## 2. Cloudflare Resourceを作成する

```bash
wrangler d1 create x-posting-orchestrator
wrangler r2 bucket create x-posting-media
wrangler queues create x-publish
wrangler queues create x-publish-dlq
```

D1作成後、`wrangler.jsonc` の `database_id` を実IDへ差し替えます。

## 3. Migrationを適用する

ローカル:

```bash
wrangler d1 migrations apply x-posting-orchestrator --local
```

リモート:

```bash
wrangler d1 migrations apply x-posting-orchestrator --remote
```

## 4. Worker Secretsを登録する

```bash
wrangler secret put API_KEY_PEPPER
wrangler secret put TOKEN_ENCRYPTION_KEY_V1
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
wrangler secret put PUBLIC_BASE_URL
```

`TOKEN_ENCRYPTION_KEY_V1` は32 bytesのhexまたはbase64を使います。

例: 32 bytes hex

```bash
openssl rand -hex 32
```

## 5. X Developer Appを設定する

X Developer PortalでOAuth 2.0 Authorization Code Flow with PKCEを有効化します。

Callback URL:

```text
<PUBLIC_BASE_URL>/v1/x/oauth/callback
```

必要scope:

```text
tweet.read tweet.write users.read offline.access media.write
```

## 6. 管理用API Clientを作る

APIキーを生成します。

```bash
API_KEY_PEPPER=<same-secret> pnpm create-api-key SERVICE "ops-client"
```

出力される値:

- `apiKey`: 呼び出し元へ渡す平文キー
- `keyPrefix`: DB保存用
- `keyDigest`: DB保存用

`apiKey` は再生成しない限り再表示できません。安全な場所に保管します。

## 7. X Account recordを作る

管理用API Clientで呼びます。

```http
POST /v1/x/accounts
Authorization: Bearer <ops-api-key>
Content-Type: application/json
```

```json
{
  "name": "Test account",
  "xUsername": "example"
}
```

作成直後は `AUTH_ERROR` です。OAuth接続後に `ACTIVE` になります。

## 8. OAuth接続する

```http
GET /v1/x/oauth/authorize?xAccountId=acc_xxx
Authorization: Bearer <ops-api-key>
```

Xの認可画面へリダイレクトされます。認可後、callbackでaccess tokenとrefresh tokenを暗号化して保存します。

## 9. Client Account Permissionを設定する

MVPでは管理APIがまだないため、`client_account_permissions` へ運用側で投入します。

必要な値:

- `client_id`
- `x_account_id`
- `permission_level`
- `max_thread_parts`
- `allowed_hours_json`

Level設計は [共通: 権限モデル](../common/permission-model.md) を参照してください。

## 10. Capabilityを確認する

Live Smoke Testで対象アカウントの実挙動を確認し、成功後にだけ更新します。

```http
PATCH /v1/x/accounts/:id/capabilities
Authorization: Bearer <ops-api-key>
Content-Type: application/json
```

```json
{
  "longformCapability": "ENABLED",
  "selfReplyCapability": "ENABLED"
}
```

## 11. Deployする

```bash
wrangler deploy
```

Deploy前には次を通してください。

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
