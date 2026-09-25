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
import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
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
}) => {
  const [state, formAction, isPending] = useActionState(
    toggleFollowAction,
    null as FollowActionState
  );
  const removed = state?.ok === true && !state.isFollowing;

  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <LocaleField />
      <input name="intent" type="hidden" value="unfollow" />
      <input name="publicId" type="hidden" value={publicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="targetKind" type="hidden" value={targetKind} />
      <input name="tenantId" type="hidden" value={tenantId} />
      {removed ? null : (
        <Button
          aria-busy={isPending}
          aria-label={ariaLabel}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="outline"
        >
          <ActionFormIdle>
            <ClientMessage message="host.follow.unfollow" />
          </ActionFormIdle>
          <ActionFormPending>
            <ClientMessage message="host.follow.pending" />
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
