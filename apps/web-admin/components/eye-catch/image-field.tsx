"use client";

import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import type { ChangeEventHandler, RefObject } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

import type { EyeCatchVariantItem } from "./types";
import { EyeCatchVariantSelector } from "./variant-selector";

interface EyeCatchImageFieldProps {
  /** Whether the field offers to delete the image (see `EyeCatchFormField`). */
  clearable: boolean;
  clearEyeCatchImage: boolean;
  /**
   * Closes every control, each of which changes the image or the delete flag
   * the form submits.
   */
  disabled?: boolean;
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
  clearable,
  clearEyeCatchImage,
  disabled = false,
  fileInputRef,
  hasVariants,
  localPreviewUrl,
  onDeleteToggle,
  onImageFileChange,
  onVariantImageClick,
  onVariantTypeChange,
  selectedVariantType,
  variants,
}: EyeCatchImageFieldProps) => {
  const t = useClientMessages();

  return (
    <Field.Root>
      <Field.Label>
        <ClientMessage message="admin.eye_catch.label" />
      </Field.Label>
      <Field.Content>
        <div className="grid gap-2">
          {!hasVariants || clearEyeCatchImage ? (
            <button
              aria-label={t("admin.eye_catch.select_aria")}
              className="relative aspect-[3/4] overflow-hidden rounded-surface border-2 border-dashed border-border bg-muted/40 transition-colors duration-state ease-state hover:border-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={disabled}
              onClick={onVariantImageClick}
              type="button"
            >
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {clearEyeCatchImage
                    ? t("admin.eye_catch.pending_delete")
                    : t("admin.eye_catch.select_prompt")}
                </p>
              </div>
            </button>
          ) : (
            <EyeCatchVariantSelector
              disabled={disabled}
              localPreviewUrl={localPreviewUrl}
              onImageClick={onVariantImageClick}
              onSelectVariantType={onVariantTypeChange}
              selectedVariantType={selectedVariantType}
              variants={variants}
            />
          )}

          {clearable && hasVariants ? (
            <div className="pt-1">
              <button
                className={cn(
                  "text-sm underline underline-offset-4 disabled:pointer-events-none disabled:opacity-50",
                  clearEyeCatchImage
                    ? "text-destructive"
                    : "text-muted-foreground hover:text-foreground"
                )}
                disabled={disabled}
                onClick={onDeleteToggle}
                type="button"
              >
                {clearEyeCatchImage
                  ? t("admin.eye_catch.undo_delete")
                  : t("admin.eye_catch.delete_current")}
              </button>
            </div>
          ) : null}
        </div>

        <Input
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled}
          name="eye_catch_image"
          onChange={onImageFileChange}
          ref={fileInputRef}
          style={{ display: "none" }}
          type="file"
        />
        {clearable ? (
          <input
            name="clear_eye_catch_image"
            type="hidden"
            value={clearEyeCatchImage ? "1" : "0"}
          />
        ) : null}
        <Field.Description>
          {clearable ? (
            <ClientMessage message="admin.eye_catch.description" />
          ) : (
            <ClientMessage message="admin.eye_catch.description_required" />
          )}
        </Field.Description>
      </Field.Content>
    </Field.Root>
  );
};
