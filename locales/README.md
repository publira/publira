# locales

サーバー（Go）、Web（Next.js）、モバイル（Flutter）が同じファイルを読む、共有メッセージカタログです。

形式は JSON です。`ja.json` を型とキーの正とし、他ロケール（初版は `en.json`）は同じキー集合を持ちます。欠けるキーも余るキーもコンパイルエラーにします。

## ファイル

| ファイル  | ロケール | 役割                               |
| --------- | -------- | ---------------------------------- |
| `ja.json` | `ja`     | 正本。キーと入れ子の形はここが基準 |
| `en.json` | `en`     | `ja.json` と同じキー。訳だけが違う |

葉は必ず文字列です。補間は `{name}` のみです（ICU / 複数形は使いません）。

```json
{
  "locale": {
    "ja": "日本語",
    "en": "英語"
  }
}
```

キー `"locale.ja"` は入れ子 `locale.ja` を指します。トップレベルに同じ名前の文字列キーがあるときは、そちらの完全一致が勝ります。

## 読み方

カタログの中身を増やすのは各画面の Issue です。このディレクトリは置き場と形式だけを決めます。読み取り側は動的パスを組み立てず、ロケールごとに静的なパスを書きます。

アプリ横断の共有コピー（RPC エラー分類、フォームのバリデーション要約、`searchParamEnum` の拒否メッセージ）は `errors.*` に置きます。`@publira/utils/catalog` と `@publira/api-client/error-messages` がここを読みます。

トップレベルのキーは読み手ごとに分かれます。1 つのアプリでしか出ない文言は、そのアプリの名前空間の下に置いてください。

| トップレベル | 読み手                                                    |
| ------------ | --------------------------------------------------------- |
| `errors`     | 3 アプリ共通のエラー文言                                  |
| `locale`     | 表示言語の切替 UI（`web-platform` / `web-admin` 共通）    |
| `email`      | Go サーバーと `@publira/email-templates` が描画するメール |
| `platform`   | `web-platform`（プラットフォームコンソール）の画面文言    |

アプリ名前空間の中は画面（またはひとまとまりの領域）ごとに区切り、複数の画面が同じ文言を使うときだけ、その領域の共通セクション（`platform.auth.fields` など）に上げます。

### TypeScript（`@publira/utils/i18n`）

```ts
import { loadMessages, type Locale } from "@publira/utils/i18n";

import type ja from "../../locales/ja.json";

export type Messages = typeof ja;

export const loadCatalog = (locale: Locale) =>
  loadMessages<Messages>(locale, {
    en: () => import("../../locales/en.json", { with: { type: "json" } }),
    ja: () => import("../../locales/ja.json", { with: { type: "json" } }),
  });
```

JSON は import attributes（`with { type: "json" }`）を付けます。`import()` のパスはテンプレート文字列にしないでください。バンドラがロケール分を全部束ねます。欠け・余剰キーの検査は `packages/utils` の `ExactCatalog` テストがルートカタログ全体に対して行います。

### Go

```go
//go:embed ja.json en.json
var files embed.FS

raw, err := files.ReadFile(locale + ".json")
```

埋め込み元はリポジトリルートの `locales/` です。サーバー側はビルドコンテキストからこのディレクトリを見えるようにします。

### Flutter

`pubspec.yaml` の assets に `../locales/` を足し、ロケールごとにファイルを開きます。パスを実行時に連結してよいのはアセット API だけで、Web の `import()` とは違います。

## キーを足すとき

1. `ja.json` にキーを足す
2. 同じキーを `en.json` にも足す（訳が未定なら英語でも、空文字にはしない）
3. `pnpm --filter @publira/utils typecheck` が通ることを確認する（`ExactCatalog` の検査が `packages/utils` のテストから掛かる）

## ロケールを増やすとき

対応ロケール一覧は TypeScript と Go で二重管理です。ファイルを足すだけでは足りません。

1. このディレクトリに `<code>.json` を足し、上の「キーを足すとき」どおり `ja.json` と同じキーにする
2. `packages/utils/src/i18n.ts` の `LOCALES`（と `INTL_LOCALES`）にコードを足す
3. `server/internal/locale` の `Supported` に同じコードを足す（テナント / プラットフォーム既定言語の API 検証がここを見る）
4. 各アプリの `loadMessages` 呼び出しが持つ importer マップにも静的な `import()` を足す
