# 画像・投票・スレッド

## 画像投稿

画像はPublication作成前に `/v1/media` へアップロードします。

```http
POST /v1/media
Authorization: Bearer <api-key>
Content-Type: multipart/form-data
```

Fields:

```text
xAccountId: string
file: binary
altText: string, optional
aiGenerated: boolean, optional
```

対応形式:

```text
image/jpeg
image/png
image/webp
```

画像は拡張子ではなくMagic Bytesで判定します。1ファイル5MB以下、最大4枚です。

Publicationでは `mediaIds` を指定します。

```json
{
  "xAccountId": "acc_123",
  "scheduledAt": "2026-06-22T12:00:00+09:00",
  "kind": "IMAGE",
  "content": {
    "text": "今日の学習メモです。",
    "mediaIds": ["media_123"]
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

画像投稿は人間承認が必要です。

## 投票投稿

```json
{
  "xAccountId": "acc_123",
  "scheduledAt": "2026-06-22T12:00:00+09:00",
  "kind": "POLL",
  "content": {
    "text": "苦手な分野は？",
    "poll": {
      "options": ["医薬品", "人体", "法規", "安全対策"],
      "durationMinutes": 1440
    }
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

投票と画像は同時に使えません。

投票本文は標準文字数内である必要があります。投票は人間承認が必要です。

## 投票後follow-up

```json
{
  "followUps": [
    {
      "trigger": {
        "type": "AFTER_POLL_CLOSE",
        "offsetMinutes": 5
      },
      "content": {
        "text": "回答ありがとうございました！"
      }
    }
  ]
}
```

trigger:

```text
AFTER_PARENT_PUBLISHED
AFTER_POLL_CLOSE
```

follow-upは最大3件です。対象Xアカウントの `self_reply_capability` が `ENABLED` である必要があります。

## 既存X投稿IDへの返信

すでにX上に存在する投稿へ返信する場合は、Publication requestに `replyToPostId` を指定します。

```json
{
  "xAccountId": "acc_123",
  "scheduledAt": "2026-07-02T12:05:00+09:00",
  "replyToPostId": "2072314870444540211",
  "kind": "TEXT",
  "content": {
    "text": "補足です。"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

`replyToPostId` は数字だけのX投稿IDです。指定した場合、最初のStepがその投稿への返信として作成されます。

## スレッド

標準文字数を超えるTEXTをスレッド化するには、`overflowPolicy: THREAD` を指定します。

```json
{
  "overflowPolicy": "THREAD",
  "threadOptions": {
    "numbering": true,
    "maxParts": 10,
    "mediaPlacement": "FIRST"
  }
}
```

スレッドでは、2件目以降は直前の成功Post IDへ返信します。

Step 2以降で失敗しても、成功済みStepは再投稿されません。

## 長文Fallback

```json
{
  "overflowPolicy": "LONGFORM_THEN_THREAD"
}
```

この場合、PRIMARYは長文単一投稿、FALLBACKはスレッドです。

Fallbackへ切り替えるのは、X APIから「長文利用不可」や「文字数超過」など、投稿未作成と判断できる明示的なエラーを受けた場合だけです。

timeout、5xx、接続断、解析不能responseではFallbackしません。`DELIVERY_UNKNOWN` で停止します。
