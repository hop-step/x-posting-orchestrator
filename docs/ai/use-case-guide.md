# AIエージェント向けAPI利用ガイド

このドキュメントは、AIエージェントが X Posting Orchestrator を安全に使うための手順書です。APIの全項目を網羅するリファレンスではなく、ユースケースごとに「何ができるか」「次に何をすべきか」を判断できることを目的にしています。

## 最初に守ること

AIはX APIを直接呼ばず、このAPIでPublicationを作成します。実際にXへ投稿するのは、予約時刻に動くQueue Consumerだけです。

AI Actorは次を実行しないでください。サーバー側でも拒否されます。

- 人間承認: `POST /v1/publications/:id/approve`
- 却下: `POST /v1/publications/:id/reject`
- Delivery Unknownの確定: `POST /v1/publications/:id/reconcile`
- 下書き提出: `POST /v1/publications/:id/submit`
- 投稿再実行: `POST /v1/publications/:id/retry`

AIが基本的に行うのは、`preview`、`create`、必要に応じた `list` / `get` / `patch` / `cancel` です。

## 共通の呼び出しルール

本番ホスト:

```text
https://x-posting-orchestrator.watapyon117.workers.dev
```

API endpointは `/v1/...` です。例: `POST /v1/publications`。

すべてのAPI呼び出しでは、APIキーをBearer tokenとして送ります。APIキーをログ、画面、投稿本文へ出力しないでください。

```http
Authorization: Bearer <api-key>
```

作成・変更・取消などの書き込み操作には、操作ごとに新しい `Idempotency-Key` を付けます。同じ操作をネットワーク都合で再送する場合だけ、同じkeyと同じbodyを再利用します。

```http
Idempotency-Key: <uuid>
```

`scheduledAt` は必ずtimezone offset付きISO 8601にします。

```text
2026-07-02T12:00:00+09:00
```

offsetなしの `2026-07-02T12:00:00` は使わないでください。

`content.madeWithAi` は通常指定しません。省略した場合は `false` になり、X APIへ `made_with_ai` は送られません。どうしてもX上でAIラベリングしたい場合だけ、明示的に指定してください。

```json
{
  "content": {
    "text": "AIラベルを付けたい投稿本文",
    "madeWithAi": true
  }
}
```

## ユースケース0: 接続確認と投稿先確認

できること:

- APIが生きているか確認する
- 自分のAPIキーから見えるXアカウントを確認する

手順:

```http
GET /healthz
```

```http
GET /v1/x/accounts
Authorization: Bearer <api-key>
```

次にすること:

- 投稿先の `id` を `xAccountId` として使う
- `status` が `ACTIVE` ではないアカウントへ投稿作成しない
- スレッドやfollow-upが必要なら `self_reply_capability` が有効か確認する
- 長文投稿を使うなら `longform_capability` が有効か確認する

## ユースケース1: 通常の予約テキスト投稿

できること:

- 1件のテキスト投稿を予約する
- ポリシー上安全な場合はそのまま `SCHEDULED` にできる

まずpreviewします。

```http
POST /v1/publications/preview
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T12:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "今日の学習ポイントをお届けします。"
  },
  "memo": {
    "qa_id": "R7_2_396"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

preview後に確認すること:

- `policy.decision` が `DENY` なら作成しない
- `plans[].steps[].text` で実際に投稿される本文を確認する
- `weightedLength` が意図通りか確認する
- `contentHash` は承認時に必要な値として保存・表示する
- `memo` は管理用メモです。Xには投稿されず、`contentHash` にも含まれません

問題なければcreateします。

```http
POST /v1/publications
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

bodyはpreviewと同じです。

次にすること:

| `publication.status` | AIが次にすること |
|---|---|
| `SCHEDULED` | 予約完了として、`publication.id` と投稿予定時刻を返す |
| `PENDING_APPROVAL` | 人間承認が必要と伝え、`publication.id` / `revision` / `contentHash` / `policy.reasons` を渡す |
| `DRAFT` | AIでは提出できないため、人間またはSERVICEに引き継ぐ |

## ユースケース2: 承認前提で投稿案を作る

できること:

- 人間に確認してほしい投稿案を保存する
- URL、mention、画像、投票、スレッド、長文、follow-upなどを安全側で扱う

