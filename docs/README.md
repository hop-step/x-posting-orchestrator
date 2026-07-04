# Documentation Guide

このディレクトリは、X Posting Orchestrator を利用・運用する人向けのドキュメントです。

## 読む順番

初めて読む場合は、次の順番がおすすめです。

1. [共通: 基本概念](./common/concepts.md)
2. [共通: 状態と安全ルール](./common/status-and-safety.md)
3. AIエージェントの場合: [AI向けAPI利用ガイド](./ai/use-case-guide.md)
4. 利用者の場合: [投稿依頼の始め方](./user/getting-started.md)
5. 管理者の場合: [管理者セットアップ](./admin/setup.md)

## 読者別

### 投稿利用者向け

システムを使ってXに投稿依頼を作る人、社内ツールやAIエージェントからAPIを呼ぶ人向けです。

- [投稿依頼の始め方](./user/getting-started.md)
- [投稿作成ガイド](./user/create-publication.md)
- [承認フロー](./user/approval-flow.md)
- [画像・投票・スレッド](./user/media-polls-threads.md)
- [エラーと再実行](./user/errors-and-retry.md)

### AIエージェント向け

APIを呼び出すAIが、ユースケースごとに何を確認し、次に何をすべきか判断するための手順書です。

- [AI向けAPI利用ガイド](./ai/use-case-guide.md)

### 管理者向け

Cloudflare、X OAuth、API Client、権限、Queue、DLQ、障害対応を担当する人向けです。

- [管理者セットアップ](./admin/setup.md)
- [API Clientと権限管理](./admin/api-client-management.md)
- [Xアカウント接続とCapability確認](./admin/x-account-capabilities.md)
- [運用手順](./admin/operations.md)
- [Delivery UnknownとDLQ対応](./admin/dlq-and-reconcile.md)

### 共通

管理者・利用者・承認者が同じ言葉で話すための説明です。

- [基本概念](./common/concepts.md)
- [状態と安全ルール](./common/status-and-safety.md)
- [権限モデル](./common/permission-model.md)

## API仕様

機械可読なAPI仕様は [../openapi.yaml](../openapi.yaml) にあります。

## 外部環境が必要な確認

実投稿、X OAuth、Cloudflare本番リソース、capability確認はローカル自動テストだけでは完了できません。必要な作業は [../USER_TASK.md](../USER_TASK.md) に集約しています。
