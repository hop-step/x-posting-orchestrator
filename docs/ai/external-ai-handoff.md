# 外部AI向け X Posting Orchestrator 利用開始ガイド

このドキュメントは、外部AIに1ファイルだけ渡して、ユーザーと対話しながら X Posting Orchestrator を使える状態にするための手順書です。

外部AIはX APIを直接呼びません。このAPIでPublicationを作成し、実際のX投稿は予約時刻にWorker/Queueが行います。

## 外部AIが最初にユーザーへ確認すること

ユーザーに次を依頼してください。

1. 専用APIキーを用意してください。
2. 投稿先の `xAccountId` を教えてください。
3. 投稿予定時刻のタイムゾーンを教えてください。日本向け運用は通常 `Asia/Tokyo` / `+09:00` です。
4. 投稿は「承認待ちで保存」か「自動予約まで進める運用」かを教えてください。
5. 投票、画像、スレッド、follow-up返信を使うか教えてください。

APIキーは会話ログへ残さず、AIツールのSecret/Environment設定が使える場合はそこへ保存するよう案内してください。どうしてもチャットで渡す場合は、専用の低権限キーを使い、作業後に無効化またはローテーションする前提にしてください。

## 外部AIが要求してはいけないもの

次の情報は要求しないでください。

- Cloudflare API token
- X Developer key / secret
- X OAuth token / refresh token
- `API_KEY_PEPPER`
- `TOKEN_ENCRYPTION_KEY_V1`
- Basic認証ID/PASS
- 管理者APIキー
- 承認者用APIキー

外部AIが必要とするのは、原則として専用APIキー、API base URL、投稿先 `xAccountId` だけです。

## API base URL

本番API:

```text
https://x-posting-orchestrator.watapyon117.workers.dev
```

API endpointは `/v1/...` です。

Authorization header:

```http
Authorization: Bearer <api-key>
```

書き込み操作では操作ごとに新しい `Idempotency-Key` を付けます。

```http
Idempotency-Key: <uuid>
```

## 推奨APIキー設定

外部AIごとにAPI Clientを分けてください。共有キーは使わないでください。

安全寄りの推奨:

```json
{
  "actorType": "AI",
  "scopes": [
    "account:read",
    "publication:preview",
    "publication:create",
    "publication:read"
  ],
  "permissionLevel": 2
}
```

この設定では、外部AIは投稿案を作成できますが、承認権限は持ちません。投票、画像、スレッド、follow-up返信などは承認待ちとして保存されます。

任意で付与してよいscope:

```json
[
  "publication:update",
  "publication:cancel",
  "media:create"
]
```

外部AIに付与しないscope:

```json
[
  "publication:approve",
  "publication:reject",
  "publication:reconcile",
  "publication:retry",
  "account:manage"
]
```

`AI` Actorには承認系scopeを付与しないでください。サーバー側でも拒否されます。

## APIキーがまだない場合にユーザーへ依頼すること

外部AIは、ユーザーに次を依頼してください。

```text
管理者に、外部AI専用のAPI Clientを発行してもらってください。

推奨設定:
- actorType: AI
- scopes: account:read, publication:preview, publication:create, publication:read
- permissionLevel: 2
- 対象xAccountId: 投稿したいXアカウントのID

発行後、apiKeyだけをSecret/Environmentへ設定してください。
keyDigest, API_KEY_PEPPER, Cloudflare/X関連secretは共有しないでください。
```

管理者がリポジトリ上で発行する場合の例:

```bash
X_POSTING_ADMIN_API_KEY=<account:manage付きの既存APIキー> pnpm create-remote-api-client AI "external-ai-client" --x-account-id <xAccountId>
```

初回で `API_KEY_PEPPER` が未作成の場合は、管理者が先に次を実行します。

```bash
pnpm init-api-key-pepper
```

または、初回生成とAPIキー生成を同時に行います。

```bash
pnpm create-api-key AI "external-ai-client" --init-pepper
```

出力される `apiKey` は外部AI用Secretへ渡します。本番Worker経由で発行した場合、D1登録は自動で完了します。`API_KEY_PEPPER` は共有しません。

DB登録の考え方:

```sql
INSERT INTO api_clients (
  id, name, actor_type, key_prefix, key_digest, status, scopes_json,
  expires_at_ms, last_used_at_ms, daily_request_limit, daily_publish_limit,
  created_at_ms, updated_at_ms
) VALUES (
  'client_external_ai_xxx',
  'external-ai-client',
  'AI',
  '<keyPrefix>',
  '<keyDigest>',
  'ACTIVE',
  '["account:read","publication:preview","publication:create","publication:read"]',
  NULL,
  NULL,
  100,
  20,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);

INSERT INTO client_account_permissions (
  client_id, x_account_id, permission_level, policy_id, max_thread_parts,
  allowed_hours_json, created_at_ms, updated_at_ms
) VALUES (
  'client_external_ai_xxx',
  '<xAccountId>',
  2,
  NULL,
  10,
  NULL,
  CAST(strftime('%s','now') AS INTEGER) * 1000,
  CAST(strftime('%s','now') AS INTEGER) * 1000
);
```

## 接続確認

APIキーを受け取ったら、まず接続確認します。

```http
GET /healthz
```

次に、投稿先アカウントを確認します。

```http
GET /v1/x/accounts
Authorization: Bearer <api-key>
```

確認すること:

