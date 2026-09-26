"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEventHandler } from "react";
import { useFormStatus } from "react-dom";

import { EyeCatchImageField } from "./image-field";
import type { EyeCatchVariantItem } from "./types";

interface EyeCatchFormFieldProps {
  /** When the saved eye-catch last changed, which the Action compares against. */
  eyeCatchImageUpdatedAt: string;
  fileInputId: string;
  variants: EyeCatchVariantItem[];
}

/**
 * The stateful part of a form that replaces or removes a whole eye-catch: the
 * picked file's preview, the delete toggle, and the ratio that was clicked.
 * The form around it is composed on the server, and every control here closes
 * while its save is in flight, since the Action carries what they held.
 */
export const EyeCatchFormField = ({
  eyeCatchImageUpdatedAt,
  fileInputId,
  variants,
}: EyeCatchFormFieldProps) => {
  const { pending } = useFormStatus();
  const [clearEyeCatchImage, setClearEyeCatchImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  const [selectedVariantType, setSelectedVariantType] = useState<string | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const handleVariantImageClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImageFileChange = useCallback<
    ChangeEventHandler<HTMLInputElement>
  >((event) => {
    const file = event.currentTarget.files?.[0];
    if (file) {
      setLocalPreviewUrl((current) => {
        if (current) {
          URL.revokeObjectURL(current);
        }
        return URL.createObjectURL(file);
      });
      setClearEyeCatchImage(false);
    }
  }, []);

  const handleDeleteToggle = useCallback(() => {
    setClearEyeCatchImage((current) => !current);
  }, []);

  return (
    <>
      <input
        name="current_eye_catch_image_updated_at"
        type="hidden"
        value={eyeCatchImageUpdatedAt}
      />
      <EyeCatchImageField
        clearEyeCatchImage={clearEyeCatchImage}
        disabled={pending}
        fileInputId={fileInputId}
        fileInputRef={fileInputRef}
        hasVariants={variants.length > 0}
        localPreviewUrl={localPreviewUrl}
        onDeleteToggle={handleDeleteToggle}
        onImageFileChange={handleImageFileChange}
        onVariantImageClick={handleVariantImageClick}
        onVariantTypeChange={setSelectedVariantType}
        selectedVariantType={selectedVariantType}
        variants={variants}
      />
    </>
  );
};
