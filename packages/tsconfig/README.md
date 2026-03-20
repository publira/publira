# tsconfig

ワークスペース共通の TypeScript 設定を提供するパッケージです。

## 提供物

- `@publira/tsconfig/base.json`
- `@publira/tsconfig/next.json`

## 使い方

```json
{
  "extends": "@publira/tsconfig/base.json"
}
```

Next.js アプリの場合:

```json
{
  "extends": "@publira/tsconfig/next.json"
}
```

## 注意点

- 設定変更は全パッケージに影響するため、影響範囲の型チェックを実施してください。
