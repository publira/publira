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

### TypeScript（`@publira/utils/i18n`）

```ts
import {
  loadMessages,
  type ExactCatalog,
  type Locale,
} from "@publira/utils/i18n";
import en from "../../locales/en.json";
import ja from "../../locales/ja.json";

export type Messages = typeof ja;

// 欠け・余剰は型エラー。`satisfies Messages` はオブジェクトリテラル向け。
// JSON import には構造的型付けで余剰キーが通るので ExactCatalog を使う。
const _en: ExactCatalog<typeof en, Messages> = en;

export const loadCatalog = (locale: Locale) =>
  loadMessages<Messages>(locale, {
    en: () => import("../../locales/en.json"),
    ja: () => import("../../locales/ja.json"),
  });
```

`import()` のパスはテンプレート文字列にしないでください。バンドラがロケール分を全部束ねます。

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
