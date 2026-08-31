"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import type { ChangeEventHandler, RefObject } from "react";
import { useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

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
}: EyeCatchImageFieldProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Field>
      <FieldLabel htmlFor={fileInputId}>
        {getMessage(messages, "admin.eye_catch.label")}
      </FieldLabel>
      <FieldContent>
        <div className="grid gap-2">
          {!hasVariants || clearEyeCatchImage ? (
            <button
              aria-label={getMessage(messages, "admin.eye_catch.select_aria")}
              className="relative aspect-[3/4] overflow-hidden rounded-md border-2 border-dashed border-border/60 bg-muted/40 transition-colors hover:border-blue-300"
              onClick={onVariantImageClick}
              type="button"
            >
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">
                  {getMessage(
                    messages,
                    clearEyeCatchImage
                      ? "admin.eye_catch.pending_delete"
                      : "admin.eye_catch.select_prompt"
                  )}
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
                {getMessage(
                  messages,
                  clearEyeCatchImage
                    ? "admin.eye_catch.undo_delete"
                    : "admin.eye_catch.delete_current"
                )}
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
          {getMessage(messages, "admin.eye_catch.description")}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
