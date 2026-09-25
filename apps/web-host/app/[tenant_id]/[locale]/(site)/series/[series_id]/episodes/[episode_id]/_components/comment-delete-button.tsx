"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleField } from "#components/locale-field";

import { withdrawEpisodeCommentAction } from "../_lib/comment-actions";

/**
 * Deletes one of the reader's own comments.
 *
 * The control disappears once the Action succeeds, the way unfollowing does:
 * the row it belonged to is gone from the next render, and leaving a button
 * behind would invite a second submission the API would answer `not found`.
 *
 * `aria-label` names the comment, since a reader can have several on one
 * episode.
 */
export const CommentDeleteButton = ({
  "aria-label": ariaLabel,
  commentPublicId,
  episodePublicId,
  returnTo,
  tenantId,
}: {
  "aria-label": string;
  commentPublicId: string;
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
          aria-label={ariaLabel}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="outline"
        >
          <ActionFormIdle>
            <ClientMessage message="host.episode.comments.delete" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="host.episode.comments.deleting" />
          </ActionFormPending>
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
