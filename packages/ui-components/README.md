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

- Button / LinkButton
- Field / FieldLabel / FieldDescription / FieldError / FieldContent
- Input
- Textarea
- Select
- Checkbox
- RadioGroup
- Switch
- FormMessage
- Card / CardHeader / CardTitle / CardDescription / CardContent / CardFooter
- EmptyState
- FormActions

## 基本例

```tsx
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  Select,
} from "@publira/ui-components";

const genreOptions = [
  { label: "ファンタジー", value: "fantasy" },
  { label: "ミステリー", value: "mystery" },
  { label: "エッセイ", value: "essay" },
] as const;

export function SampleForm() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>シリーズ設定</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Field>
          <FieldLabel htmlFor="title" required>
            タイトル
          </FieldLabel>
          <Input id="title" name="title" placeholder="作品タイトル" />
          <FieldDescription>
            公開ページで表示される作品名です。
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="genre">ジャンル</FieldLabel>
          <Select
            id="genre"
            name="genre"
            defaultValue="fantasy"
            items={genreOptions}
          />
        </Field>

        <Field invalid>
          <FieldLabel htmlFor="summary">概要</FieldLabel>
          <FieldError>概要は 10 文字以上で入力してください。</FieldError>
        </Field>

        <Button type="submit">保存</Button>
      </CardContent>
    </Card>
  );
}
```

## Select の API

Select は Base UI Select のラッパーです。ネイティブの `<option>` 子要素ではなく、`items` で選択肢を渡します。

```tsx
const items = [
  { label: "公開", value: "published" },
  { label: "下書き", value: "draft" },
] as const;

<Select name="status" defaultValue="draft" items={items} />;
```

## RadioGroup / Switch / FormMessage の API

```tsx
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FormMessage,
  RadioGroup,
  Switch,
} from "@publira/ui-components";

const visibilityItems = [
  { label: "全体公開", value: "public" },
  { label: "会員限定", value: "members" },
] as const;

<Field>
  <FieldLabel required>公開範囲</FieldLabel>
  <FieldContent>
    <RadioGroup
      name="visibility"
      defaultValue="public"
      items={visibilityItems}
      required
    />
    <FieldDescription>読者の閲覧条件を選択します。</FieldDescription>
  </FieldContent>
</Field>;

<Field className="flex-row items-center justify-between gap-3">
  <FieldLabel htmlFor="notify-followers">更新通知を送る</FieldLabel>
  <Switch id="notify-followers" name="notifyFollowers" defaultChecked />
</Field>;

<FormMessage variant="success">保存に成功しました。</FormMessage>;
```

## 開発

```bash
pnpm --filter @publira/ui-components build
```
