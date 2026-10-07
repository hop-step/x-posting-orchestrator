# Security Review

## 実装済みの安全条件

- 未認証の `/v1/*` request は middleware で 401。
- APIキーは `key_prefix` 検索、`HMAC-SHA-256(API_KEY_PEPPER, full_api_key)` 保存、定時間比較。
- AI actor は approval/reject/reconcile scope を実行時拒否。
- X投稿は Queue Consumer のみが `XClient` を呼ぶ。
- Queue message は revision/contentHash/leaseToken/status を再検証。
- 成功済み step は `xPostId` を見て再送しない。
- Delivery Unknown候補は本文・返信先・時刻付近を照合し、未投稿と確認できた場合のみ上限付きで再実行。照合できない場合は停止し、reconcileが必要。
- 承認後の編集は revision を増やし、active approval を無効化。
- OAuth state と PKCE verifier は10分期限・一回利用・暗号化保存。
- Access/Refresh token は AES-256-GCM で暗号化。
- 構造化ログ・audit log に token/API key/本文全文を保存しない設計。

## 外部環境で確認する事項

- X Developer App の scope 設定。
- callback URL の一致。
- テスト用Xアカウントでの自己返信、自己スレッド、投票後リプライ可否。
- 長文投稿 capability。
- Cloudflare Queue DLQ の動作。
