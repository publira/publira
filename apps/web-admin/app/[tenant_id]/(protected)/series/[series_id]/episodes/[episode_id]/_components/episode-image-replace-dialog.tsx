"use client";

import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
  useActionFormSettled,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { useToastManager } from "@publira/ui-components/toast";
import { useState } from "react";

import { useClientMessages } from "#components/client-message";
import {
  EPISODE_PAGE_IMAGE_ACCEPT,
  EPISODE_PAGE_IMAGE_MAX_BYTES,
  EPISODE_PAGE_REPLACE_PATH,
} from "#lib/episode-pages-upload";

import { usePageUploadAction } from "./use-page-upload-action";

interface EpisodeImageReplaceDialogProps {
  episodeId: string;
  imageId: string;
  /** The page's 1-based place in the episode, as the grid shows it. */
  position: number;
}

/** Raises the success as a toast and closes the dialog it sits in. */
const ReplaceSettled = ({ onSucceeded }: { onSucceeded: () => void }) => {
  const { add } = useToastManager();
  useActionFormSettled((state) => {
    if (state?.ok) {
      add({ title: state.message, type: "success" });
      onSucceeded();
    }
  });

  return null;
};

const EpisodeImageReplaceForm = ({
  episodeId,
  imageId,
  onSucceeded,
}: Omit<EpisodeImageReplaceDialogProps, "position"> & {
  onSucceeded: () => void;
}) => {
  const t = useClientMessages();
  const replace = usePageUploadAction({
    failed: t("admin.series.episodes.image_replace.failed"),
    interrupted: t("admin.series.episodes.image_replace.interrupted"),
    maxBytes: EPISODE_PAGE_IMAGE_MAX_BYTES,
    path: EPISODE_PAGE_REPLACE_PATH,
    tooLarge: t("admin.series.episodes.image_replace.too_large"),
  });

  return (
    <ActionForm action={replace} className="grid gap-4" showSuccess={false}>
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="image_id" type="hidden" value={imageId} />
      <ReplaceSettled onSucceeded={onSucceeded} />

      <ActionFormFieldset>
        <Field>
          <FieldLabel required>
            {t("admin.series.episodes.image_replace.file")}
          </FieldLabel>
          <FieldContent>
            <Input
              accept={EPISODE_PAGE_IMAGE_ACCEPT}
              name="image"
              required
              type="file"
            />
            <FieldDescription>
              {t("admin.series.episodes.image_replace.file_description")}
            </FieldDescription>
          </FieldContent>
        </Field>
      </ActionFormFieldset>

      <div className="flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            {t("admin.series.episodes.image_replace.submit")}
          </ActionFormIdle>
          <ActionFormPending>
            {t("admin.series.episodes.image_replace.pending")}
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};

/**
 * Puts a new image in the place of one page. The image goes to the upload
 * route rather than to a Server Action, whose body is capped below one page
 * (`lib/episode-pages-upload.ts`), and the screen is read again once it is in.
 */
export const EpisodeImageReplaceDialog = ({
  episodeId,
  imageId,
  position,
}: EpisodeImageReplaceDialogProps) => {
  const t = useClientMessages();
  const [open, setOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          // A file or a message from the last time does not survive into
          // the next.
          setSessionKey((current) => current + 1);
        }
      }}
      open={open}
    >
      <DialogTrigger
        render={
          <Button
            aria-label={t("admin.series.episodes.image_replace.label", {
              position: String(position),
            })}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("admin.series.episodes.image_replace.action")}
          </Button>
        }
      />
      <DialogPortal>
        <DialogBackdrop />
        <DialogViewport>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold">
                {t("admin.series.episodes.image_replace.title", {
                  position: String(position),
                })}
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {t("admin.series.episodes.image_replace.description")}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <EpisodeImageReplaceForm
                episodeId={episodeId}
                imageId={imageId}
                key={sessionKey}
                onSucceeded={() => {
                  setOpen(false);
                }}
              />
            </div>
          </DialogPopup>
        </DialogViewport>
      </DialogPortal>
    </Dialog>
  );
};
