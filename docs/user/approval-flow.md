# 承認フロー

人間承認が必要なPublicationは `PENDING_APPROVAL` になります。

## 承認が必要になる例

- Permission Level 2
- URL付き投稿
- 画像投稿
- 投票
- スレッド
- 長文投稿
- follow-up reply
- mention
- 呼び出し元が `approvalPreference: REQUIRE_APPROVAL` を指定した場合

## 承認前に確認するもの

承認者は、少なくとも次を確認します。

- 投稿先Xアカウント
- 投稿日時
- 本文
- 画像
- 投票内容
- follow-up reply
- PRIMARY Plan
- FALLBACK Plan
- policy reasons

特に長文やスレッドでは、分割後の各Stepを確認してください。

## Discord承認通知

Discord連携が設定されている場合、`PENDING_APPROVAL` のPublicationが作成・更新・提出されたタイミングで、指定チャンネルへ確認メッセージが送られます。

Discordメッセージでは次を確認できます。

- Publication ID
- revision
- 投稿先Xアカウント
- 投稿日時
- 本文プレビュー
- 画像枚数
- 投票内容
- memo
- policy reasons

メッセージの `管理画面` ボタンから管理画面を開き、最新内容を確認して承認または却下します。Discordメッセージ自体からPublicationの状態は変更しません。

## 承認API

```http
POST /v1/publications/:id/approve
Authorization: Bearer <human-api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "revision": 1,
  "contentHash": "sha256-hex",
  "comment": "内容確認済み"
}
```

`revision` と `contentHash` が現在値と一致しない場合は `409` です。

## 却下API

```http
POST /v1/publications/:id/reject
Authorization: Bearer <human-api-key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

```json
{
  "revision": 1,
  "contentHash": "sha256-hex",
  "reason": "表現を修正してください"
}
```

却下後、編集して再提出する場合は `PATCH` でrevisionを増やします。

## 承認が無効になる条件

次が変わるとrevisionが増え、既存承認は無効になります。

- 本文
- 画像
- 代替テキスト
- 投稿先
- 投稿日時
- 投票
- follow-up reply
- threadOptions
- overflowPolicy

承認後に内容が変わったものをそのまま投稿しないための仕組みです。

## AI Actorは承認できない

AI Actorは承認・却下・reconcileを実行できません。

承認者は `HUMAN` ActorのAPI Clientを使ってください。
