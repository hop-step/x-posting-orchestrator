# 権限モデル

このシステムの権限は、API Client単体ではなく、API ClientとX Accountの組み合わせで決まります。

## Scope

API Clientにはscopeがあります。

代表例:

```text
publication:preview
publication:create
publication:submit
publication:read
publication:update
publication:cancel
publication:approve
publication:reject
publication:retry
publication:reconcile
media:create
account:read
account:manage
```

API endpointごとに必要scopeがあり、足りない場合は拒否します。

## Actor Type

```text
AI
HUMAN
SERVICE
```

AI Actorは承認系操作を実行できません。

禁止されるscope:

```text
publication:approve
publication:reject
publication:reconcile
```

運用上、AI ActorのAPI Clientにはこれらを付与しないでください。仮に誤ってDBへ入っていても、実行時に拒否します。

## Permission Level

Permission Levelは、API ClientとX Accountの組み合わせに設定します。

| Level | 名称 | 動作 |
|---:|---|---|
| 0 | `DENY` | 投稿作成不可 |
| 1 | `DRAFT_ONLY` | 下書き作成のみ |
| 2 | `HUMAN_APPROVAL_REQUIRED` | 人間承認後に予約 |
| 3 | `POLICY_BASED_AUTO` | ポリシー内のみ自動予約 |

## Level別の典型例

### Level 1

AIや自動生成ツール向けです。Publicationは `DRAFT` になります。

`DRAFT` はそのままでは投稿されません。権限Level 2以上の `HUMAN` または運用 `SERVICE` が `submit` します。

### Level 2

人間承認が必須の運用です。Publicationは `PENDING_APPROVAL` になります。

承認者が `approve` すると `SCHEDULED` になります。

### Level 3

安全な単文だけ自動予約されます。

自動予約される条件の例:

- TEXT投稿
- 1投稿だけ
- 標準文字数内
- URLなし
- mentionなし
- 画像なし
- 投票なし
- follow-upなし
- 禁止語なし

URL、画像、投票、スレッド、長文、返信、深夜帯などは原則として承認待ちになります。

## 404と403

他Clientのリソース存在を漏らさないため、操作によっては権限不足でも `404` として返します。利用者側は、`404` を「存在しない」または「見える権限がない」と扱ってください。