AIが少しでも迷う場合は、`approvalPreference` を `REQUIRE_APPROVAL` にします。

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T18:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "詳細はこちらをご確認ください。https://example.com"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "REQUIRE_APPROVAL"
}
```

次にすること:

- create後の `PENDING_APPROVAL` は正常な結果として扱う
- AIはapproveしない
- 承認者へ `publication.id`、`revision`、`contentHash`、本文、投稿先、投稿日時、`policy.reasons` を渡す

## ユースケース3: 投票投稿を作る

できること:

- 2から4択のX投票を作る
- 登録販売者試験の一問一答のような選択式投稿を予約する

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T12:10:00+09:00",
  "kind": "POLL",
  "content": {
    "text": "【登録販売者試験 1問1答！】\n\n外用痔疾用薬の配合成分に関する記述について\n\n局所への穏やかな刺激によって痒みを抑える効果を期待して、冷感刺激を生じさせるクロタミトンが配合されている場合がある。\n\n#登録販売者 #登録販売者試験 #くま登販",
    "poll": {
      "options": ["正", "誤", "わからない"],
      "durationMinutes": 1440
    }
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

次にすること:

- 投票は人間承認が必要になる前提で扱う
- 画像と投票は同時に使わない
- 選択肢は2から4個にする
- durationは分で指定する

## ユースケース4: 画像付き投稿を作る

できること:

- 画像をアップロードし、画像付きPublicationを作る
- alt textを保存する

先に画像をアップロードします。

```http
POST /v1/media
Authorization: Bearer <api-key>
Content-Type: multipart/form-data
```

fields:

```text
xAccountId: acc_xxx
file: <binary>
altText: 画像の説明
aiGenerated: true
```

返ってきた `media.id` を使ってPublicationを作ります。

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T12:00:00+09:00",
  "kind": "IMAGE",
  "content": {
    "text": "今日の学習メモです。",
    "mediaIds": ["media_xxx"]
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

次にすること:

- 画像は最大4枚まで
- jpeg、png、webpのみ使う
- 画像投稿は人間承認が必要になる前提で扱う
- アップロード済みmediaを使い回す前に、対象アカウントと権限を確認する

## ユースケース5: 長文やスレッドを作る

できること:

- 標準文字数を超える本文をスレッド化する
- 長文投稿が使えるアカウントでは長文を第一候補にし、だめならスレッドへfallbackする

スレッドにしたい場合:

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T20:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "長い本文..."
  },
  "overflowPolicy": "THREAD",
  "threadOptions": {
    "numbering": true,
    "maxParts": 10,
    "mediaPlacement": "FIRST"
  },
  "approvalPreference": "POLICY"
}
```

長文優先にしたい場合:

```json
{
  "overflowPolicy": "LONGFORM_THEN_THREAD"
}
```

次にすること:

- previewの `plans` を見て、分割後の各Stepが自然か確認する
- スレッドには `self_reply_capability = ENABLED` が必要
- 長文には `longform_capability = ENABLED` が望ましい
- スレッドや長文は人間承認が必要になる前提で扱う

## ユースケース6: 既存X投稿IDへ返信する

できること:

