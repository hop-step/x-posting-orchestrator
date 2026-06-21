# Xアカウント接続とCapability確認

Xアカウントごとに、長文投稿や自己返信が使えるかを管理します。

## Capability

```text
longform_capability: UNKNOWN | ENABLED | DISABLED
self_reply_capability: UNVERIFIED | ENABLED | DISABLED
```

初期値:

```text
longform_capability = UNKNOWN
self_reply_capability = UNVERIFIED
```

初期値は有効扱いしません。実アカウントで確認後にだけ `ENABLED` にします。

## 確認が必要な理由

X APIの仕様やプラン、アカウント状態によって、同じAPIでも利用できる機能が変わることがあります。

特に確認が必要なもの:

- 長文投稿
- 自分の投稿への返信
- 自己スレッド
- 投票終了後の返信

## Live Smoke Test

自動テストやCIから実投稿は行いません。テスト用Xアカウントでのみ実施します。

```bash
LIVE_X_TEST=true X_TEST_ACCOUNT_ID=<test-account> pnpm live-x-smoke-test
```

このscriptは実投稿を無条件に行うものではなく、手動スモークテストの入口です。実投稿手順は対象環境のAPI Client、X Account、permission設定が揃ってから実施します。

## 確認項目

- 通常投稿
- 画像1枚
- 画像4枚
- 投票
- 自分の投稿への返信
- 2件の自己スレッド
- 投票終了後の返信
- 長文投稿
- 長文非対応アカウントでのFallback
- Token refresh後の予約投稿

## Capability更新

確認後に更新します。

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

利用できないことを確認した場合:

```json
{
  "longformCapability": "DISABLED",
  "selfReplyCapability": "DISABLED"
}
```

## 再確認タイミング

- X Developer Appのプランや権限を変更したとき
- 対象Xアカウントを変更したとき
- X APIで返信や長文周りのエラーが増えたとき
- OAuth再接続後に投稿能力が変わった可能性があるとき
