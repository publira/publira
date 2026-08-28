"use client";

import { Button } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { useActionState } from "react";

import { LocaleField } from "#components/locale-field";
import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

/**
 * Resolved strings rather than nodes: the label swaps while the Action is in
 * flight, and the `aria-label` names the target it belongs to.
 */
interface UnfollowButtonCopy {
  ariaLabel: string;
  pending: string;
  submit: string;
}

export const UnfollowButton = ({
  copy,
  publicId,
  returnTo,
  targetKind,
  tenantId,
}: {
  copy: UnfollowButtonCopy;
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
