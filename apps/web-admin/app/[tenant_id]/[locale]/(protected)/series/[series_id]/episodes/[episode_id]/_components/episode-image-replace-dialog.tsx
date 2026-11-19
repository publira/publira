"use client";

import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as Dialog from "@publira/ui-components/dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import * as Toast from "@publira/ui-components/toast";
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
  const { add } = Toast.useManager();
  ActionForm.useSettled((state) => {
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
    <ActionForm.Root
      action={replace}
      className="grid gap-4"
      showSuccess={false}
    >
      <input name="episode_id" type="hidden" value={episodeId} />
      <input name="image_id" type="hidden" value={imageId} />
      <ReplaceSettled onSucceeded={onSucceeded} />

      <ActionForm.Fieldset>
        <Field.Root>
          <Field.Label required>
            {t("admin.series.episodes.image_replace.file")}
          </Field.Label>
          <Field.Content>
            <Input
              accept={EPISODE_PAGE_IMAGE_ACCEPT}
              name="image"
              required
              type="file"
            />
            <Field.Description>
              {t("admin.series.episodes.image_replace.file_description")}
            </Field.Description>
          </Field.Content>
        </Field.Root>
      </ActionForm.Fieldset>

      <div className="flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            {t("admin.series.episodes.image_replace.submit")}
          </ActionForm.Idle>
          <ActionForm.Pending>
            {t("admin.series.episodes.image_replace.pending")}
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
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
    <Dialog.Root
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
      <Dialog.Trigger
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
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup>
            <Dialog.Header>
              <Dialog.Title className="text-lg font-semibold">
                {t("admin.series.episodes.image_replace.title", {
                  position: String(position),
                })}
              </Dialog.Title>
              <Dialog.Description className="text-sm text-muted-foreground">
                {t("admin.series.episodes.image_replace.description")}
              </Dialog.Description>
            </Dialog.Header>
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
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
