# 運用手順

このドキュメントは、日常運用とリリース前確認のための管理者向け手順です。

## 日常確認

最低限、次を定期的に確認します。

- `PENDING_APPROVAL` が滞留していないか
- `FAILED` が増えていないか
- `DELIVERY_UNKNOWN` が未対応のまま残っていないか
- `x-publish-dlq` にmessageが残っていないか
- X Accountが `AUTH_ERROR` になっていないか
- Queue遅延が大きくなっていないか

## リリース前チェック

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` は `wrangler deploy --dry-run --outdir dist` です。Cloudflare binding設定の検証も兼ねます。

## Migration

ローカル:

```bash
wrangler d1 migrations apply x-posting-orchestrator --local
```

リモート:

```bash
wrangler d1 migrations apply x-posting-orchestrator --remote
```

本番では、Migration後にヘルスチェックと簡単なpreview APIを確認します。

## Token再接続

X APIでtoken refreshが失敗すると、X Accountは `AUTH_ERROR` になります。

対応:

1. 対象accountの状態を確認
2. OAuth authorize URLを開く
3. 対象Xアカウントで再認可
4. callback成功を確認
5. `x_accounts.status = ACTIVE` になったことを確認
6. テスト投稿またはpreviewで疎通確認

## 予約投稿の遅延

Cronは1分間隔です。通常時は予約時刻から2分以内の処理開始を目標にします。

遅延時に見るもの:

- Cron triggerが有効か
- Queueが詰まっていないか
- `lease_until_ms` が残り続けていないか
- `RETRY_SCHEDULED` がrate limitで滞留していないか
- X API障害がないか

## 失敗時の原則

`FAILED` と `DELIVERY_UNKNOWN` は別物です。

`FAILED`:

- 投稿未作成と判断できる明示的失敗
- 原因修正後にretry可能

`DELIVERY_UNKNOWN`:

- 投稿された可能性がある
- 自動retry禁止
- 人間がX上で確認してreconcileする

## Audit Log

重要操作は `audit_logs` に記録されます。

代表イベント:

- `PUBLICATION_CREATED`
- `PUBLICATION_UPDATED`
- `PUBLICATION_APPROVED`
- `PUBLICATION_REJECTED`
- `PUBLICATION_CANCELLED`
- `PUBLICATION_QUEUED`
- `PUBLICATION_PUBLISH_STARTED`
- `PUBLICATION_STEP_PUBLISHED`
- `PUBLICATION_DELIVERY_UNKNOWN`
- `PUBLICATION_RECONCILED`
- `X_ACCOUNT_CONNECTED`
- `X_ACCOUNT_AUTH_ERROR`
- `X_ACCOUNT_DISABLED`
- `CAPABILITY_UPDATED`
- `MEDIA_UPLOADED`

本文全文、APIキー、OAuth code、access token、refresh tokenは保存しない運用です。
