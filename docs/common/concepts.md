# 基本概念

X Posting Orchestrator は、Xへの投稿を直接実行するAPIではありません。投稿依頼を保存し、権限・ポリシー・必要な人間承認を通過したものだけを、Queue Consumer が予約時刻にXへ送信する仕組みです。

## Publication

Publication は「投稿依頼」です。

Publicationには次の情報が含まれます。

- 投稿先Xアカウント
- 投稿本文
- 投稿種別: `TEXT`, `IMAGE`, `POLL`
- 投稿日時
- 画像、投票、follow-up reply
- 長文時の扱い
- 投稿計画
- 承認状態
- 実行状態

利用者が作るのはX投稿そのものではなく、Publicationです。

## Publication Plan

Publication Plan は、PublicationをXへどう投稿するかを表す計画です。

例:

```text
PRIMARY  = LONGFORM_SINGLE
FALLBACK = THREAD
```

長文投稿では、長文投稿を第一候補にし、利用できないことが明確な場合だけ承認済みのスレッド計画へ切り替えます。

承認時には `PRIMARY` と `FALLBACK` の両方が `contentHash` に含まれます。承認後に本文分割を作り直すと承認の意味が変わるため、再承認が必要です。

## Publication Step

Publication Step は、Xへ送る1回分の投稿です。

例:

- 単文投稿の1件
- スレッドの1件目
- スレッドの2件目以降
- 投票終了後のfollow-up reply

Queue Consumer はStepごとに送信し、成功したStepにはXのPost IDを保存します。再実行時は、Post IDが保存済みのStepを再送しません。

## Media Asset

Media Asset は、R2に保存した投稿前画像です。

画像投稿では、API利用者が `/v1/media` で画像をアップロードし、Publicationには `mediaIds` を指定します。Xへ投稿する直前に、ConsumerがR2から画像を読み、X media uploadで得たmedia IDを投稿に添付します。

## contentHash

`contentHash` は、承認対象の内容をCanonical JSON化してSHA-256にした値です。

含まれるもの:

- 投稿先Xアカウント
- 投稿日時
- 正規化済み本文
- 画像ID
- 投票内容
- follow-up reply
- PRIMARY Plan
- FALLBACK Plan
- overflow policy
- revision

承認APIでは `revision` と `contentHash` の一致が必要です。承認後に本文、画像、日時、投稿先、分割設定などが変わるとrevisionが増え、既存承認は無効になります。

## Actor

API ClientにはActor Typeがあります。

```text
AI
HUMAN
SERVICE
```

AI Actorは投稿依頼を作れますが、承認・却下・reconcileはできません。これはDB投入時の想定だけでなく、アプリケーション実行時にも拒否します。

## X Account Capability

Xアカウントごとに、利用できる機能を手動確認後に設定します。

```text
longform_capability: UNKNOWN | ENABLED | DISABLED
self_reply_capability: UNVERIFIED | ENABLED | DISABLED
```

`UNKNOWN` や `UNVERIFIED` は有効扱いしません。自己返信、スレッド、投票後リプライ、長文投稿は、対象アカウントで実際に使えることを確認してから有効化します。
