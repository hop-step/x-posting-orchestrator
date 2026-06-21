# USER TASKS

このファイルには、実装や自動テストだけでは完了できず、ユーザー側の手続き・外部環境情報が必要な項目を列挙します。

## Cloudflare

- [ ] Cloudflare D1 database `x-posting-orchestrator` を作成し、`wrangler.jsonc` の `database_id` を実IDへ差し替える。
- [ ] R2 bucket `x-posting-media` を作成する。
- [ ] Queue `x-publish` と Dead Letter Queue `x-publish-dlq` を作成する。
- [ ] Worker secrets `API_KEY_PEPPER`, `TOKEN_ENCRYPTION_KEY_V1`, `X_CLIENT_ID`, `X_CLIENT_SECRET`, `PUBLIC_BASE_URL` を登録する。
- [ ] 管理画面Originが決まったら `ALLOWED_CORS_ORIGINS` に設定する。

## X Developer Platform

- [ ] X Developer Appを作成し、OAuth 2.0 Authorization Code Flow with PKCE を有効化する。
- [ ] OAuth callback URLを `PUBLIC_BASE_URL/v1/x/oauth/callback` で登録する。
- [ ] 必要スコープ `tweet.read tweet.write users.read offline.access media.write` を設定する。
- [ ] テスト用Xアカウントを用意し、Live Smoke Testでのみ実投稿を行う。

## Capability確認

- [ ] 長文投稿が対象アカウントで利用可能か手動確認し、確認後に `longform_capability` を更新する。
- [ ] 自己返信・自己スレッド・投票後リプライが対象アカウントで利用可能か手動確認し、確認後に `self_reply_capability` を更新する。
