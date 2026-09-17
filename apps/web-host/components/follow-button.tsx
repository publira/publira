"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { useActionState } from "react";

import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

import { useClientMessages } from "./client-message";
import { LocaleField } from "./locale-field";

const followButtonClassName = "shrink-0";

export const FollowControlSkeleton = () => <Skeleton className="h-10 w-28" />;

export const FollowLoginLink = ({
  href,
  targetName,
}: {
  href: string;
  /** The series or creator being followed, named in the accessible label. */
  targetName: string;
}) => {
  const t = useClientMessages();

  return (
    <LinkButton
      aria-label={t("host.follow.login_aria", { name: targetName })}
      className={followButtonClassName}
      render={<Link href={href} />}
      size="lg"
      variant="outline"
    >
      {t("host.follow.follow")}
    </LinkButton>
  );
};

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
  /** The series or creator being followed, named in the accessible label. */
  targetName: string;
  tenantId: string;
}) => {
  const t = useClientMessages();
  const [state, formAction, isPending] = useActionState(
    toggleFollowAction,
    null as FollowActionState
  );
  const following = state?.ok ? state.isFollowing : isFollowing;
  const intent = following ? "unfollow" : "follow";
  const label = following
    ? t("host.follow.unfollow_aria", { name: targetName })
    : t("host.follow.follow_aria", { name: targetName });
  let buttonLabel = t("host.follow.follow");
  if (isPending) {
    buttonLabel = t("host.follow.pending");
  } else if (following) {
    buttonLabel = t("host.follow.unfollow");
  }

  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <LocaleField />
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
        size="lg"
        type="submit"
        variant="outline"
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