- 投稿先 `xAccountId` が存在する
- `status` が `ACTIVE`
- follow-up返信やスレッドを使う場合、`self_reply_capability` が `ENABLED`
- 長文投稿を使う場合、`longform_capability` が `ENABLED` または運用上許容されている

`account:read` scopeがない場合は、ユーザーから渡された `xAccountId` を使ってください。

## 投稿作成の基本ルール

`scheduledAt` は必ずtimezone offset付きISO 8601にします。

```text
2026-07-03T09:00:00+09:00
```

`content.madeWithAi` は通常指定しません。省略すると `false` になり、X APIへ `made_with_ai` は送られません。どうしてもX上でAIラベリングしたい場合だけ指定してください。

```json
{
  "content": {
    "text": "AIラベルを付けたい投稿本文",
    "madeWithAi": true
  }
}
```

通常の投稿ではこうします。

```json
{
  "content": {
    "text": "投稿本文"
  }
}
```

## 投稿作成フロー

必ず `preview` してから `create` します。

```http
POST /v1/publications/preview
Authorization: Bearer <api-key>
Content-Type: application/json
```

問題なければ同じbodyで作成します。

```http
POST /v1/publications
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

create後の状態で次の行動を決めます。

| status | 外部AIがユーザーへ伝えること |
|---|---|
| `SCHEDULED` | 予約完了。`publication.id` と投稿予定時刻を伝える |
| `PENDING_APPROVAL` | 承認待ち。`publication.id`, `revision`, `contentHash`, 投稿内容, 投稿予定時刻を伝え、承認者に承認を依頼する |
| `DRAFT` | 下書き。外部AIではsubmitしない。人間またはSERVICEへ引き継ぐ |
| `FAILED` / `BLOCKED_POLICY` | 失敗または直前停止。重複作成せず、管理者に確認を依頼する |
| `DELIVERY_UNKNOWN` | 重複防止のためretryしない。人間にX上の投稿有無確認を依頼する |

`qa_id` や出典IDなど、Xへ投稿しない管理用情報はトップレベル `memo` に入れます。`memo` は管理画面に表示されますが、Xには送信されず、承認用 `contentHash` にも含まれません。

## 通常テキスト投稿の例

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-03T09:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "今日の学習ポイントをお届けします。"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

## 投票投稿の例

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-03T09:00:00+09:00",
  "kind": "POLL",
  "content": {
    "text": "【登録販売者試験 1問1答！】\n\n問題文...\n\n#登録販売者 #登録販売者試験 #くま登販",
    "poll": {
      "options": ["正", "誤", "わからない"],
      "durationMinutes": 10080
    }
  },
  "memo": {
    "qa_id": "R7_2_396"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

投票期間を最長にしたい場合は、運用上 `10080` 分、つまり7日を指定します。

## 親投稿に5分後の返信を紐づける例

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-03T09:00:00+09:00",
  "kind": "POLL",
  "content": {
    "text": "【登録販売者試験 1問1答！】\n\n問題文...\n\n#登録販売者 #登録販売者試験 #くま登販",
    "poll": {
      "options": ["正", "誤", "わからない"],
      "durationMinutes": 10080
    }
  },
  "followUps": [
    {
      "trigger": {
        "type": "AFTER_PARENT_PUBLISHED",
        "offsetMinutes": 5
      },
      "content": {
        "text": "【誤】が正しい！\n\n【解説】\n解説文..."
      }
    }
  ],
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

これはPublication内で作成された親投稿へ返信します。すでにX上に存在する投稿へ返信したい場合は `replyToPostId` を使います。

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-03T09:05:00+09:00",
  "replyToPostId": "2072314870444540211",
  "kind": "TEXT",
  "content": {
    "text": "返信本文"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

## 承認待ちになった場合のユーザーへの案内テンプレート

```text
投稿案は保存できましたが、承認待ちです。

- Publication ID: <publication.id>
- Revision: <revision>
- Content Hash: <contentHash>
- 投稿先: <xAccountId>
- 投稿予定: <scheduledAt>

管理画面または承認権限を持つ人に承認を依頼してください。
外部AIはapprove/reject/reconcile/retryを実行しません。
```

## 状態確認

```http
GET /v1/publications/:id
Authorization: Bearer <api-key>
```

一覧:

```http
GET /v1/publications?limit=20
Authorization: Bearer <api-key>
```

重複投稿を避けるため、同じ内容・同じ日時で再作成する前に、既存Publicationを確認してください。

## 失敗時のルール

- `DELIVERY_UNKNOWN` はretryしない
- `FAILED` は外部AIだけでretryしない
- `QUEUED` / `PUBLISHING` は待つ
- `PENDING_APPROVAL` は承認者へ依頼する
- 同じ `Idempotency-Key` は同じbodyの再送にだけ使う
- APIキーやAuthorization headerを回答やログに出さない

## 外部AIの初回メッセージ例

外部AIは、このドキュメントを受け取ったら次のようにユーザーへ依頼してください。

```text
X Posting Orchestratorを使うため、次を教えてください。

1. 専用APIキーをSecret/Environmentに設定してください。チャット本文には貼らないでください。
2. API base URLを教えてください。未指定なら https://x-posting-orchestrator.watapyon117.workers.dev を使います。
3. 投稿先のxAccountIdを教えてください。わからなければ、account:read権限付きAPIキーで一覧取得します。
4. 投稿日時はJSTでよいですか。
5. 投稿は承認待ち保存でよいですか。投票、画像、follow-up返信は承認待ちになる前提です。
6. 作成したい投稿本文、選択肢、follow-up返信、投稿日時をください。
```
