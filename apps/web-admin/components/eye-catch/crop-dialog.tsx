"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import type { ReactEventHandler } from "react";
import { useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import type { CropRect } from "#lib/crop-rect";

import type { EyeCatchAspect } from "./aspects";
import type { CropSource } from "./crop";
import { EyeCatchCropFrame } from "./crop-frame";

interface EyeCatchCropDialogProps {
  aspect: EyeCatchAspect;
  crop: CropRect | null;
  /** The picked file, as the blob URL the slot created for it. */
  imageUrl: string;
  open: boolean;
  source: CropSource | null;
  onCropChange: (crop: CropRect) => void;
  onImageLoad: ReactEventHandler<HTMLImageElement>;
  onOpenChange: (open: boolean) => void;
}

/**
 * The frame at a size an editor can actually judge. A slot is one of four in a
 * grid and a few hundred pixels wide at most, which is enough to show what was
 * framed and far too little to frame anything in.
 *
 * It opens on its own as soon as a file is chosen, because framing is part of
 * choosing rather than a step to remember afterwards, and the slot's own
 * button opens it again for a second pass.
 */
export const EyeCatchCropDialog = ({
  aspect,
  crop,
  imageUrl,
  onCropChange,
  onImageLoad,
  onOpenChange,
  open,
  source,
}: EyeCatchCropDialogProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup className="w-[min(92vw,48rem)]">
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {getMessage(messages, "admin.eye_catch.aspect.crop.title", {
                  variant_type: aspect.variantType,
                })}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {getMessage(
                  messages,
                  "admin.eye_catch.aspect.crop.description"
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <EyeCatchCropFrame
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
                  <Button type="button">
                    {getMessage(messages, "admin.eye_catch.aspect.crop.done")}
                  </Button>
                }
              />
            </DialogFooter>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
