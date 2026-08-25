"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";
import { useActionState } from "react";

import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

const followButtonClassName = "shrink-0";

export const FollowControlSkeleton = () => (
  <div
    aria-hidden="true"
    className="h-9 w-28 animate-pulse rounded-md bg-muted"
  />
);

export const FollowLoginLink = ({
  href,
  targetName,
}: {
  href: string;
  targetName: string;
}) => (
  <LinkButton
    aria-label={`ログインして「${targetName}」をフォローする`}
    className={followButtonClassName}
    render={<Link href={href} />}
    size="sm"
    variant="outline"
  >
    フォローする
  </LinkButton>
);

export const FollowButton = ({
  isFollowing,
  publicId,
  returnTo,
  targetKind,
  targetName,
  tenantId,
}: {
  isFollowing: boolean;
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
  const following = state?.ok ? state.isFollowing : isFollowing;
  const intent = following ? "unfollow" : "follow";
  const label = following
    ? `「${targetName}」のフォローを解除する`
    : `「${targetName}」をフォローする`;
  let buttonLabel = "フォローする";
  if (isPending) {
    buttonLabel = "更新中…";
  } else if (following) {
    buttonLabel = "フォローを解除";
  }

  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <input name="intent" type="hidden" value={intent} />
      <input name="publicId" type="hidden" value={publicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="targetKind" type="hidden" value={targetKind} />
      <input name="tenantId" type="hidden" value={tenantId} />
      <Button
        aria-busy={isPending}
        aria-label={label}
        aria-pressed={following}
        className={followButtonClassName}
        disabled={isPending}
        size="sm"
        type="submit"
        variant={following ? "outline" : "default"}
      >
        {buttonLabel}
      </Button>
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};
