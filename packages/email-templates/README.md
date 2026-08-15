# email-templates

React Email の共通レイアウトとテンプレートです。HTML / テキストへの変換は `renderEmail` が行い、SMTP 送信は Go 側の責務です（[#285](https://github.com/publira/publira/issues/285)）。

`apps/email-renderer`（[#623](https://github.com/publira/publira/issues/623)）が `RenderEmail` RPC の入力をこのパッケージへ渡します。

## 提供物

- `EmailLayout` / `EmailButton`
- `sample` — レイアウト確認用
- `tenant_admin_invitation` — テナント管理者招待（初版の業務テンプレート）
- `resolveEmail` / `renderEmail` — proto の `template` / `locale` / `data` を検証して描画

テンプレート ID と変数名は Epic の仕様どおり snake_case です。`locale` は `ja` / `en`。未知の値は `ja` です。

`expires_at` は RFC3339 の絶対時刻です。表示は `DEFAULT_TIME_ZONE`（`Asia/Tokyo`）です。招待 RPC はテナント TZ をまだ渡さないため、未取得時のフォールバックと同じ扱いです。

呼び出し側は `Temporal` が必要です。テストは `temporal-polyfill/global` を読みます。`email-renderer` も同じポリフィルをプロセス起動時に読み込んでください。

## 使い方

```ts
import { renderEmail } from "@publira/email-templates";

const result = await renderEmail({
  template: "tenant_admin_invitation",
  locale: "ja",
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
