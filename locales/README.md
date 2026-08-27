# locales

サーバー（Go）、Web（Next.js）、モバイル（Flutter）が同じファイルを読む、共有メッセージカタログです。

形式は JSON です。`ja.json` を型とキーの正とし、他ロケール（初版は `en.json`）は同じキー集合を持ちます。欠けるキーも余るキーもコンパイルエラーにします。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `index.json` | 対応言語、表示名、`Intl` 用 BCP 47 タグの唯一の手編集レジストリ |
| `ja.json` | 正本。キーと入れ子の形はここが基準 |
| `en.json` | `ja.json` と同じキー。訳だけが違う |

葉は必ず文字列です。補間は `{name}` のみです（ICU / 複数形は使いません）。

```json
{
  "errors": {
    "validation": "入力内容を確認してください。"
  }
}
```

キー `"errors.validation"` は入れ子 `errors.validation` を指します。トップレベルに同じ名前の文字列キーがあるときは、そちらの完全一致が勝ります。

## 読み方

カタログの中身を増やすのは各画面の Issue です。このディレクトリは置き場と形式だけを決めます。読み取り側は動的パスを組み立てず、`index.json` から生成した静的 import マップを共有します。

アプリ横断の共有コピー（RPC エラー分類、フォームのバリデーション要約、`searchParamEnum` の拒否メッセージ）は `errors.*` に置きます。`@publira/i18n/catalog` と `@publira/api-client/error-messages` がここを読みます。

トップレベルのキーは読み手ごとに分かれます。1 つのアプリでしか出ない文言は、そのアプリの名前空間の下に置いてください。

| トップレベル | 読み手                                                    |
| ------------ | --------------------------------------------------------- |
| `errors`     | 3 アプリ共通のエラー文言                                  |
| `locale`     | 表示言語の切替 UI（`web-platform` / `web-admin` 共通）    |
| `email`      | Go サーバーと `@publira/email-templates` が描画するメール |
| `platform`   | `web-platform`（プラットフォームコンソール）の画面文言    |
| `admin`      | `web-admin`（テナント管理コンソール）の画面文言           |
| `host`       | `web-host`（テナント公開サイト）の画面文言                |

アプリ名前空間の中は画面（またはひとまとまりの領域）ごとに区切り、複数の画面が同じ文言を使うときだけ、その領域の共通セクション（`platform.auth.fields` など）に上げます。

### TypeScript（`@publira/i18n`）

```ts
import { loadLocaleMessages } from "@publira/i18n/messages";
import type { Locale } from "@publira/i18n";

export const loadCatalog = (locale: Locale) => loadLocaleMessages(locale);
```

生成物の JSON import には import attributes（`with { type: "json" }`）を付けます。`import()` のパスはテンプレート文字列にしません。欠け・余剰キーの検査は `@publira/i18n` の `ExactCatalog` テストがルートカタログ全体に対して行います。

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
3. `pnpm --filter @publira/i18n typecheck` が通ることを確認する（`ExactCatalog` の検査が `packages/i18n` のテストから掛かる）

## ロケールを増やすとき

手編集する一覧は `index.json` だけです。TypeScript の静的 import マップと Go の許可リストは生成物なので、個別に編集しません。

1. このディレクトリに `<code>.json` を足し、上の「キーを足すとき」どおり `ja.json` と同じキーにする
2. `index.json` の `locales` に `{ "code": "<code>", "label": "…", "intl": "…" }` を足す
3. `pnpm locales:generate` を実行して生成物を更新する
4. `pnpm preflight` と `task server:test-short` を実行する
