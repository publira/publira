"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import { Card, CardContent } from "@publira/ui-components/card";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import type { ChangeEventHandler, ReactEventHandler } from "react";
import { useActionState, useContext, useEffect, useRef, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { CropRect } from "#lib/crop-rect";
import { CROP_RECT_FIELD, formatCropRect } from "#lib/crop-rect";
import { useTenantId } from "#lib/use-tenant-id";

import type { EyeCatchAspect } from "./aspects";
import { EYE_CATCH_ASPECTS, eyeCatchAspectClassName } from "./aspects";
import type { CropSource } from "./crop";
import { centreCropRect } from "./crop";
import { EyeCatchCropDialog } from "./crop-dialog";
import type { EyeCatchAspectActionState, EyeCatchVariantItem } from "./types";

type EyeCatchAspectAction = (
  prevState: EyeCatchAspectActionState,
  formData: FormData
) => Promise<EyeCatchAspectActionState>;

interface EyeCatchAspectImagesProps {
  /** The series or label the ratios belong to. */
  publicId: string;
  /** The images the eye-catch currently holds, across every ratio. */
  variants: EyeCatchVariantItem[];
  uploadAction: EyeCatchAspectAction;
}

interface EyeCatchAspectSlotProps extends EyeCatchAspectImagesProps {
  aspect: EyeCatchAspect;
}

const largestVariant = (
  variants: EyeCatchVariantItem[],
  variantType: string
): EyeCatchVariantItem | undefined =>
  variants
    .filter((variant) => variant.variantType === variantType)
    .toSorted((a, b) => a.width - b.width)
    .at(-1);

/**
 * The picked file scaled and shifted so the slot shows the framed region and
 * nothing else. The frame carries the slot's own ratio, so the two scales agree
 * and the region fills the box exactly.
 */
const framedPreviewStyle = (crop: CropRect, source: CropSource) => ({
  height: `${(source.height / crop.height) * 100}%`,
  left: `${(-crop.x / crop.width) * 100}%`,
  top: `${(-crop.y / crop.height) * 100}%`,
  width: `${(source.width / crop.width) * 100}%`,
});

const EyeCatchAspectSlot = ({
  aspect,
  publicId,
  uploadAction,
  variants,
}: EyeCatchAspectSlotProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const { minHeight, minWidth, variantType } = aspect;

  const [state, formAction, isUploading] = useActionState(uploadAction, null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  /** The picked file's own size, and the part of it the editor framed. */
  const [source, setSource] = useState<CropSource | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [isFraming, setIsFraming] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const handlePickImage = () => {
    fileInputRef.current?.click();
  };

  // The preview stands in for the file only while it is being chosen. Once the
  // form is submitted the stored crop is the truth, and a preview left set
  // would outrank it below — the Action re-renders this screen without
  // remounting the slot, so it would go on showing the file the editor picked.
  const handleSubmit = () => {
    setLocalPreviewUrl("");
    setSource(null);
    setCrop(null);
    setIsFraming(false);
  };

  const handleImageFileChange: ChangeEventHandler<HTMLInputElement> = (
    event
  ) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }
    setLocalPreviewUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return URL.createObjectURL(file);
    });
    // Both belong to the file that was just replaced. The new one reports its
    // own size when it is decoded, and the frame is derived from that.
    setSource(null);
    setCrop(null);
    setIsFraming(true);
  };

  /**
   * The frame starts where the API would have cut on its own, so an editor who
   * touches nothing gets the image this slot has always produced. A file whose
   * frame is already set keeps it: the dialog remounts its image every time it
   * is opened, and this runs again each time.
   */
  const handleCropImageLoad: ReactEventHandler<HTMLImageElement> = (event) => {
    const size = {
      height: event.currentTarget.naturalHeight,
      width: event.currentTarget.naturalWidth,
    };
    setSource(size);
    setCrop((current) => current ?? centreCropRect(size, aspect));
  };

  const current = largestVariant(variants, variantType);
  const previewUrl = localPreviewUrl || current?.url || "";
  /**
   * While a file is picked the slot shows the region the frame keeps, so what
   * it stands in for is what the upload will deliver rather than the file.
   */
  const framedStyle =
    localPreviewUrl && crop && source
      ? framedPreviewStyle(crop, source)
      : undefined;

  return (
    <div className="grid gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{variantType}</p>
        {current ? (
          <p className="text-xs text-muted-foreground">
            {current.width}&times;{current.height}
          </p>
        ) : null}
      </div>

      <button
        aria-label={getMessage(messages, "admin.eye_catch.aspect.select_aria", {
          variant_type: variantType,
        })}
        className={cn(
          "relative overflow-hidden rounded-md border border-border/50 bg-muted/40 transition-colors hover:border-blue-300",
          eyeCatchAspectClassName(variantType)
        )}
        onClick={handlePickImage}
        type="button"
      >
        {previewUrl ? (
          // Each ratio is its own URL, and the picked file is a blob; next/image
          // cannot carry both behind one src.
          // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element
          <img
            alt={getMessage(messages, "admin.eye_catch.variant_alt", {
              variant_type: variantType,
            })}
            className={
              framedStyle ? "absolute max-w-none" : "h-full w-full object-cover"
            }
            src={previewUrl}
            style={framedStyle}
          />
        ) : (
          <span className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.empty")}
          </span>
        )}
      </button>

      <p className="text-xs text-muted-foreground">
        {getMessage(messages, "admin.eye_catch.aspect.minimum", {
          height: String(minHeight),
          width: String(minWidth),
        })}
      </p>

      <form action={formAction} className="grid gap-2" onSubmit={handleSubmit}>
        <input name="tenant_id" type="hidden" value={tenantId} />
        <input name="public_id" type="hidden" value={publicId} />
        <input name="variant_type" type="hidden" value={variantType} />
        {crop ? (
          <input
            name={CROP_RECT_FIELD}
            type="hidden"
            value={formatCropRect(crop)}
          />
        ) : null}
        <Input
          accept="image/jpeg,image/png,image/webp"
          name="aspect_image"
          onChange={handleImageFileChange}
          ref={fileInputRef}
          style={{ display: "none" }}
          type="file"
        />
        {localPreviewUrl ? (
          <Button
            onClick={() => setIsFraming(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            {getMessage(messages, "admin.eye_catch.aspect.crop.adjust")}
          </Button>
        ) : null}
        <Button
          disabled={isUploading || localPreviewUrl.length === 0}
          size="sm"
          type="submit"
        >
          {getMessage(
            messages,
            isUploading
              ? "admin.eye_catch.aspect.uploading"
              : "admin.eye_catch.aspect.upload"
          )}
        </Button>
      </form>

      {state && state.variantType === variantType ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {"imageInvalid" in state
            ? getMessage(messages, "admin.eye_catch.aspect.image_invalid", {
                height: String(minHeight),
                width: String(minWidth),
              })
            : state.message}
        </FormMessage>
      ) : null}

      {localPreviewUrl ? (
        <EyeCatchCropDialog
          aspect={aspect}
          crop={crop}
          imageUrl={localPreviewUrl}
          onCropChange={setCrop}
          onImageLoad={handleCropImageLoad}
          onOpenChange={setIsFraming}
          open={isFraming}
          source={source}
        />
      ) : null}
    </div>
  );
};

/**
 * The per-ratio images of an eye-catch.
 *
 * Each ratio holds its own image and they are independent: replacing one here
 * leaves the other three exactly as they were. Uploading a whole eye-catch
 * above fills all four at once.
 */
export const EyeCatchAspectImages = ({
  publicId,
  uploadAction,
  variants,
}: EyeCatchAspectImagesProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="grid gap-1">
          <h2 className="text-sm font-medium">
            {getMessage(messages, "admin.eye_catch.aspect.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.description")}
          </p>
        </div>
        {variants.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {getMessage(messages, "admin.eye_catch.aspect.eye_catch_required")}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {EYE_CATCH_ASPECTS.map((aspect) => (
              <EyeCatchAspectSlot
                aspect={aspect}
                key={aspect.variantType}
                publicId={publicId}
                uploadAction={uploadAction}
                variants={variants}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
