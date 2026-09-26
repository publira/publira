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
import type { FollowTargetKind } from "#lib/follow";
import { toggleFollowAction } from "#lib/follow-actions";

/** `aria-label` names the series or creator it unfollows. */
export const UnfollowButton = ({
  "aria-label": ariaLabel,
  publicId,
  returnTo,
  targetKind,
  tenantId,
}: {
  "aria-label": string;
  publicId: string;
  returnTo: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}) => (
  <ActionForm
    action={toggleFollowAction}
    className="grid justify-items-end gap-2"
  >
    <LocaleField />
    <input name="intent" type="hidden" value="unfollow" />
    <input name="publicId" type="hidden" value={publicId} />
    <input name="returnTo" type="hidden" value={returnTo} />
    <input name="targetKind" type="hidden" value={targetKind} />
    <input name="tenantId" type="hidden" value={tenantId} />
    <UntilActionSucceeds>
      <ActionFormSubmit aria-label={ariaLabel} size="sm" variant="outline">
        <ActionFormIdle>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.follow.unfollow" />
          </Suspense>
        </ActionFormIdle>
        <ActionFormPending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.follow.pending" />
          </Suspense>
        </ActionFormPending>
      </ActionFormSubmit>
    </UntilActionSucceeds>
  </ActionForm>
);
