"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { cn } from "@publira/utils";
import Image from "next/image";
import { useCallback, useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

import { eyeCatchAspectClassName, eyeCatchAspectOrder } from "./aspects";
import type { EyeCatchVariantItem } from "./types";

interface EyeCatchVariantSelectorProps {
  localPreviewUrl: string;
  onImageClick: () => void;
  onSelectVariantType: (typeKey: string) => void;
  selectedVariantType: string | null;
  variants: EyeCatchVariantItem[];
}

export const EyeCatchVariantSelector = ({
  localPreviewUrl,
  onImageClick,
  onSelectVariantType,
  selectedVariantType,
  variants,
}: EyeCatchVariantSelectorProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  const handleButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      const { typeKey } = event.currentTarget.dataset;
      if (typeKey) {
        onSelectVariantType(typeKey);
      }
      onImageClick();
    },
    [onImageClick, onSelectVariantType]
  );

  const variantsByType = new Map<string, typeof variants>();
  for (const variant of variants) {
    if (!variantsByType.has(variant.variantType)) {
      variantsByType.set(variant.variantType, []);
    }
    variantsByType.get(variant.variantType)?.push(variant);
  }

  for (const variantList of variantsByType.values()) {
    variantList.sort((a, b) => b.width - a.width);
  }

  const displayGroups = [...variantsByType.entries()].toSorted(
    (a, b) => eyeCatchAspectOrder(a[0]) - eyeCatchAspectOrder(b[0])
  );

  if (variants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {getMessage(messages, "admin.eye_catch.variants_empty")}
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {displayGroups.map(([typeKey, typeVariants]) => {
        const isSelected = selectedVariantType === typeKey;
        const variantAlt = getMessage(messages, "admin.eye_catch.variant_alt", {
          variant_type: typeKey,
        });
        const fallbackVariant = typeVariants.at(-1);
        if (!fallbackVariant) {
          return null;
        }

        const sourcesToRender = typeVariants.slice(0, -1).toReversed();

        return (
          <button
            className={cn(
              "grid cursor-pointer gap-2 rounded-lg border p-2 transition-all",
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
                eyeCatchAspectClassName(typeKey),
                isSelected ? "border-blue-500" : "border-border/50"
              )}
            >
              {localPreviewUrl ? (
                <Image
                  alt={variantAlt}
                  className="h-full w-full object-cover"
                  fill
                  sizes="(max-width: 768px) 50vw, 240px"
                  src={localPreviewUrl}
                  unoptimized
                />
              ) : (
                <picture>
                  {sourcesToRender.map((variant, index) => {
                    const nextSize =
                      index > 0
                        ? sourcesToRender[index - 1].width
                        : fallbackVariant.width;
                    return (
                      <source
                        key={variant.label}
                        media={`(max-width: ${nextSize - 1}px)`}
                        srcSet={variant.url}
                      />
                    );
                  })}
                  {/* blob/remote preview sources; next/image cannot take srcSet art direction */}
                  {/* oxlint-disable-next-line react-doctor/nextjs-no-img-element */}
                  <img
                    alt={variantAlt}
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
