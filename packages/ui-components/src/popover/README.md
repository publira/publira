# Popover

ヘッダーなどに配置する浮遊面のための合成プリミティブです。`PopoverContent` が Portal、配置、共通の surface スタイルを提供するため、利用側はトリガー、表示位置、内容だけを定義します。

## 使用方法

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@publira/ui-components/popover";

export const LanguageSwitcher = () => (
  <Popover>
    <PopoverTrigger aria-label="表示言語を選択">日本語</PopoverTrigger>
    <PopoverContent align="end" className="w-48" sideOffset={8}>
      <PopoverTitle className="px-2.5 py-2 text-sm font-semibold">
        表示言語
      </PopoverTitle>
      {/* 言語の選択肢 */}
    </PopoverContent>
  </Popover>
);
```

## Subpath import

```tsx
import { Popover, PopoverContent } from "@publira/ui-components/popover";
```

## Props

`PopoverContent` は Base UI の Positioner props を受け取ります。`side`、`align`、`sideOffset` などで配置を調整し、`className` で surface の幅などを追加できます。フォーカス移動を調整する場合は `popupProps` に Base UI Popup props を渡します。
