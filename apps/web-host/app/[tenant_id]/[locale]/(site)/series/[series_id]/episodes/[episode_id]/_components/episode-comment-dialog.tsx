import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import {
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import { postEpisodeCommentAction } from "../_lib/comment-actions";
import { EpisodeCommentDialogPortal } from "./episode-comment-dialog-portal";

/**
 * The box to write in, whole: the placeholder is an attribute and waits on the
 * catalog, and Base UI registers the label's id from the field's own Effects,
 * so a control hydrating after its label would not match the server's HTML.
 */
const EpisodeCommentBodyField = async () => {
  const t = await getMessages();

  return (
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.episode.comments.body_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        {/* No `maxLength`: it counts UTF-16 code units, while the API counts
            Unicode code points, so it would cut an emoji-heavy comment off at
            half the length the server allows. The Action checks the real limit
            and says so under the box. */}
        <Textarea
          name="body"
          placeholder={t("host.episode.comments.body_placeholder")}
          rows={3}
        />
      </FieldContent>
    </Field>
  );
};

const EpisodeCommentBodyFieldSkeleton = () => (
  <div aria-hidden="true" className="grid gap-2">
    <SkeletonLine className="h-4 w-24" />
    <Skeleton className="h-20 w-full" />
  </div>
);

/**
 * The episode's comments, opened from the page the reader turns to after the
 * last page of the episode.
 *
 * A dialog rather than a section laid out on that page: the page is one screen
 * of the reader and no taller, and the list is as long as the episode is
 * talked about. The box to write in is fixed above the list rather than under
 * it, so it is in the same place however far the reader has scrolled; a posted
 * comment empties it, and a refused one stays for the reader to correct.
 *
 * `children` are the comments themselves, rendered on the server: the list, the
 * pager, and whatever a failed read has to say.
 */
export const EpisodeCommentDialog = ({
  children,
  episodePublicId,
  /**
   * Whether the URL asks for the comments — a page of them followed from the
   * pager, which navigates rather than fetching.
   */
  initialOpen = false,
  prompt,
  returnTo,
  tenantId,
}: {
  children: ReactNode;
  episodePublicId: string;
  initialOpen?: boolean;
  /** Shown in place of the box where the reader has no session. */
  prompt?: ReactNode;
  /** Where a rejected session sends the reader back to. */
  returnTo: string;
  tenantId: string;
}) => (
  <Dialog defaultOpen={initialOpen}>
    <DialogTrigger render={<Button type="button" variant="outline" />}>
      <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
        <Message message="host.episode.comments.title" />
      </Suspense>
    </DialogTrigger>
    <EpisodeCommentDialogPortal>
      <DialogBackdrop />
      <DialogViewport>
        <DialogPopup className="flex max-h-[min(85svh,48rem)] flex-col gap-4 text-left">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-28" />}>
                <Message message="host.episode.comments.title" />
              </Suspense>
            </DialogTitle>
          </DialogHeader>

          {prompt ?? (
            <ActionForm
              action={postEpisodeCommentAction}
              className="grid gap-3"
            >
              <LocaleField />
              <input
                name="episodePublicId"
                type="hidden"
                value={episodePublicId}
              />
              <input name="returnTo" type="hidden" value={returnTo} />
              <input name="tenantId" type="hidden" value={tenantId} />
              <Suspense fallback={<EpisodeCommentBodyFieldSkeleton />}>
                <EpisodeCommentBodyField />
              </Suspense>
              <ActionFormSubmit className="justify-self-start">
                <ActionFormIdle>
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="host.episode.comments.submit" />
                  </Suspense>
                </ActionFormIdle>
                <ActionFormPending>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message message="host.episode.comments.posting" />
                  </Suspense>
                </ActionFormPending>
              </ActionFormSubmit>
            </ActionForm>
          )}

          {/* The one part that grows with the episode, so it is the one part
              that scrolls. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border pt-4">
            {children}
          </div>

          <DialogClose
            className="justify-self-end"
            render={<Button type="button" variant="outline" />}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
              <Message message="host.common.close" />
            </Suspense>
          </DialogClose>
        </DialogPopup>
      </DialogViewport>
    </EpisodeCommentDialogPortal>
  </Dialog>
);
