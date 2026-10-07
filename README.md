# X投稿くん / X Posting Orchestrator

Cloudflare Workers + Hono + D1で動く、Xの予約投稿APIと管理画面です。外部AIやバッチは投稿案をAPIへ保存し、必要な人間承認を経て、CronとQueue ConsumerがXへ投稿します。

## できること

- 本文、画像、投票、スレッド、投稿後の時間差返信を予約
- 既存のX Post IDへの返信、複数XアカウントのOAuth接続
- API Clientごとのscopeとアカウント別権限、承認必須・自動予約の設定
- 管理画面で「要確認」「問題あり」「予約済」を確認、編集、取消、一括承認
- 投稿に送信しない`memo`の保存。問題IDなどを管理画面で確認
- Discordへの承認確認・投稿失敗通知と管理画面へのリンク
- 冪等性キー、期限付き承認、暗号化したOAuth token、送信結果不明時の照合
- `GET /v1/docs/ai`で最新の外部AI向けMarkdownを取得

投稿本文の標準・長文判定、画像や投票の制約はプランナーで検証します。長文は最大25,000文字を想定していますが、実際に投稿できる内容は接続先Xアカウント・X APIの利用条件にも依存します。`madeWithAi`は省略時`false`です。

## 構成

| リソース | 用途 |
| --- | --- |
| Workers / Hono | 管理画面、認証付きREST API、OAuth callback |
| D1 | API Client、Xアカウント、予約、承認、投稿結果、監査ログ |
| R2 | 投稿前の画像保管。画像を使う場合はR2を有効化 |
| Cron Trigger | 1分ごとに投稿予定を確認 |
| Queues / DLQ | 投稿処理と配信失敗メッセージの保管 |
| Worker Secrets | APIキーのpepper、OAuth情報、暗号化キー、Basic認証 |

このリポジトリに認証情報やDBの投稿データは含まれません。自分のCloudflareアカウントへリソースを作成し、以下の設定を行ってください。

## 1. 開発環境

Node.js 24と`pnpm@11.8.0`、Cloudflareアカウント、投稿用X Developer Appを用意します。WranglerはプロジェクトのdevDependencyを使います。

```bash
git clone https://github.com/hop-step/x-posting-orchestrator.git
cd x-posting-orchestrator
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`pnpm build`はデプロイのdry runです。自動テストはFake X Adapterなどを使い、実際のX投稿は行いません。

## 2. Cloudflareリソース

```bash
pnpm wrangler login
pnpm wrangler whoami
pnpm wrangler d1 create x-posting-orchestrator
pnpm wrangler r2 bucket create x-posting-media
pnpm wrangler queues create x-publish
pnpm wrangler queues create x-publish-dlq
```

`wrangler.jsonc`を自分の環境に合わせて編集します。

| 設定 | 入れる値 |
| --- | --- |
| `name` | 自分のWorker名 |
| `d1_databases[0].database_name` | 作成したD1名 |
| `d1_databases[0].database_id` | D1作成時に表示されたID。全ゼロの値を置き換える |
| `r2_buckets[0].bucket_name` | 作成したR2名 |
| Queue producer / consumer / `dead_letter_queue` | 作成したQueue / DLQ名 |
| `vars.PUBLIC_BASE_URL` | 自分のWorker URL。末尾に`/v1`や`/admin`を付けない |

Worker URLは通常`https://<Worker名>.<自分のworkers.devサブドメイン>.workers.dev`です。設定の`example.workers.dev`はプレースホルダーです。R2バケットの公開設定は不要です。

Migrationを適用し、空のDBで最初のWorkerをデプロイします。

```bash
pnpm wrangler d1 migrations apply DB --local
pnpm wrangler d1 migrations apply DB --remote
pnpm wrangler deploy
```

初回デプロイでWorkerを作成してから、次のSecretsと管理者登録を行います。この時点では投稿予約はありません。

## 3. SecretsとBasic認証

初回だけpepperを生成・登録します。

```bash
pnpm init-api-key-pepper
```

32ランダムbytesから生成した値をWorker Secretへ登録し、`.secrets/api-key-pepper`へ保存します。既存の本番pepperを自動で上書きしません。pepperを変更すると既存APIキーが使えなくなるため、安全な場所へ保管してください。

以下は対話式で値を入力します。

