# email-templates

React Email の共通レイアウトとテンプレートです。HTML / テキストへの変換は `renderEmail` が行い、SMTP 送信は Go 側の責務です（[#285](https://github.com/publira/publira/issues/285)）。

`apps/email-renderer`（[#623](https://github.com/publira/publira/issues/623)）が `RenderEmail` RPC の入力をこのパッケージへ渡します。

## 提供物

- `EmailLayout` / `EmailButton`
- `sample` — レイアウト確認用
- `tenant_admin_invitation` — テナント管理者招待（初版の業務テンプレート）
- `resolveEmail` / `renderEmail` — proto の `template` / `data` を検証して描画
- `loadEmailMessages` — ルート `locales/` から 1 ロケール分を `import()` する

テンプレート ID と変数名は Epic の仕様どおり snake_case です。文面はルート `locales/*.json` の `email.*` です。描画はカタログを引数で受け取り、パッケージは文面を埋め込みません。

`locale` と `timeZone` も呼び出し側が渡します。未知の `locale` は `ja` です。`timeZone` は IANA 名で、招待の `expires_at`（RFC3339）をそのゾーンで表示します。

呼び出し側は `Temporal` が必要です。テストは `temporal-polyfill/global` を読みます。`email-renderer` も同じポリフィルをプロセス起動時に読み込んでください。

## 使い方

```ts
import { loadEmailMessages, renderEmail } from "@publira/email-templates";

const locale = "ja";
const result = await renderEmail({
  template: "tenant_admin_invitation",
  locale,
  timeZone: "Asia/Tokyo",
  messages: await loadEmailMessages(locale),
  data: {
    invite_url: "https://admin.example.com/accept-invite?token=…",
    tenant_name: "青灯書房",
    expires_at: "2030-01-15T12:00:00Z",
  },
});

if (!result.ok) {
  // reason: "unknown_template" | "invalid_data"
  throw new Error(result.message);
}

result.subject;
result.html;
result.text;
```

## ビルド

```bash
pnpm --filter @publira/email-templates build
```
