# Card

カードコンポーネント群です。カード全体、ヘッダー、タイトル、説明文、コンテンツ、フッターから構成されます。

## 使用方法

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@publira/ui-components";

export default function Example() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Title</CardTitle>
        <CardDescription>Card description</CardDescription>
      </CardHeader>
      <CardContent>Card content goes here</CardContent>
      <CardFooter>Footer content</CardFooter>
    </Card>
  );
}
```

## Subpath import

```tsx
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@publira/ui-components/card";
```

## コンポーネント一覧

- `Card` - カード全体のコンテナ
- `CardHeader` - ヘッダー領域
- `CardTitle` - タイトル
- `CardDescription` - 説明文
- `CardContent` - メインコンテンツ
- `CardFooter` - フッター領域
