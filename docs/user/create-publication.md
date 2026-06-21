# 投稿作成ガイド

Publication作成時は、まずpreviewで結果を確認してからcreateすることを推奨します。

## TEXT投稿

```json
{
  "xAccountId": "acc_123",
  "scheduledAt": "2026-06-22T12:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "登録販売者試験の学習を今日も少しずつ進めましょう。"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

標準文字数を超える場合、`overflowPolicy` によって挙動が変わります。

| overflowPolicy | 挙動 |
|---|---|
| `REJECT` | 標準文字数超過で拒否 |
| `THREAD` | スレッド化 |
| `LONGFORM_THEN_THREAD` | 長文投稿を第一候補、明示的に不可の場合だけスレッドFallback |

## 文字数

Xの文字数は単純なJavaScriptの `string.length` ではありません。

日本語、中国語、韓国語、絵文字などは重み2として扱われます。URLはXのルールに従って計算します。

preview responseの各Stepに `weightedLength` が含まれます。

## Thread options

```json
{
  "threadOptions": {
    "numbering": true,
    "maxParts": 10,
    "mediaPlacement": "FIRST"
  }
}
```

`numbering = true` の場合、各投稿末尾に次の形式で番号が付きます。

```text
(1/4)
```

番号込みで各Stepが標準文字数内になるように再計算します。

## approvalPreference

```text
POLICY
REQUIRE_APPROVAL
```

`REQUIRE_APPROVAL` を指定すると、呼び出し元から明示的に人間承認を要求できます。

呼び出し元の指定でサーバーポリシーを緩くすることはできません。安全側にだけ倒せます。

## 編集

編集できる状態:

```text
DRAFT
PENDING_APPROVAL
SCHEDULED
```

編集するとrevisionが増え、既存承認は無効になります。

```http
PATCH /v1/publications/:id
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

編集後は、再度policy判定とplan生成が行われます。

## 取消

```http
POST /v1/publications/:id/cancel
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
```

取消できる状態:

```text
DRAFT
PENDING_APPROVAL
SCHEDULED
QUEUED
```

既にXへ1件でも投稿済みの場合、自動削除はしません。
