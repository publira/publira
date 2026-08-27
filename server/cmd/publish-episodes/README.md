# publish-episodes

予約公開向けの単発バッチです。

## Next.js 再検証

`PUBLIRA_REVALIDATE_TOKEN` と `PUBLIRA_WEB_HOST_INTERNAL_URL`、`PUBLIRA_WEB_ADMIN_INTERNAL_URL`、`PUBLIRA_WEB_PLATFORM_INTERNAL_URL` をすべて設定すると、公開日時に達したエピソードのキャッシュタグを全 `web-*` アプリの `POST /api/v1/revalidate` へ送信します。タグはテナント ID による制限なしにそのまま送信します。宛先は private network URL であり、公開ドメインや Traefik は使いません。いずれかの URL が未設定または不正なら再検証は無効化され、ワーカーは理由をログへ出して起動します。

## 実行

リポジトリルートから:

```bash
make run-batch-publish
```

`server` ディレクトリから:

```bash
go run ./cmd/publish-episodes
```

ビルド済みバイナリを使う場合:

```bash
cd server && make build
./bin/publish-episodes
```

## 備考

- 常駐せず、1 回の処理で終了する前提です。
