# API Clientと権限管理

API Clientは、このシステムを呼び出す主体です。管理画面、社内ツール、AIエージェント、バッチ処理ごとに分けることを推奨します。

## APIキーの形式

```text
xps_<key-prefix>.<secret>
```

DBには平文を保存しません。

保存する値:

- `key_prefix`
- `key_digest`

`key_digest` は `HMAC-SHA-256(API_KEY_PEPPER, full_api_key)` です。

## APIキー生成

初回だけ `API_KEY_PEPPER` を生成してCloudflare Secretへ登録します。

```bash
pnpm init-api-key-pepper
```

このコマンドは `.secrets/api-key-pepper` に同じ値を保存します。このディレクトリはgit管理外です。Cloudflare側に既に `API_KEY_PEPPER` が存在し、ローカル値がない場合は、既存APIキーを壊さないため上書きせず停止します。

```bash
API_KEY_PEPPER=<same-secret> pnpm create-api-key SERVICE "ops-client"
```

`.secrets/api-key-pepper` がある場合は環境変数を省略できます。

```bash
pnpm create-api-key AI "external-ai-client"
```

本番稼働後に外部AI用Clientを追加する場合は、既存の管理用APIキーを使って本番Workerに発行させます。この方法ではローカルに `API_KEY_PEPPER` は不要で、D1登録まで自動で行われます。

```bash
X_POSTING_ADMIN_API_KEY=<account:manage付きの既存APIキー> pnpm create-remote-api-client AI "external-ai-client" --x-account-id acc_xxx
```

初回セットアップとAPIキー生成を同時に行う場合:

```bash
pnpm create-api-key AI "external-ai-client" --init-pepper
```

出力例:

```json
{
  "clientName": "ops-client",
  "actorType": "SERVICE",
  "apiKey": "xps_xxxxxx.yyyyyy",
  "keyPrefix": "xps_xxxxxx",
  "keyDigest": "..."
}
```

`apiKey` は呼び出し元に一度だけ共有します。紛失時は新しいClientまたは新しいkeyを発行してください。

## Actor Typeの使い分け

| Actor Type | 用途 |
|---|---|
| `AI` | 投稿案作成、preview、draft作成 |
| `HUMAN` | 承認者、運用者 |
| `SERVICE` | 管理画面、社内システム、バッチ |

AI Actorには次を付与しないでください。

```text
publication:approve
publication:reject
publication:reconcile
```

## Scope設計

最小権限で付与します。

投稿作成だけのツール:

```json
[
  "publication:preview",
  "publication:create",
  "publication:read"
]
```

承認者:

```json
[
  "publication:read",
  "publication:approve",
  "publication:reject"
]
```

運用者:

```json
[
  "publication:read",
  "publication:retry",
  "publication:reconcile",
  "account:read",
  "account:manage"
]
```

画像アップロードを行うClient:

```json
[
  "media:create",
  "publication:create",
  "publication:preview",
  "publication:read"
]
```

## Permission Level設計

X Accountごとに `client_account_permissions` を設定します。

| Level | 推奨用途 |
|---:|---|
| 0 | 一時停止、明示拒否 |
| 1 | AIや投稿候補生成ツール |
| 2 | 人間承認必須の社内ツール |
| 3 | 安全な単文のみ自動化したい運用Service |

Level 3でも、URL、画像、投票、スレッド、長文、follow-upは承認待ちになります。

## 無効化

API Clientを止める場合は、`api_clients.status` を `DISABLED` にします。

X Accountごと止める場合:

```http
POST /v1/x/accounts/:id/disable
Authorization: Bearer <ops-api-key>
```

停止後、Queue Consumerの投稿直前再検証でも弾かれます。
