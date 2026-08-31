# locales

サーバー（Go）、Web（Next.js）、モバイル（Flutter）が同じファイルを読む、共有メッセージカタログです。

形式は JSON です。すべてのロケールが同じキー集合を持ち、欠けるキーも余るキーもコンパイルエラーにします。

## ファイル

| ファイル | 役割 |
| --- | --- |
| `index.json` | 対応言語、表示名、`Intl` 用 BCP 47 タグの唯一の手編集レジストリ |
| `ja.json` | 日本語のカタログ |
| `en.json` | 英語のカタログ |

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

変数名は MF2 の `name` の規則に従います（`{$series_title}` のように ASCII の識別子で書くのが慣習です）。名前は `getMessage` に渡す `Record` のキーになります。

値が渡らなかった変数は、MF2 の fallback である `{$name}` のまま出力されます。文の残りは失われません。日時と数値の整形は `@publira/utils` の `formatDateTime` / `formatDate` が表示タイムゾーンを受け取って行い、整形済みの文字列を `{$name}` に渡します。

### 実装

構文の解析と整形は npm の [`messageformat` v4](https://www.npmjs.com/package/messageformat) に任せています。MessageFormat Working Group のメンバーが書いている実装で、LDML 48（2025-10）時点の仕様に追従し、TC39 の `Intl.MessageFormat` プロポーザルのポリフィルとしても使えます。`@publira/i18n` が持っているのは、その上に載せたこのカタログ固有の方針だけです。

- 値は文字列にしてから渡します。`getMessage` はロケールを受け取らないので、`:number` のようなロケール依存の整形をここで行うとホストのロケールが混入します。数値と日時は `@publira/utils` が整形済みの文字列にしてから差し込みます
- bidi isolation は無効です。整形結果には文言どおりの文字だけが残ります。ja / en はどちらも LTR で、これらの文字列はメール件名や `<title>` にもなるため、U+2068 / U+2069 が見えないまま運ばれるのを避けています。有効化するのは最初の RTL ロケールを足すときです

### 使わないもの

選択（`.match`）、関数（`:number` / `:datetime`）、マークアップ、宣言（`.input` / `.local`）は使いません。`pnpm locales:check` がこれらを含む葉を拒否します。

- 関数を使わないのは、MF2 がテナントの表示タイムゾーンを知らないからです（root `AGENTS.md` の「Date and time」）。整形は `@publira/utils` 側に残します
- 選択は第一段階では入れません。複数形が実際に必要になった時点で、別の Issue で解禁します

そのため、先頭が `.` で始まる文言は書けません（MF2 では複合メッセージの宣言と区別できないため）。読点や記号で始めるか、文頭に別の語を置いてください。

なお、旧来の `{name}` は MF2 では**リテラル式**として構文的に妥当で、`name` という文字列に整形されてしまいます。エラーにならないので、`pnpm locales:check` が変数参照でない式として拒否します。

### 検査

`pnpm locales:check` が全ロケールの全葉を `messageformat` でパース・検証し、妥当でない葉と、上の「使わないもの」に触れた葉をキー付きで報告します。

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

1. すべてのロケールの JSON に同じキーを足す（訳が未定でも空文字にはしない）
2. `pnpm locales:check` が通ることを確認する（葉が simple message として妥当か検査される）
3. `pnpm --filter @publira/i18n typecheck` が通ることを確認する（`ExactCatalog` の検査が `packages/i18n` のテストから掛かる）

## ロケールを増やすとき

手編集する一覧は `index.json` だけです。TypeScript の静的 import マップと Go の許可リストは生成物なので、個別に編集しません。

1. このディレクトリに `<code>.json` を足し、既存のすべてのカタログと同じキーにする
2. `index.json` の `locales` に `{ "code": "<code>", "label": "…", "intl": "…" }` を足す
3. `pnpm locales:generate` を実行して生成物を更新する
4. `pnpm preflight` と `task server:test-short` を実行する
