"use client";

import { cn } from "@publira/utils";
import Image from "next/image";
import { useCallback } from "react";

import type { SeriesEyeCatchVariantItem } from "../series-types";

interface EyeCatchVariantSelectorProps {
  localPreviewUrl: string;
  onImageClick: () => void;
  onSelectVariantType: (typeKey: string) => void;
  selectedVariantType: string | null;
  variants: SeriesEyeCatchVariantItem[];
}

export const EyeCatchVariantSelector = ({
  localPreviewUrl,
  onImageClick,
  onSelectVariantType,
  selectedVariantType,
  variants,
}: EyeCatchVariantSelectorProps) => {
  const handleButtonClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const { typeKey } = e.currentTarget.dataset;
      if (typeKey) {
        onSelectVariantType(typeKey);
      }
      onImageClick();
    },
    [onImageClick, onSelectVariantType]
  );
  // 各アスペクト比ごとにバリアントをグループ化
  const variantsByType = new Map<string, typeof variants>();
  for (const variant of variants) {
    if (!variantsByType.has(variant.variantType)) {
      variantsByType.set(variant.variantType, []);
    }
    variantsByType.get(variant.variantType)?.push(variant);
  }

  // 各グループのバリアントを幅でソート（降順）
  for (const variantList of variantsByType.values()) {
    variantList.sort((a, b) => b.width - a.width);
  }

  const displayGroups = [...variantsByType.entries()].toSorted((a, b) => {
    const order = ["portrait", "square", "landscape", "og"];
    return order.indexOf(a[0]) - order.indexOf(b[0]);
  });

  if (variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        まだ画像が登録されていません。
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {displayGroups.map(([typeKey, typeVariants]) => {
        const isSelected = selectedVariantType === typeKey;

        const fallbackVariant = typeVariants.at(-1);
        if (!fallbackVariant) {
          return null;
        }

        const sourcesToRender = typeVariants.slice(0, -1).toReversed();

        return (
          <button
            className={cn(
              "grid gap-2 rounded-lg border p-2",
              "cursor-pointer transition-all",
              isSelected
                ? "border-blue-500 bg-blue-50"
                : "border-border/60 hover:border-blue-300"
            )}
            data-type-key={typeKey}
            key={typeKey}
            onClick={handleButtonClick}
            type="button"
          >
            <p className="text-xs text-muted-foreground">{typeKey}</p>
            <div
              className={cn(
                "relative overflow-hidden rounded-md border bg-muted/40",
                typeKey === "landscape" && "aspect-video",
                typeKey === "og" && "aspect-1200/630",
                typeKey === "portrait" && "aspect-3/4",
                typeKey === "square" && "aspect-square",
                !["landscape", "og", "portrait", "square"].includes(typeKey) &&
                  "aspect-4/3",
                isSelected ? "border-blue-500" : "border-border/50"
              )}
            >
              {localPreviewUrl ? (
                <Image
                  alt={`生成画像 ${typeKey}`}
                  className="h-full w-full object-cover"
                  fill
                  src={localPreviewUrl}
                  unoptimized
                />
              ) : (
                <picture>
                  {sourcesToRender.map((variant, idx) => {
                    const nextSize =
                      idx > 0
                        ? sourcesToRender[idx - 1].width
                        : fallbackVariant.width;
                    return (
                      <source
                        key={variant.label}
                        media={`(max-width: ${nextSize - 1}px)`}
                        srcSet={variant.url}
                      />
                    );
                  })}
                  <img
                    alt={`生成画像 ${typeKey}`}
                    className="h-full w-full object-cover"
                    src={fallbackVariant.url}
                  />
                </picture>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
