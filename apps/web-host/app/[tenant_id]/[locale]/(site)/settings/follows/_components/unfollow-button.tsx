"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
import { LocaleField } from "#components/locale-field";
import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

export const UnfollowButton = ({
  publicId,
  returnTo,
  targetKind,
  targetName,
  tenantId,
}: {
  publicId: string;
  returnTo: string;
  targetKind: FollowTargetKind;
  /** The series or creator being unfollowed, named in the accessible label. */
  targetName: string;
  tenantId: string;
}) => {
  const t = useClientMessages();
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
          aria-label={t("host.follow.unfollow_aria", { name: targetName })}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="outline"
        >
          {isPending ? (
            <ClientMessage message="host.follow.pending" />
          ) : (
            <ClientMessage message="host.follow.unfollow" />
          )}
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
