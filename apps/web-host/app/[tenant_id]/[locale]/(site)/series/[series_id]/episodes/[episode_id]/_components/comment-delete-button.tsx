"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { LocaleField } from "#components/locale-field";

import { withdrawEpisodeCommentAction } from "../_lib/comment-actions";

/**
 * Resolved strings rather than nodes: the label swaps while the Action is in
 * flight, and the `aria-label` names the comment the control belongs to.
 */
interface CommentDeleteButtonCopy {
  ariaLabel: string;
  pending: string;
  submit: string;
}

/**
 * Deletes one of the reader's own comments.
 *
 * The control disappears once the Action succeeds, the way unfollowing does:
 * the row it belonged to is gone from the next render, and leaving a button
 * behind would invite a second submission the API would answer `not found`.
 */
export const CommentDeleteButton = ({
  commentPublicId,
  copy,
  episodePublicId,
  returnTo,
  tenantId,
}: {
  commentPublicId: string;
  copy: CommentDeleteButtonCopy;
  episodePublicId: string;
  returnTo: string;
  tenantId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    withdrawEpisodeCommentAction,
    null
  );
  const deleted = state?.ok === true;

  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <LocaleField />
      <input name="commentPublicId" type="hidden" value={commentPublicId} />
      <input name="episodePublicId" type="hidden" value={episodePublicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="tenantId" type="hidden" value={tenantId} />
      {deleted ? null : (
        <Button
          aria-busy={isPending}
          aria-label={copy.ariaLabel}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="outline"
        >
          {isPending ? copy.pending : copy.submit}
        </Button>
      )}
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};
