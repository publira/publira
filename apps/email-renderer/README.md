# email-renderer

`EmailRendererService.RenderEmail` を提供し、`@publira/email-templates` のテンプレートを件名・HTML・プレーンテキストへ変換する Node.js ConnectRPC サービスです。SMTP 送信は行いません。

## 起動

```bash
pnpm --filter @publira/email-renderer dev
```

既定では `0.0.0.0:8080` で待ち受けます。`PORT` でポート、`HOST` でバインド先を変更できます。本番では先に `pnpm --filter @publira/email-renderer build` を実行し、`pnpm --filter @publira/email-renderer start` を使います。

## RPC

`publira.email.v1.EmailRendererService/RenderEmail` は、`template`、`locale`、`data`、`time_zone` を受け取り、`subject`、`html`、`text` を返します。

- `time_zone` は IANA タイムゾーン名です。テナントで解決した表示タイムゾーンを常に渡します。
- テンプレート ID またはデータが不正な場合は `invalid_argument` を返します。
- 未知の `locale` はテンプレートパッケージの規約どおり `ja` として描画します。

`GET /livez` は常に `200 ok`、`GET /readyz` は依存を持たないため `200` と `{ "status": "ok", "checks": {} }` を返します。
