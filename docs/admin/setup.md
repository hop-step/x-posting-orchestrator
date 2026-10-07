# 管理者セットアップ

Cloudflareへの初回セットアップ手順は[README](../../README.md)にまとめています。

1. Node.js / pnpmの準備と依存関係のインストール
2. D1、R2、Queues、DLQの作成とMigration、初回デプロイ
3. APIキーpepper、暗号化キー、X OAuth、Basic認証のSecret登録
4. 管理用API Clientの生成とD1への初回登録
5. X Developer Appの設定と管理画面からのアカウント接続
6. 外部AI用API Clientの発行と権限設定
7. Discordへのリンク通知とローカル動作確認

APIキー生成コマンドだけでは、初回管理用ClientのD1登録は完了しません。READMEのSQL登録まで実施してください。既存環境ではpepperを新規生成して置き換えず、既存管理者キーを使ったAPI Client発行を利用します。

## 関連する運用手順

- [API Clientとアカウント別権限](api-client-management.md)
- [XアカウントCapability](x-account-capabilities.md)
- [運用とログ](operations.md)
- [DLQと送信結果不明の確認](dlq-and-reconcile.md)
- [公開前の機密情報監査](public-source-audit.md)
