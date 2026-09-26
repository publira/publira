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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { UntilActionSucceeds } from "#components/until-action-succeeds";
import { EPISODE_COMMENT_REPORT_REASONS } from "#lib/comments";
import type { EpisodeCommentReportReason } from "#lib/comments";
import { getMessages } from "#lib/get-messages";

import { reportEpisodeCommentAction } from "../_lib/comment-actions";

// Keyed by the stored reason, so a reason added to the list is a type error
// here rather than an option with no wording.
const reasonLabels: Record<EpisodeCommentReportReason, ReactNode> = {
  abuse: (
    <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
      <Message message="host.episode.comments.report_reason_abuse" />
    </Suspense>
  ),
  other: (
    <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
      <Message message="host.episode.comments.report_reason_other" />
    </Suspense>
  ),
  spam: (
    <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
      <Message message="host.episode.comments.report_reason_spam" />
    </Suspense>
  ),
  spoiler: (
    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
      <Message message="host.episode.comments.report_reason_spoiler" />
    </Suspense>
  ),
};

/**
 * The note box, whole: the placeholder is an attribute and waits on the
 * catalog, and Base UI registers the label's id from the field's own Effects,
 * so a control hydrating after its label would not match the server's HTML.
 */
const CommentReportNoteField = async ({ form }: { form: string }) => {
  const t = await getMessages();

  return (
    <Field>
      <FieldLabel>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <Message message="host.episode.comments.report_note_label" />
        </Suspense>
      </FieldLabel>
      <FieldContent>
        <Textarea
          form={form}
          name="note"
          placeholder={t("host.episode.comments.report_note_placeholder")}
          rows={3}
        />
      </FieldContent>
    </Field>
  );
};

const CommentReportNoteFieldSkeleton = () => (
  <div aria-hidden="true" className="grid gap-2">
    <SkeletonLine className="h-4 w-28" />
    <Skeleton className="h-20 w-full" />
  </div>
);

/**
 * Flags one other reader's comment as breaking the rules.
 *
 * The dialog is what makes this deliberate: reporting is an accusation about
 * someone else's writing, and a single-click control next to every comment
 * invites the misclick that a reason chooser and a sentence of confirmation
 * copy do not.
 *
 * Nothing here reports what became of the report, or whether this reader had
 * already sent one. The API answers a repeat exactly as it answers a first
 * report, and the control says the same thing back either way: a reader who
 * could tell the two apart could learn what the platform has done about a
 * comment the removal was meant to be silent about.
 *
 * The fields in the popup join the form through `form=`: the popup portals out
 * of it, while the trigger stays inside, so its wording follows the
 * submission. A refused report leaves the dialog open for the reader to
 * correct; a sent one takes the dialog and its trigger away.
 */
export const CommentReportButton = ({
  "aria-label": ariaLabel,
  commentPublicId,
  returnTo,
  tenantId,
}: {
  /** Names the comment the trigger reports: who wrote it, and when. */
  "aria-label": string;
  commentPublicId: string;
  returnTo: string;
  tenantId: string;
}) => {
  const formId = `comment-report-${commentPublicId}`;

  return (
    <ActionForm
      action={reportEpisodeCommentAction}
      className="grid justify-items-end gap-2"
      id={formId}
    >
      <LocaleField />
      <input name="commentPublicId" type="hidden" value={commentPublicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="tenantId" type="hidden" value={tenantId} />
      <UntilActionSucceeds>
        <Dialog>
          <DialogTrigger
            render={
              <Button
                aria-label={ariaLabel}
                size="sm"
                type="button"
                variant="ghost"
              />
            }
          >
            <ActionFormIdle>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="host.episode.comments.report" />
              </Suspense>
            </ActionFormIdle>
            <ActionFormPending>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="host.episode.comments.reporting" />
              </Suspense>
            </ActionFormPending>
          </DialogTrigger>
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport>
              <DialogPopup className="grid gap-4">
                <DialogHeader>
                  <DialogTitle className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
                      <Message message="host.episode.comments.report_title" />
                    </Suspense>
                  </DialogTitle>
                  <DialogDescription className="text-sm text-muted-foreground">
                    <Suspense
                      fallback={<SkeletonLine className="h-4 w-full" />}
                    >
                      <Message message="host.episode.comments.report_description" />
                    </Suspense>
                  </DialogDescription>
                </DialogHeader>

                <Field>
                  <FieldLabel required>
                    <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                      <Message message="host.episode.comments.report_reason_label" />
                    </Suspense>
                  </FieldLabel>
                  <FieldContent>
                    <RadioGroup
                      defaultValue={EPISODE_COMMENT_REPORT_REASONS[0]}
                      form={formId}
                      items={EPISODE_COMMENT_REPORT_REASONS.map((value) => ({
                        label: reasonLabels[value],
                        value,
                      }))}
                      name="reason"
                    />
                  </FieldContent>
                </Field>

                <Suspense fallback={<CommentReportNoteFieldSkeleton />}>
                  <CommentReportNoteField form={formId} />
                </Suspense>

                <DialogFooter>
                  <DialogClose
                    render={<Button type="button" variant="outline" />}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                      <Message message="host.common.cancel" />
                    </Suspense>
                  </DialogClose>
                  <ActionFormSubmit form={formId}>
                    <ActionFormIdle>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-20" />}
                      >
                        <Message message="host.episode.comments.report_confirm" />
                      </Suspense>
                    </ActionFormIdle>
                    <ActionFormPending>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="host.episode.comments.reporting" />
                      </Suspense>
                    </ActionFormPending>
                  </ActionFormSubmit>
                </DialogFooter>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </Dialog>
      </UntilActionSucceeds>
    </ActionForm>
  );
};
