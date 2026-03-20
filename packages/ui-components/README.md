# @publira/ui-components

web-admin / web-public などで共有利用する UI コンポーネント群です。

## 方針

- Base UI をベースにした実装を採用する
- brand token (`@publira/brand/theme.css`) と整合するスタイルにする
- 画面ごとの class の都度実装を減らすため、薄いラッパーを提供する

## インストールと読み込み

通常は workspace 依存として追加し、グローバル CSS で styles を読み込みます。

```css
@import "@publira/ui-components/styles.css";
```

## 主要コンポーネント

### フォーム関連

- [Button / LinkButton](./src/button) - ボタンコンポーネント
- [Field / FieldLabel / FieldDescription / FieldError / FieldContent](./src/field) - フォームフィールド群
- [Input](./src/input) - テキスト入力フィールド
- [Textarea](./src/textarea) - 複数行テキスト入力フィールド
- [Select](./src/select) - セレクトボックス
- [Checkbox](./src/checkbox) - チェックボックス
- [RadioGroup](./src/radio-group) - ラジオボタングループ
- [Switch](./src/switch) - スイッチ（トグル）
- [FormMessage](./src/form-message) - フォームメッセージ
- [FormActions](./src/form-actions) - フォームアクション領域

### その他

- [Badge / StatusChip](./src/badge) - 状態表示と補助ラベルのコンポーネント
- [Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter](./src/card) - カードコンポーネント
- [EmptyState](./src/empty-state) - 空の状態を表示するコンポーネント

## 使用方法

各コンポーネントの詳細な使用方法と例については、上記の主要コンポーネントリストから各コンポーネントのドキュメントを参照してください。

### Subpath import

各コンポーネントは以下のように直接インポートできます：

```tsx
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import { Card } from "@publira/ui-components/card";
```

## 開発

```bash
pnpm --filter @publira/ui-components build
```
