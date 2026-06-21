# Delivery UnknownとDLQ対応

Delivery UnknownとDLQは、重複投稿を避けるために慎重に扱います。

## Delivery Unknown

`DELIVERY_UNKNOWN` は、Xに投稿された可能性を否定できない状態です。

例:

- timeout
- connection reset
- X API 5xx
- response解析不能
- 成功風responseだがPost IDがない

この状態では自動retryしません。

## 対応手順

1. 対象PublicationとStepを確認
2. 対象Xアカウントの投稿一覧を人間が確認
3. 投稿されていたら `PUBLISHED` としてreconcile
4. 投稿されていなければ `NOT_PUBLISHED` としてreconcile
5. `NOT_PUBLISHED` 確定後だけretry

## 投稿済みとして確定

```http
POST /v1/publications/:id/reconcile
Authorization: Bearer <human-api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "stepId": "step_123",
  "outcome": "PUBLISHED",
  "xPostId": "1234567890",
  "comment": "X上で投稿を確認"
}
```

## 未投稿として確定

```json
{
  "stepId": "step_123",
  "outcome": "NOT_PUBLISHED",
  "comment": "X上と投稿履歴を確認"
}
```

この後にretryできます。

```http
POST /v1/publications/:id/retry
Authorization: Bearer <human-or-ops-api-key>
Idempotency-Key: <uuid>
```

## DLQ

QueueのDLQは `x-publish-dlq` です。

DLQ messageを見るときは、次を確認します。

- `publicationId`
- `revision`
- `contentHash`
- `leaseToken`
- `reason`
- `enqueuedAtMs`

古いrevision、古いcontentHash、leaseToken不一致のmessageは再投入してはいけません。現在のPublication状態を確認し、必要なら新しいretry操作で再投入します。

## やってはいけないこと

- Delivery Unknownを確認なしにretryする
- DLQ messageを機械的に再投入する
- X上で投稿済みか不明なまま同じStepを再送する
- 投稿済みStepの `xPostId` を消す
