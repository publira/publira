"use client";

import { Button } from "@publira/ui-components/button";
import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import type { ChangeEventHandler, ReactEventHandler, ReactNode } from "react";
import { createContext, use, useEffect, useMemo, useState } from "react";

import { useClientMessages } from "#components/client-message";
import type { CropAspect, CropSource } from "#components/image-crop/crop";
import {
  centreCropRect,
  framedPreviewStyle,
} from "#components/image-crop/crop";
import { ImageCropDialog } from "#components/image-crop/crop-dialog";
import type { CropRect } from "#lib/crop-rect";
import { CROP_RECT_FIELD, formatCropRect } from "#lib/crop-rect";

/**
 * An author icon is one square, cut out of whatever was uploaded for it. The
 * minimum is the API's own (`creatorIconMinDimension`), so a frame this control
 * allows is a frame the upload will be accepted with.
 */
const ICON_ASPECT: CropAspect = {
  aspectHeight: 1,
  aspectWidth: 1,
  minWidth: 256,
};

interface CreatorIconContextValue {
  clearIconImage: boolean;
  crop: CropRect | null;
  iconImageUrl: string;
  isFraming: boolean;
  localPreviewUrl: string;
  onClearIconImageChange: ChangeEventHandler<HTMLInputElement>;
  onCropChange: (crop: CropRect) => void;
  onCropImageLoad: ReactEventHandler<HTMLImageElement>;
  onFramingChange: (isFraming: boolean) => void;
  onImageFileChange: ChangeEventHandler<HTMLInputElement>;
  source: CropSource | null;
}

const CreatorIconContext = createContext<CreatorIconContextValue | null>(null);

const useCreatorIcon = () => {
  const context = use(CreatorIconContext);
  if (!context) {
    throw new Error("CreatorIcon slots must be rendered inside CreatorIcon.");
  }
  return context;
};

/**
 * The icon being picked, framed, or removed. Seeded once per mount: the form
 * keys it by when the saved icon last changed, so a save that replaced or
 * removed the icon starts it afresh.
 */
export const CreatorIcon = ({
  children,
  iconImageUrl,
}: {
  children: ReactNode;
  /** The saved icon, empty while the author has none. */
  iconImageUrl: string;
}) => {
  const [clearIconImage, setClearIconImage] = useState(false);
  const [localPreviewUrl, setLocalPreviewUrl] = useState("");
  /** The picked file's own size, and the part of it the editor framed. */
  const [source, setSource] = useState<CropSource | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const [isFraming, setIsFraming] = useState(false);

  useEffect(
    () => () => {
      if (localPreviewUrl) {
        URL.revokeObjectURL(localPreviewUrl);
      }
    },
    [localPreviewUrl]
  );

  const context = useMemo<CreatorIconContextValue>(
    () => ({
      clearIconImage,
      crop,
      iconImageUrl,
      isFraming,
      localPreviewUrl,
      onClearIconImageChange: (event) => {
        setClearIconImage(event.target.checked);
      },
      onCropChange: setCrop,
      /**
       * The frame starts where the API would have cut on its own, so an editor
       * who touches nothing gets the icon this form has always produced. A
       * file whose frame is already set keeps it: the dialog remounts its
       * image every time it is opened, and this runs again each time.
       */
      onCropImageLoad: (event) => {
        const size = {
          height: event.currentTarget.naturalHeight,
          width: event.currentTarget.naturalWidth,
        };
        setSource(size);
        setCrop((current) => current ?? centreCropRect(size, ICON_ASPECT));
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
    [clearIconImage, crop, iconImageUrl, isFraming, localPreviewUrl, source]
  );

  return (
    <CreatorIconContext value={context}>
      {children}
      {crop ? (
        <input
          name={CROP_RECT_FIELD}
          type="hidden"
          value={formatCropRect(crop)}
        />
      ) : null}
      <input
        name="clear_icon_image"
        type="hidden"
        value={clearIconImage ? "1" : "0"}
      />
    </CreatorIconContext>
  );
};

/** The picked file as it will be cut, or else the saved icon unless it is being removed. */
export const CreatorIconPreview = () => {
  const t = useClientMessages();
  const { clearIconImage, crop, iconImageUrl, localPreviewUrl, source } =
    useCreatorIcon();
  const framedStyle = crop && source ? framedPreviewStyle(crop, source) : null;

  if (localPreviewUrl) {
    return (
      <div className="relative size-20 overflow-hidden rounded-full border">
        {/* The picked file is a blob of unknown size, so next/image cannot
            carry it. */}
        {/* oxlint-disable-next-line next/no-img-element, react-doctor/nextjs-no-img-element */}
        <img
          alt={t("admin.creators.form.icon_preview_alt")}
          className={
            framedStyle ? "absolute max-w-none" : "h-full w-full object-cover"
          }
          src={localPreviewUrl}
          style={framedStyle ?? undefined}
        />
      </div>
    );
  }

  return iconImageUrl && !clearIconImage ? (
    <Image
      alt={t("admin.creators.form.current_icon_alt")}
      className="size-20 rounded-full border object-cover"
      height={80}
      src={iconImageUrl}
      width={80}
    />
  ) : null;
};

/** The file a new icon is cut from, posted as `icon_image`. */
export const CreatorIconFileInput = () => {
  const { onImageFileChange } = useCreatorIcon();

  return (
    <Input
      accept="image/jpeg,image/png,image/webp"
      name="icon_image"
      onChange={onImageFileChange}
      type="file"
    />
  );
};

/** Opens the frame again once a file is picked; `children` are its wording. */
export const CreatorIconAdjust = ({ children }: { children: ReactNode }) => {
  const { localPreviewUrl, onFramingChange } = useCreatorIcon();

  return localPreviewUrl ? (
    <Button
      className="mt-2 w-fit"
      onClick={() => onFramingChange(true)}
      size="sm"
      type="button"
      variant="outline"
    >
      {children}
    </Button>
  ) : null;
};

/** Removes the saved icon on the next save; `children` are its wording. */
export const CreatorIconClear = ({ children }: { children: ReactNode }) => {
  const { clearIconImage, onClearIconImageChange } = useCreatorIcon();

  return (
    <label className="mt-2 flex items-center gap-2 text-sm">
      <input
        checked={clearIconImage}
        onChange={onClearIconImageChange}
        type="checkbox"
      />
      {children}
    </label>
  );
};

/** The frame of the picked file; `children` is the dialog's `ImageCropDialogTitle`. */
export const CreatorIconCropDialog = ({
  children,
}: {
  children: ReactNode;
}) => {
  const {
    crop,
    isFraming,
    localPreviewUrl,
    onCropChange,
    onCropImageLoad,
    onFramingChange,
    source,
  } = useCreatorIcon();

  return localPreviewUrl ? (
    <ImageCropDialog
      aspect={ICON_ASPECT}
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