```bash
pnpm wrangler secret put TOKEN_ENCRYPTION_KEY_V1
pnpm wrangler secret put X_CLIENT_ID
pnpm wrangler secret put X_CLIENT_SECRET
pnpm wrangler secret put ADMIN_BASIC_USERNAME
pnpm wrangler secret put ADMIN_BASIC_PASSWORD
```

| Secret | 内容 |
| --- | --- |
| `TOKEN_ENCRYPTION_KEY_V1` | `openssl rand -hex 32`で生成した64桁hex。OAuth tokenのAES-256-GCM暗号化用 |
| `X_CLIENT_ID` / `X_CLIENT_SECRET` | X Developer AppのOAuth 2.0 Client ID / Client Secret |
| `ADMIN_BASIC_USERNAME` | 管理画面のBasic認証ID。例: `openssl rand -hex 8`で生成 |
| `ADMIN_BASIC_PASSWORD` | Basic認証パスワード。例: `openssl rand -hex 24`で生成 |

`PUBLIC_BASE_URL`は`wrangler.jsonc`の非秘密設定です。Basic認証は管理画面の入口、Bearer APIキーはAPI操作の認証です。APIにはBasic認証ID/PASSを送る必要はありません。

## 4. 初回管理用API ClientをD1へ登録

最初の管理者だけは、APIキー生成とD1登録の両方を行います。

```bash
pnpm create-api-key HUMAN "admin"
```

出力された`apiKey`をパスワード管理ツールへ保存します。コマンドはキーを生成するだけで、D1登録は行いません。`keyPrefix`と`keyDigest`を以下へ入れ、`.secrets/admin-client.sql`として作成してください。SQLには`apiKey`の平文を入れません。

```sql
INSERT INTO api_clients (
  id, name, actor_type, key_prefix, key_digest, status, scopes_json,
  expires_at_ms, last_used_at_ms, daily_request_limit, daily_publish_limit,
  created_at_ms, updated_at_ms
) VALUES (
  'client_admin', 'admin', 'HUMAN', '<keyPrefix>', '<keyDigest>', 'ACTIVE',
  '["account:read","account:manage","publication:preview","publication:create","publication:submit","publication:read","publication:update","publication:cancel","publication:approve","publication:reject","publication:retry","publication:reconcile","media:create"]',
  NULL, NULL, NULL, NULL,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
```

```bash
pnpm wrangler d1 execute DB --remote --file .secrets/admin-client.sql
```

初回用のINSERTです。既存管理者がいる場合は再実行せず、管理画面から権限を管理してください。

## 5. X Developer AppとXアカウント接続

X Developer PortalでOAuth 2.0 Authorization Code Flow with PKCEと書き込み権限を有効にし、Web AppとしてClient ID / Secretを取得します。

Callback URLを、自分のWorkerのURLで登録します。

```text
https://<自分のWorkerホスト>/v1/x/oauth/callback
```

アプリが要求するscopeは`tweet.read tweet.write users.read offline.access media.write`です。

1. `https://<自分のWorkerホスト>/admin`を開き、Basic認証でログインします。
2. 管理用`apiKey`を入力して「接続」します。
3. 「Xアカウント」を開いて追加し、「X接続」で対象アカウントを認可します。
4. callback成功後は管理画面へ戻ります。`ACTIVE`になったことを確認します。
5. スレッド・時間差返信・長文を使う場合は、テスト投稿後にCapabilityを設定します。詳しくは[アカウントCapability](docs/admin/x-account-capabilities.md)を参照してください。

Xアカウント追加時、その管理用API Clientにはアカウント権限level 3が付きます。外部AIへこの管理者キーを渡さず、次の専用Clientを発行します。

## 6. 外部AI用APIキー

既存の管理者キーを環境変数`X_POSTING_ADMIN_API_KEY`へ設定して実行します。環境変数はパスワード管理ツールなどから読み込み、履歴やGitへ平文を残さないようにします。

```bash
pnpm create-remote-api-client AI "external-my-project" \
  --base-url https://<自分のWorkerホスト> \
  --x-account-id acc_xxx
```

Worker側でAPI Clientとアカウント権限をD1へ登録し、APIキーを一度だけ返します。標準は承認必須のlevel 2です。画像を使う場合は管理画面で`media:create`を追加します。

外部AIへ渡すのは、専用`apiKey`、自分のAPI base URL、許可した`xAccountId`、[external-ai-handoff.md](docs/ai/external-ai-handoff.md)です。管理者キー、pepper、XのSecretは渡しません。Clientごとの権限は管理画面の「APIクライアント」で確認・変更できます。

## 7. Discord通知（任意）

