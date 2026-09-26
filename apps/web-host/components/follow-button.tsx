import { ActionForm } from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import type { ReactNode } from "react";

import type { FollowTargetKind } from "#lib/follow";
import { toggleFollowAction } from "#lib/follow-actions";

import { FollowButtonState } from "./follow-button-state";
import { LocaleField } from "./locale-field";

export const FollowControlSkeleton = () => <Skeleton className="h-10 w-28" />;

/**
 * The follow control a signed-out reader gets. `aria-label` names what signing
 * in would follow.
 */
export const FollowLoginLink = ({
  "aria-label": ariaLabel,
  children,
  href,
}: {
  "aria-label": string;
  children: ReactNode;
  href: string;
}) => (
  <LinkButton
    aria-label={ariaLabel}
    className="shrink-0"
    render={<Link href={href} />}
    size="lg"
    variant="outline"
  >
    {children}
  </LinkButton>
);

/**
 * A toggle between following and not. The reader's current state decides
 * which of its two slots renders, so each carries the accessible name for its
 * own intent:
 *
 * ```tsx
 * <FollowButton isFollowing={…} publicId={…} returnTo={…} targetKind="series" tenantId={…}>
 *   <FollowButtonFollow aria-label={t("host.follow.follow_aria", { name })}>
 *     <ActionFormIdle>…</ActionFormIdle>
 *     <ActionFormPending>…</ActionFormPending>
 *   </FollowButtonFollow>
 *   <FollowButtonUnfollow aria-label={t("host.follow.unfollow_aria", { name })}>
 *     …
 *   </FollowButtonUnfollow>
 * </FollowButton>
 * ```
 */
export const FollowButton = ({
  children,
  isFollowing,
  publicId,
  returnTo,
  targetKind,
  tenantId,
}: {
  /** `FollowButtonFollow` and `FollowButtonUnfollow`. */
  children: ReactNode;
  isFollowing: boolean;
  publicId: string;
  returnTo: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}) => (
  <ActionForm
    action={toggleFollowAction}
    className="grid justify-items-start gap-2"
  >
    <LocaleField />
    <input name="publicId" type="hidden" value={publicId} />
    <input name="returnTo" type="hidden" value={returnTo} />
    <input name="targetKind" type="hidden" value={targetKind} />
    <input name="tenantId" type="hidden" value={tenantId} />
    <FollowButtonState isFollowing={isFollowing}>{children}</FollowButtonState>
  </ActionForm>
);
