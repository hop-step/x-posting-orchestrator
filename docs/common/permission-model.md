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
| 4 | `EXTENDED_AUTO` | 投票・follow-up・長文もポリシー内なら自動予約 |

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

URL、画像、投票、スレッド、長文、follow-up返信、設定した許可時間外などは原則として承認待ちになります。

### Level 4

信頼済みのAIや運用Service向けです。Level 3に加えて、投票（`POLL`）、公開後の解説返信（`followUps`）、25,000文字までの長文を、承認なしで `SCHEDULED` にできます。`followUps` は本文分割スレッドとは区別します。

次の条件はLevel 4でも維持します。

- `approvalPreference: REQUIRE_APPROVAL` は必ず承認待ち
- 画像、URL、mention、本文分割スレッド、許可時間外は承認待ち
- URL、mention、禁止表現の確認は解説本文にも適用
- 長文は `longformCapability = ENABLED` が必要。未確認・無効なら承認待ち
- follow-upは `selfReplyCapability = ENABLED` が必要。未確認・無効なら拒否
- Actorのscope、投稿先の権限、投稿数・Step数・文字数などの既存制限はそのまま
- AI ActorはLevel 4でも承認・却下・submit・retry・reconcileを実行できない

長文を自動予約する場合は `overflowPolicy: REJECT` を使用してください。`LONGFORM_THEN_THREAD` は本文分割fallbackを含むため、Level 4でも承認対象です。

既存ClientのLevelは自動では変更しません。管理者が「APIクライアント」で、対象ClientとX Accountの組み合わせにLevel 4を設定してください。新しい外部AI Clientの既定値はLevel 2のままです。

Levelを上げても、既存の `PENDING_APPROVAL` は自動では予約されません。必要な投稿だけ承認するか、未来の予約時刻のまま編集してポリシーを再評価してください。投稿直前にも作成Clientの現在の権限を再確認するため、Levelを下げると承認が必要になる場合があります。

## 404と403

他Clientのリソース存在を漏らさないため、操作によっては権限不足でも `404` として返します。利用者側は、`404` を「存在しない」または「見える権限がない」と扱ってください。
