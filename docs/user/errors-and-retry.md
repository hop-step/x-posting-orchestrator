# エラーと再実行

## エラー形式

```json
{
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Human approval is required.",
    "details": {
      "reasons": ["POLL_REQUIRES_HUMAN_APPROVAL"]
    }
  },
  "requestId": "req_123"
}
```

問い合わせ時は `requestId` を添えてください。

## 主なHTTP status

| Status | 意味 |
|---:|---|
| 400 | JSON形式や必須値が不正 |
| 401 | 未認証 |
| 403 | scope、account、permission不足 |
| 404 | 対象なし、または閲覧権限なし |
| 409 | revision不一致、状態競合、冪等キー競合 |
| 422 | ドメイン検証またはポリシー違反 |
| 429 | 内部APIのrate limit |
| 500 | 内部エラー |
| 502 | 外部APIの明示的障害 |

## よくあるエラー

### `DATETIME_OFFSET_REQUIRED`

`scheduledAt` にtimezone offsetがありません。

OK:

```text
2026-06-22T12:00:00+09:00
```

NG:

```text
2026-06-22T12:00:00
```

### `IDEMPOTENCY_KEY_CONFLICT`

同じ `Idempotency-Key` で違うbodyを送りました。

新しい操作には新しいkeyを使ってください。

### `REVISION_OR_HASH_MISMATCH`

承認や却下のrequestに含めた `revision` / `contentHash` が現在値と一致しません。

Publicationを再取得し、最新の値で操作してください。

### `SELF_REPLY_CAPABILITY_REQUIRED`

スレッドまたはfollow-up replyに必要な自己返信能力が有効化されていません。

管理者に対象Xアカウントのcapability確認を依頼してください。

## Retry

retryできるのは、投稿未作成と判断できる明示的失敗だけです。

```http
POST /v1/publications/:id/retry
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
```

`DELIVERY_UNKNOWN` はretryできません。

## Delivery Unknown

`DELIVERY_UNKNOWN` は、Xに投稿された可能性がある状態です。

利用者側では、自分で再送せず、管理者または承認者にreconcileを依頼してください。

reconcileで `NOT_PUBLISHED` と確定した後だけretryできます。

## 取消

予約前やQueue投入直後のPublicationはcancelできます。

```http
POST /v1/publications/:id/cancel
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
```

既にXへ1件でも投稿済みの場合、システムは自動削除しません。
