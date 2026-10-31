import * as ActionForm from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import { buildLoginPath } from "#lib/auth-shared";
import type { FollowTargetKind } from "#lib/follow";
import { getMyFollowStatus } from "#lib/follow";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDefaultLocale } from "#lib/tenant";

import * as FollowButton from "./follow-button";

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
 * Member-specific follow island. The surrounding series/creator body stays on
 * the public cache; this component must sit inside its own `<Suspense>` so
 * the session cookie does not personalize the static shell.
 */
export const FollowControl = async ({
  returnTo,
  targetId,
  targetKind,
  targetName,
  tenantId,
}: {
  returnTo: string;
  /** The internal ID of the series or creator this follows. */
  targetId: string;
  targetKind: FollowTargetKind;
  targetName: string;
  tenantId: string;
}) => {
  const locale = await getLocale();

  const [t, defaultLocale, result] = await Promise.all([
    getMessagesFor(locale),
    getTenantDefaultLocale(tenantId),
    getMyFollowStatus(tenantId, targetKind, targetId, locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError.Root className="max-w-sm">
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.follow.status_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (!result.signedIn) {
    return (
      <FollowLoginLink
        aria-label={t("storefront.follow.login_aria", { name: targetName })}
        href={buildLoginPath(locale, defaultLocale, returnTo)}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="storefront.follow.follow" />
        </Suspense>
      </FollowLoginLink>
    );
  }

  return (
    <FollowButton.Root
      isFollowing={result.isFollowing}
      returnTo={returnTo}
      targetId={targetId}
      targetKind={targetKind}
      tenantId={tenantId}
    >
      <FollowButton.Follow
        aria-label={t("storefront.follow.follow_aria", { name: targetName })}
      >
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
            <Message message="storefront.follow.follow" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.follow.pending" />
          </Suspense>
        </ActionForm.Pending>
      </FollowButton.Follow>
      <FollowButton.Unfollow
        aria-label={t("storefront.follow.unfollow_aria", { name: targetName })}
      >
        <ActionForm.Idle>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.follow.unfollow" />
          </Suspense>
        </ActionForm.Idle>
        <ActionForm.Pending>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.follow.pending" />
          </Suspense>
        </ActionForm.Pending>
      </FollowButton.Unfollow>
    </FollowButton.Root>
  );
};
