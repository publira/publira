# locales

サーバー（Go）、Web（Next.js）、モバイル（Flutter）が同じファイルを読む、共有メッセージカタログです。

形式は JSON です。`ja.json` を型とキーの正とし、他ロケール（初版は `en.json`）は同じキー集合を持ちます。欠けるキーも余るキーもコンパイルエラーにします。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `index.json` | 対応言語、表示名、`Intl` 用 BCP 47 タグの唯一の手編集レジストリ |
| `ja.json` | 正本。キーと入れ子の形はここが基準 |
| `en.json` | `ja.json` と同じキー。訳だけが違う |

葉は必ず文字列です。

```json
{
  "errors": {
    "validation": "入力内容を確認してください。"
  }
}
```

キー `"errors.validation"` は入れ子 `errors.validation` を指します。トップレベルに同じ名前の文字列キーがあるときは、そちらの完全一致が勝ります。

## メッセージ構文

葉は Unicode MessageFormat 2.0（[UTS #35 Part 9](https://www.unicode.org/reports/tr35/tr35-messageFormat.html) 48.2、Stable）の **simple message** です。ベンダー独自の書式ではなく Unicode の標準なので、Go と Flutter が同じカタログを読むときも同じ定義を参照できます。

書けるのは本文のテキスト、エスケープ、変数参照の 3 つだけです。

| 書きたいもの | 書き方 | 文言 | JSON に書くとき |
| --- | --- | --- | --- |
| 値の差し込み | `{$name}` | `通知、未読{$count}件` | `"通知、未読{$count}件"` |
| 波括弧そのもの | `\{` / `\}` | `検索構文は \{query\} です` | `"検索構文は \\{query\\} です"` |
| バックスラッシュそのもの | `\\` | `C:\\Users` | `"C:\\\\Users"` |

右の 2 列が違うのは、JSON 文字列でもバックスラッシュがエスケープ文字だからです。MF2 のエスケープ 1 つにつき、ファイルにはバックスラッシュを 2 つ書きます。

変数名は `[A-Za-z_][A-Za-z0-9_]*` です。MF2 の `name` はもっと広い範囲を認めますが、名前は `getMessage` に渡す `Record` のキーであり、Go と Flutter も同じ名前を走査するので、カタログ側で ASCII に絞っています。

値が渡らなかった変数は、MF2 の fallback である `{$name}` のまま出力されます。文の残りは失われません。日時と数値の整形は `@publira/utils` の `formatDateTime` / `formatDate` が表示タイムゾーンを受け取って行い、整形済みの文字列を `{$name}` に渡します。

### 使わないもの

選択（`.match`）と関数（`:number` / `:datetime`）、マークアップ、宣言（`.input` / `.local`）、引用パターン（`{{…}}`）は使いません。`@publira/i18n` はこれらを構文エラーとして拒否します。MF2 の実装は JavaScript 以外にはまだ薄く、Dart には存在しないため、3 つの読み手が手書きで揃えられる大きさに構文を保っています。

そのため、先頭が `.` で始まる文言は書けません（MF2 では複合メッセージの宣言と区別できないため）。読点や記号で始めるか、文頭に別の語を置いてください。

### 検査

`pnpm locales:check` が全ロケールの全葉をパースし、simple message として妥当でない葉をキー付きで報告します。

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
3. `pnpm locales:check` が通ることを確認する（葉が simple message として妥当か検査される）
4. `pnpm --filter @publira/i18n typecheck` が通ることを確認する（`ExactCatalog` の検査が `packages/i18n` のテストから掛かる）

## ロケールを増やすとき

手編集する一覧は `index.json` だけです。TypeScript の静的 import マップと Go の許可リストは生成物なので、個別に編集しません。

1. このディレクトリに `<code>.json` を足し、上の「キーを足すとき」どおり `ja.json` と同じキーにする
2. `index.json` の `locales` に `{ "code": "<code>", "label": "…", "intl": "…" }` を足す
3. `pnpm locales:generate` を実行して生成物を更新する
4. `pnpm preflight` と `task server:test-short` を実行する