- すでにX上に存在する投稿IDへ、予約時刻に返信する

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T12:05:00+09:00",
  "replyToPostId": "2072314870444540211",
  "kind": "TEXT",
  "content": {
    "text": "【誤】が正しい！\n\n【解説】\n局所への穏やかな刺激によって痒みを抑える効果を期待して、熱感刺激を生じさせるクロタミトンが配合されている場合がある。"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

次にすること:

- `replyToPostId` は数字だけのX投稿IDにする
- 返信先の投稿内容はこのAPIでは検証しないため、IDの取り違えに注意する
- `plans` を確認して、最初のStepだけが指定IDへの返信になる前提で扱う

## ユースケース7: 投稿後のfollow-up replyを作る

できること:

- ルート投稿の公開後に返信を予約する
- 投票終了後に返信を予約する

```json
{
  "xAccountId": "acc_xxx",
  "scheduledAt": "2026-07-02T12:00:00+09:00",
  "kind": "POLL",
  "content": {
    "text": "今日の問題です。",
    "poll": {
      "options": ["正", "誤", "わからない"],
      "durationMinutes": 1440
    }
  },
  "followUps": [
    {
      "trigger": {
        "type": "AFTER_POLL_CLOSE",
        "offsetMinutes": 5
      },
      "content": {
        "text": "回答ありがとうございました。解説はこちらです。"
      }
    }
  ],
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

次にすること:

- follow-upは最大3件
- `self_reply_capability = ENABLED` が必要
- follow-upは人間承認が必要になる前提で扱う
- Publication内で作成された親投稿への返信として扱う。既存X投稿IDへの返信は `replyToPostId` を使う

## ユースケース8: 投稿状態を確認する

できること:

- 自分のAPI Clientから見える投稿を一覧する
- 特定Publicationの詳細、plans、approvalsを確認する

```http
GET /v1/publications?limit=100
Authorization: Bearer <api-key>
```

```http
GET /v1/publications/:id
Authorization: Bearer <api-key>
```

次にすること:

| Status | AIが次にすること |
|---|---|
| `DRAFT` | 人間またはSERVICEにsubmitを依頼する |
| `PENDING_APPROVAL` | 承認待ちとして表示する |
| `SCHEDULED` / `QUEUED` / `PUBLISHING` | 待つ。重複作成しない |
| `AWAITING_FOLLOW_UP` | follow-up待ちとして表示する |
| `PUBLISHED` | 完了として、保存されたX Post IDがあれば表示する |
| `PARTIALLY_PUBLISHED` | 一部投稿済み。AIはretryせず、人間またはSERVICEに確認を依頼する |
| `RETRY_SCHEDULED` | 再実行待ちとして表示し、重複作成しない |
| `FAILED` | 人間またはSERVICEにretry判断を依頼する |
| `DELIVERY_UNKNOWN` | 人間にX上の投稿有無確認とreconcileを依頼する |
| `BLOCKED_POLICY` | 実行直前に止まった状態として、人間または管理者に確認を依頼する |
| `REJECTED` / `CANCELLED` | 終了状態として扱う |

## ユースケース9: 投稿内容を修正または取消する

できること:

- 投稿前のPublicationを更新する
- 投稿前のPublicationを取消する

編集できる状態:

```text
DRAFT
PENDING_APPROVAL
SCHEDULED
```

```http
PATCH /v1/publications/:id
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

PATCH bodyには変更したい項目を入れます。更新後はrevisionが増え、既存承認は無効になります。

取消:

```http
POST /v1/publications/:id/cancel
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
```

次にすること:

- 更新後は新しい `revision` と `contentHash` を承認者へ渡す
- 1件でもXへ投稿済みの場合、自動削除はしない
- `QUEUED` 以降の取消は間に合わない可能性があるため、結果を必ず再取得する

## ユースケース10: エラー時の判断

できること:

- エラーコードから次の行動を決める
- 危険な自動再送を避ける

主な判断:

| Error code | AIが次にすること |
|---|---|
| `DATETIME_OFFSET_REQUIRED` | offset付き日時に直してpreviewからやり直す |
| `SCHEDULED_AT_IN_PAST` | 未来日時に直してpreviewからやり直す |
| `IDEMPOTENCY_KEY_CONFLICT` | 同じkeyで別bodyを送っている。新しい操作なら新しいkeyを作る |
| `POLICY_DENIED` | 作成しない。理由を人間へ返す |
| `SELF_REPLY_CAPABILITY_REQUIRED` | スレッド/follow-upをやめるか、管理者にcapability確認を依頼する |
| `REVISION_OR_HASH_MISMATCH` | 最新Publicationを再取得する |
| `DELIVERY_UNKNOWN_RETRY_FORBIDDEN` | retryしない。人間にreconcileを依頼する |

エラーresponseの `requestId` は問い合わせや調査に必要です。ユーザーへ返す内部メモに含めてください。

## ユースケース11: Xアカウント管理

できること:

- Xアカウント一覧を見る
- 管理権限がある場合だけ、Xアカウントの追加、OAuth接続URL作成、削除、capability更新を行う

AI投稿作成エージェントは、通常はアカウント管理を行いません。運用AIまたはSERVICEだけが対象です。

一覧:

```http
GET /v1/x/accounts
Authorization: Bearer <api-key>
```

OAuth接続URLの作成:

```http
GET /v1/x/oauth/authorize?xAccountId=acc_xxx&response=json
Authorization: Bearer <api-key>
```

削除:

```http
DELETE /v1/x/accounts/:id
Authorization: Bearer <api-key>
```

削除時の注意:

- 未完了Publicationがあるアカウントは削除できない
- 削除は実Xアカウントを消す操作ではなく、このシステム内の接続情報を消す操作
- 既存の実運用アカウントを削除する前に、人間確認を入れる

## AIの最小行動テンプレート

投稿作成を頼まれたら、次の順番で動きます。

1. 投稿先 `xAccountId` と投稿日時を確定する
2. `scheduledAt` をoffset付き未来日時にする
3. 投稿種別を `TEXT` / `IMAGE` / `POLL` から選ぶ
4. 画像がある場合は先に `/v1/media` へアップロードする
5. `/v1/publications/preview` を呼ぶ
6. `policy.decision = DENY` なら止める
7. `plans` と `policy.reasons` を確認する
8. `/v1/publications` で保存する
9. `SCHEDULED` なら予約完了、`PENDING_APPROVAL` / `DRAFT` なら人間またはSERVICEへ引き継ぐ
10. 以後は重複作成せず、`GET /v1/publications/:id` で状態を見る

## ユーザーへ返すべき情報

投稿作成後、AIは最低限これを返します。

```text
publication.id
publication.status
publication.scheduledAtUtc
publication.revision
publication.contentHash
policy.decision
policy.reasons
次に必要な操作
```

APIキー、OAuth token、Basic認証情報、暗号化済みtoken、内部secretは返さないでください。
