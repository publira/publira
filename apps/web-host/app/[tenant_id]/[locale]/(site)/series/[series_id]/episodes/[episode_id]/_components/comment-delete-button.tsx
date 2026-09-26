import {
  ActionForm,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleField } from "#components/locale-field";
import { Message } from "#components/message";
import { UntilActionSucceeds } from "#components/until-action-succeeds";

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
}) => (
  <ActionForm
    action={withdrawEpisodeCommentAction}
    className="grid justify-items-end gap-2"
  >
    <LocaleField />
    <input name="commentPublicId" type="hidden" value={commentPublicId} />
    <input name="episodePublicId" type="hidden" value={episodePublicId} />
    <input name="returnTo" type="hidden" value={returnTo} />
    <input name="tenantId" type="hidden" value={tenantId} />
    <UntilActionSucceeds>
      <ActionFormSubmit aria-label={ariaLabel} size="sm" variant="outline">
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="host.episode.comments.delete" />
          </Suspense>
        </ActionFormIdle>
        <ActionFormPending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.episode.comments.deleting" />
          </Suspense>
        </ActionFormPending>
      </ActionFormSubmit>
    </UntilActionSucceeds>
  </ActionForm>
);