承認確認と投稿失敗の通知には管理画面へのリンクが付きます。承認・却下は管理画面で行います。

Webhookを使う場合は通知先チャンネルのWebhook URLを登録します。

```bash
pnpm wrangler secret put DISCORD_APPROVAL_WEBHOOK_URL
pnpm wrangler secret put DISCORD_FAILURE_WEBHOOK_URL
```

失敗用Webhookを省略すると承認用Webhookへ送ります。Botを使う場合は、Botをサーバーへ招待し、対象チャンネルの閲覧・メッセージ送信・リンク埋め込みを許可して以下を登録します。

```bash
pnpm wrangler secret put DISCORD_BOT_TOKEN
pnpm wrangler secret put DISCORD_APPROVAL_CHANNEL_ID
# 失敗通知を別チャンネルへ送る場合だけ
pnpm wrangler secret put DISCORD_FAILURE_CHANNEL_ID
```

Bot設定はWebhookより優先されます。リンク通知だけならInteractions Endpointや`DISCORD_PUBLIC_KEY`の設定は不要です。

## ローカル動作確認

```bash
cp .dev.vars.example .dev.vars
mkdir -p .secrets
pnpm wrangler d1 migrations apply DB --local
```

`.dev.vars`のpepper、暗号化キー、Basic認証パスワードをローカル用のランダム値へ置き換えます。pepperには本番とは別の値を使います。

ローカル用pepperを`API_KEY_PEPPER`環境変数にも設定し、`pnpm create-api-key HUMAN "local-admin"`でローカル用キーを生成します。前述のSQLへそのprefix/digestを入れ、`--remote`の代わりに`--local`で登録します。環境変数は使用後に`unset API_KEY_PEPPER`で解除します。

```bash
pnpm wrangler dev --local --port 8787
curl http://localhost:8787/healthz
```

ブラウザで[ローカル管理画面](http://localhost:8787/admin)を開き、ローカルのBasic認証とAPIキーを使います。D1・R2・Queueはローカルのシミュレーションです。X OAuth・実投稿は外部通信なので、自動テストのFake X Adapterとは異なり、実サービスへの接続には別途テスト用アカウントが必要です。

`pnpm live-x-smoke-test`は現状、実投稿を行うテストではなく環境確認用の入口です。実際のX動作はテスト用Xアカウントで少数の投稿を作成し、X上の結果も確認してください。

## 運用

- Cronは1分間隔です。予約時刻後、Queueを経て投稿されます。
- 承認必須の投稿は期限前に管理画面で承認します。編集すると承認が無効になる場合があります。
- `DELIVERY_UNKNOWN`候補は本文・返信先・時刻付近を照合し、未投稿と確認できた場合に上限付きで再試行します。照合できない場合や上限到達時は停止してDiscordへ通知します。
- 管理画面の一覧はこれからの投稿管理用です。過去投稿はAPIまたはD1から確認できます。
- Secretsの変更は影響を確認してから行います。暗号化キーを無計画に変更すると保存済みtokenを復号できません。
- 構造化ログは`pnpm wrangler tail`、配信失敗はDLQと監査ログで確認できます。

継続デプロイはMigrationが必要なら適用後、`pnpm wrangler deploy`を実行します。独自の本番設定を`wrangler.production.jsonc`へ保存する場合は、各Wranglerコマンドに`--config wrangler.production.jsonc`を付けてください。このファイルはGit管理外です。

## ドキュメント

- [ドキュメント目次](docs/README.md)
- [利用開始](docs/user/getting-started.md) / [AIユースケース](docs/ai/use-case-guide.md)
- [API Client管理](docs/admin/api-client-management.md)
- [運用](docs/admin/operations.md) / [DLQとreconcile](docs/admin/dlq-and-reconcile.md)
- [状態と安全ルール](docs/common/status-and-safety.md)
- [公開前の機密情報監査](docs/admin/public-source-audit.md)
- [OpenAPI](openapi.yaml)

`.secrets/`、`.dev.vars`、`.env`、ローカルDB、秘密鍵、配布ZIPはGit管理外です。機密情報のスキャンにはGitleaksを使用できます。

```bash
gitleaks git . --log-opts=--all --redact
gitleaks git . --staged --redact
```

## 公式ドキュメント

- [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [R2](https://developers.cloudflare.com/r2/)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
- [Worker Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [X OAuth 2.0 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code)
- [X Create Post](https://docs.x.com/x-api/posts/create-post)
