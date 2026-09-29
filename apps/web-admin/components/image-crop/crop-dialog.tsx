"use client";

import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogViewport,
} from "@publira/ui-components/dialog";
import type { ReactEventHandler, ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import type { CropRect } from "#lib/crop-rect";

import type { CropAspect, CropSource } from "./crop";
import { ImageCropFrame } from "./crop-frame";

interface ImageCropDialogProps {
  aspect: CropAspect;
  /** An `ImageCropDialogTitle` naming what is being framed. */
  children: ReactNode;
  crop: CropRect | null;
  /** The picked file, as the blob URL the form field created for it. */
  imageUrl: string;
  open: boolean;
  source: CropSource | null;
  onCropChange: (crop: CropRect) => void;
  onImageLoad: ReactEventHandler<HTMLImageElement>;
  onOpenChange: (open: boolean) => void;
}

/**
 * The frame at a size an editor can actually judge. The field a file is picked
 * in is a preview a few hundred pixels wide at most, which is enough to show
 * what was framed and far too little to frame anything in.
 *
 * It opens on its own as soon as a file is chosen, because framing is part of
 * choosing rather than a step to remember afterwards, and the field's own
 * button opens it again for a second pass.
 */
export const ImageCropDialog = ({
  aspect,
  children,
  crop,
  imageUrl,
  onCropChange,
  onImageLoad,
  onOpenChange,
  open,
  source,
}: ImageCropDialogProps) => {
  const t = useClientMessages();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="w-[min(92vw,48rem)]">
            <DialogHeader>
              {children}
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.image_crop.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <ImageCropFrame
                aspect={aspect}
                crop={crop}
                imageUrl={imageUrl}
                onCropChange={onCropChange}
                onImageLoad={onImageLoad}
                source={source}
              />
            </div>
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button">{t("admin.image_crop.done")}</Button>
                }
              />
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};

/**
 * What is being framed, in the words of the screen that opened the dialog. The
 * dialog covers that screen, so the image it is showing has to be named again.
 */
export const ImageCropDialogTitle = ({ children }: { children: ReactNode }) => (
  <DialogTitle className="text-lg font-semibold">{children}</DialogTitle>
);
