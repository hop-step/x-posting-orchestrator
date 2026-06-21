# 投稿依頼の始め方

このドキュメントは、X Posting Orchestrator を使ってX投稿依頼を作る利用者向けです。

## 基本の流れ

```text
preview -> create -> approval or scheduled -> published
```

まず `preview` で検証・分割・ポリシー判定を確認します。問題がなければ `create` でPublicationを保存します。

## 重要な考え方

このシステムでは、API利用者が直接Xへ投稿することはありません。

利用者が行うのはPublicationの作成です。X APIを呼ぶのは予約時刻に動くQueue Consumerだけです。

## 認証

API呼び出しには内部APIキーを使います。

```http
Authorization: Bearer xps_xxxxx.yyyyy
```

書き込みAPIでは `Idempotency-Key` も必要です。

```http
Idempotency-Key: <client-generated-uuid>
```

同じkeyと同じbodyなら同じresponseが返ります。同じkeyで違うbodyを送ると `409` です。

## 最小のpreview

```http
POST /v1/publications/preview
Authorization: Bearer <api-key>
Content-Type: application/json
```

```json
{
  "xAccountId": "acc_123",
  "scheduledAt": "2026-06-22T12:00:00+09:00",
  "kind": "TEXT",
  "content": {
    "text": "本日の学習ポイントをお届けします。"
  },
  "overflowPolicy": "REJECT",
  "approvalPreference": "POLICY"
}
```

`scheduledAt` はtimezone offset付きISO 8601が必要です。`2026-06-22T12:00:00` のようなoffsetなし日時は拒否されます。

## 作成

```http
POST /v1/publications
Authorization: Bearer <api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

Request bodyはpreviewと同じです。

Responseの `publication.status` を確認します。

| Status | 次にすること |
|---|---|
| `DRAFT` | 権限者にsubmitしてもらう |
| `PENDING_APPROVAL` | 承認者のapprove待ち |
| `SCHEDULED` | 予約済み |

## 自動予約されるケース

Level 3のClientで、ポリシー上安全なTEXT単文の場合だけ `SCHEDULED` になります。

URL、画像、投票、スレッド、長文、follow-up replyは基本的に人間承認が必要です。

## Xに投稿されるタイミング

`SCHEDULED` のPublicationは、毎分動くCronによりQueueへ入ります。Queue Consumerが投稿直前チェックを通過した場合だけXへ投稿します。

通常時は予約時刻から2分以内の処理開始が目標です。
