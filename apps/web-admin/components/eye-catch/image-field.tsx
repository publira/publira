"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import type { ChangeEventHandler, RefObject } from "react";

import type { EyeCatchVariantItem } from "./types";
import { EyeCatchVariantSelector } from "./variant-selector";

interface EyeCatchImageFieldProps {
  clearEyeCatchImage: boolean;
  fileInputId: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  hasVariants: boolean;
  localPreviewUrl: string;
  onDeleteToggle: () => void;
  onImageFileChange: ChangeEventHandler<HTMLInputElement>;
  onVariantImageClick: () => void;
  onVariantTypeChange: (typeKey: string) => void;
  selectedVariantType: string | null;
  variants: EyeCatchVariantItem[];
}

export const EyeCatchImageField = ({
  clearEyeCatchImage,
  fileInputId,
  fileInputRef,
  hasVariants,
  localPreviewUrl,
  onDeleteToggle,
  onImageFileChange,
  onVariantImageClick,
  onVariantTypeChange,
  selectedVariantType,
  variants,
}: EyeCatchImageFieldProps) => (
  <Field>
    <FieldLabel htmlFor={fileInputId}>アイキャッチ画像</FieldLabel>
    <FieldContent>
      <div className="grid gap-2">
        {!hasVariants || clearEyeCatchImage ? (
          <button
            className="relative aspect-[3/4] overflow-hidden rounded-md border-2 border-dashed border-border/60 bg-muted/40 transition-colors hover:border-blue-300"
            onClick={onVariantImageClick}
            type="button"
          >
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">
                {clearEyeCatchImage
                  ? "削除予定です。画像を選択すると差し替えます"
                  : "画像を選択してください"}
              </p>
            </div>
          </button>
        ) : (
          <EyeCatchVariantSelector
            localPreviewUrl={localPreviewUrl}
            onImageClick={onVariantImageClick}
            onSelectVariantType={onVariantTypeChange}
            selectedVariantType={selectedVariantType}
            variants={variants}
          />
        )}

        {hasVariants ? (
          <div className="pt-1">
            <button
              className={cn(
                "text-sm underline underline-offset-4",
                clearEyeCatchImage
                  ? "text-destructive"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={onDeleteToggle}
              type="button"
            >
              {clearEyeCatchImage
                ? "削除を取り消す"
                : "現在のアイキャッチ画像を削除する"}
            </button>
          </div>
        ) : null}
      </div>

      <Input
        accept="image/jpeg,image/png,image/webp"
        id={fileInputId}
        name="eye_catch_image"
        onChange={onImageFileChange}
        ref={fileInputRef}
        style={{ display: "none" }}
        type="file"
      />
      <input
        name="clear_eye_catch_image"
        type="hidden"
        value={clearEyeCatchImage ? "1" : "0"}
      />
      <FieldDescription>
        バリアント画像をクリックして差し替えできます。削除を選ぶと画像は未設定になります。
        JPEG/PNG/WebP、10MB以下、2400x3200px以上の画像を選択してください。
      </FieldDescription>
    </FieldContent>
  </Field>
);
