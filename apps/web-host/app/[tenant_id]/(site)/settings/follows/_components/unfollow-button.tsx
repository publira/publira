"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

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
  targetName: string;
  tenantId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    toggleFollowAction,
    null as FollowActionState
  );
  const removed = state?.ok === true && !state.isFollowing;

  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <input name="intent" type="hidden" value="unfollow" />
      <input name="publicId" type="hidden" value={publicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="targetKind" type="hidden" value={targetKind} />
      <input name="tenantId" type="hidden" value={tenantId} />
      {removed ? null : (
        <Button
          aria-busy={isPending}
          aria-label={`「${targetName}」のフォローを解除する`}
          disabled={isPending}
          size="sm"
          type="submit"
          variant="outline"
        >
          {isPending ? "更新中…" : "フォローを解除"}
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
