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
  DialogTrigger,
  DialogViewport,
} from "@publira/ui-components/dialog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { RadioGroup } from "@publira/ui-components/radio-group";
import { Textarea } from "@publira/ui-components/textarea";
import { useActionState, useState } from "react";

import type { FormActionState } from "#components/action-form";
import { LocaleField } from "#components/locale-field";
import {
  EPISODE_COMMENT_REPORT_REASONS,
  isEpisodeCommentReportReason,
} from "#lib/comment-report-reason";
import type { EpisodeCommentReportReason } from "#lib/comment-report-reason";

import { reportEpisodeCommentAction } from "../_lib/comment-actions";

/**
 * Resolved strings rather than nodes: every one of these lands in a button
 * label, an `aria-label`, a `placeholder`, or a radio option, none of which can
 * take a node.
 *
 * `reasons` is keyed by the stored reason so the chooser cannot offer an option
 * the Action would reject, and so a reason added to the list is a type error
 * here rather than an option with no wording.
 */
export interface CommentReportButtonCopy {
  cancel: string;
  confirm: string;
  description: string;
  noteLabel: string;
  notePlaceholder: string;
  pending: string;
  reasonLabel: string;
  reasons: Record<EpisodeCommentReportReason, string>;
  submit: string;
  title: string;
}

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
 */
export const CommentReportButton = ({
  ariaLabel,
  commentPublicId,
  copy,
  returnTo,
  tenantId,
}: {
  ariaLabel: string;
  commentPublicId: string;
  copy: CommentReportButtonCopy;
  returnTo: string;
  tenantId: string;
}) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<EpisodeCommentReportReason>(
    EPISODE_COMMENT_REPORT_REASONS[0]
  );
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: FormActionState,
      formData: FormData
    ): Promise<FormActionState> => {
      const nextState = await reportEpisodeCommentAction(
        previousState,
        formData
      );
      if (nextState?.ok) {
        // Closing only once the Action has answered keeps the form mounted for
        // the whole submission, and leaves a rejection on screen in the dialog
        // the reader can correct it in.
        setOpen(false);
      }
      return nextState;
    },
    null
  );
  const reported = state?.ok === true;

  return (
    <div className="grid justify-items-end gap-2">
      {reported ? null : (
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger
            render={
              <Button
                aria-label={ariaLabel}
                disabled={isPending}
                size="sm"
                type="button"
                variant="ghost"
              >
                {isPending ? copy.pending : copy.submit}
              </Button>
            }
          />
          <DialogPortal>
            <DialogBackdrop />
            <DialogViewport>
              <DialogPopup>
                <form action={formAction} className="grid gap-4">
                  <LocaleField />
                  <input
                    name="commentPublicId"
                    type="hidden"
                    value={commentPublicId}
                  />
                  <input name="reason" type="hidden" value={reason} />
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <input name="tenantId" type="hidden" value={tenantId} />

                  <DialogHeader>
                    <DialogTitle className="text-lg font-semibold">
                      {copy.title}
                    </DialogTitle>
                    <DialogDescription className="text-sm text-muted-foreground">
                      {copy.description}
                    </DialogDescription>
                  </DialogHeader>

                  <Field>
                    <FieldLabel required>{copy.reasonLabel}</FieldLabel>
                    <FieldContent>
                      <RadioGroup
                        items={EPISODE_COMMENT_REPORT_REASONS.map((value) => ({
                          label: copy.reasons[value],
                          value,
                        }))}
                        onValueChange={(value) => {
                          if (isEpisodeCommentReportReason(value)) {
                            setReason(value);
                          }
                        }}
                        value={reason}
                      />
                    </FieldContent>
                  </Field>

                  <Field>
                    <FieldLabel>{copy.noteLabel}</FieldLabel>
                    <FieldContent>
                      <Textarea
                        name="note"
                        placeholder={copy.notePlaceholder}
                        rows={3}
                      />
                    </FieldContent>
                  </Field>

                  <DialogFooter>
                    <DialogClose
                      render={
                        <Button type="button" variant="outline">
                          {copy.cancel}
                        </Button>
                      }
                    />
                    <Button
                      aria-busy={isPending}
                      disabled={isPending}
                      type="submit"
                    >
                      {isPending ? copy.pending : copy.confirm}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogPopup>
            </DialogViewport>
          </DialogPortal>
        </Dialog>
      )}
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </div>
  );
};
