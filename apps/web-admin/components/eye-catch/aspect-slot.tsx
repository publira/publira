"use client";

import {
  ActionFormSubmit,
  useActionFormSettled,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import { cn } from "@publira/utils";
import type {
  ChangeEventHandler,
  ReactEventHandler,
  ReactNode,
  RefObject,
} from "react";
import {
  createContext,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useClientMessages } from "#components/client-message";
import type { CropSource } from "#components/image-crop/crop";
import {
  centreCropRect,
  framedPreviewStyle,
} from "#components/image-crop/crop";
import { ImageCropDialog } from "#components/image-crop/crop-dialog";
import type { CropRect } from "#lib/crop-rect";
import { CROP_RECT_FIELD, formatCropRect } from "#lib/crop-rect";

import type { EyeCatchAspect } from "./aspects";
import { eyeCatchAspectClassName } from "./aspects";

interface EyeCatchAspectSlotContextValue {
  aspect: EyeCatchAspect;
  crop: CropRect | null;
  currentUrl: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isFraming: boolean;
  localPreviewUrl: string;
  onCropChange: (crop: CropRect) => void;
  onCropImageLoad: ReactEventHandler<HTMLImageElement>;
  onFramingChange: (isFraming: boolean) => void;
  onImageFileChange: ChangeEventHandler<HTMLInputElement>;
  source: CropSource | null;
}

const EyeCatchAspectSlotContext =
  createContext<EyeCatchAspectSlotContextValue | null>(null);

const useEyeCatchAspectSlot = () => {
  const context = use(EyeCatchAspectSlotContext);
  if (!context) {
    throw new Error(
      "EyeCatchAspectSlot slots must be rendered inside EyeCatchAspectSlot."
    );
  }
  return context;
};

/**
 * The file picked for one ratio and the part of it the editor framed. The
 * form around it is composed on the server.
 */
export const EyeCatchAspectSlot = ({
  aspect,
  children,
  currentUrl,
}: {
  aspect: EyeCatchAspect;
  children: ReactNode;
  /** The image the ratio holds now, empty while it has none. */
  currentUrl: string;
}) => {
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

  // Once the upload is stored the ratio's own image is the truth, and a
  // preview left set would outrank it: the page redraws the slot with that
  // image without remounting it. A refused upload keeps the file to retry.
  useActionFormSettled((state) => {
    if (state?.ok) {
      setLocalPreviewUrl("");
      setSource(null);
      setCrop(null);
      setIsFraming(false);
    }
  });

  const context = useMemo<EyeCatchAspectSlotContextValue>(
    () => ({
      aspect,
      crop,
      currentUrl,
      fileInputRef,
      isFraming,
      localPreviewUrl,
      onCropChange: setCrop,
      /**
       * The frame starts where the API would have cut on its own, so an editor
       * who touches nothing gets the image this slot has always produced. A
       * file whose frame is already set keeps it: the dialog remounts its
       * image every time it is opened, and this runs again each time.
       */
      onCropImageLoad: (event) => {
        const size = {
          height: event.currentTarget.naturalHeight,
          width: event.currentTarget.naturalWidth,
        };
        setSource(size);
        setCrop((current) => current ?? centreCropRect(size, aspect));
      },
      onFramingChange: setIsFraming,
      onImageFileChange: (event) => {
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
        // Both belong to the file that was just replaced. The new one reports
        // its own size when it is decoded, and the frame is derived from that.
        setSource(null);
        setCrop(null);
        setIsFraming(true);
      },
      source,
    }),
    [aspect, crop, currentUrl, isFraming, localPreviewUrl, source]
  );

  return (
    <EyeCatchAspectSlotContext value={context}>
      {children}
      {crop ? (
        <input
          name={CROP_RECT_FIELD}
          type="hidden"
          value={formatCropRect(crop)}
        />
      ) : null}
    </EyeCatchAspectSlotContext>
  );
};

/**
 * The ratio's image, which picks a file for it when pressed; `children` stand
 * in for the image while the ratio has none.
 */
export const EyeCatchAspectPicker = ({ children }: { children: ReactNode }) => {
  const t = useClientMessages();
  const { aspect, crop, currentUrl, fileInputRef, localPreviewUrl, source } =
    useEyeCatchAspectSlot();
  const { variantType } = aspect;
  const previewUrl = localPreviewUrl || currentUrl;
  /**
   * While a file is picked the slot shows the region the frame keeps, so what
   * it stands in for is what the upload will deliver rather than the file.
   */
  const framedStyle =
    localPreviewUrl && crop && source
      ? framedPreviewStyle(crop, source)
      : undefined;

  return (
    <button
      aria-label={t("admin.eye_catch.aspect.select_aria", {
        variant_type: variantType,
      })}
      className={cn(
        "relative overflow-hidden rounded-surface border border-border bg-muted/40 transition-colors duration-state ease-state hover:border-primary disabled:pointer-events-none disabled:opacity-50",
        eyeCatchAspectClassName(variantType)
      )}
      onClick={() => fileInputRef.current?.click()}
      type="button"
    >
      {previewUrl ? (
        // Each ratio is its own URL, and the picked file is a blob; next/image
        // cannot carry both behind one src.
        // oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element
        <img
          alt={t("admin.eye_catch.variant_alt", {
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
          {children}
        </span>
      )}
    </button>
  );
};

/** The file picked for the ratio, posted as `aspect_image`. */
export const EyeCatchAspectFileInput = () => {
  const { fileInputRef, onImageFileChange } = useEyeCatchAspectSlot();

  return (
    <Input
      accept="image/jpeg,image/png,image/webp"
      name="aspect_image"
      onChange={onImageFileChange}
      ref={fileInputRef}
      style={{ display: "none" }}
      type="file"
    />
  );
};

/** Opens the frame again once a file is picked; `children` are its wording. */
export const EyeCatchAspectAdjust = ({ children }: { children: ReactNode }) => {
  const { localPreviewUrl, onFramingChange } = useEyeCatchAspectSlot();

  return localPreviewUrl ? (
    <Button
      onClick={() => onFramingChange(true)}
      size="sm"
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  ) : null;
};

/** Uploads the picked file, closed until one is picked; `children` are its wording. */
export const EyeCatchAspectUpload = ({ children }: { children: ReactNode }) => {
  const { localPreviewUrl } = useEyeCatchAspectSlot();

  return (
    <ActionFormSubmit disabled={localPreviewUrl.length === 0} size="sm">
      {children}
    </ActionFormSubmit>
  );
};

/** The frame of the picked file; `children` is the dialog's `ImageCropDialogTitle`. */
export const EyeCatchAspectCropDialog = ({
  children,
}: {
  children: ReactNode;
}) => {
  const {
    aspect,
    crop,
    isFraming,
    localPreviewUrl,
    onCropChange,
    onCropImageLoad,
    onFramingChange,
    source,
  } = useEyeCatchAspectSlot();

  return localPreviewUrl ? (
    <ImageCropDialog
      aspect={aspect}
      crop={crop}
      imageUrl={localPreviewUrl}
      onCropChange={onCropChange}
      onImageLoad={onCropImageLoad}
      onOpenChange={onFramingChange}
      open={isFraming}
      source={source}
    >
      {children}
    </ImageCropDialog>
  ) : null;
};
