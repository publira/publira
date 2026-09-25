import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { Message } from "#components/message";
import { buildLoginPath } from "#lib/auth-shared";
import type { FollowTargetKind } from "#lib/follow";
import { getMyFollowStatus } from "#lib/follow";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDefaultLocale } from "#lib/tenant";

import {
  FollowButton,
  FollowButtonFollow,
  FollowButtonUnfollow,
  FollowLoginLink,
} from "./follow-button";

/**
 * Member-specific follow island. The surrounding series/creator body stays on
 * the public cache; this component must sit inside its own `<Suspense>` so
 * the session cookie does not personalize the static shell.
 */
export const FollowControl = async ({
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
  const locale = await getLocale();
  const [t, defaultLocale, result] = await Promise.all([
    getMessagesFor(locale),
    getTenantDefaultLocale(tenantId),
    getMyFollowStatus(tenantId, targetKind, publicId, locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError className="max-w-sm">
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.follow.status_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (!result.signedIn) {
    return (
      <FollowLoginLink
        aria-label={t("host.follow.login_aria", { name: targetName })}
        href={buildLoginPath(locale, defaultLocale, returnTo)}
      />
    );
  }

  return (
    <FollowButton
      isFollowing={result.isFollowing}
      publicId={publicId}
      returnTo={returnTo}
      targetKind={targetKind}
      tenantId={tenantId}
    >
      <FollowButtonFollow
        aria-label={t("host.follow.follow_aria", { name: targetName })}
      />
      <FollowButtonUnfollow
        aria-label={t("host.follow.unfollow_aria", { name: targetName })}
      />
    </FollowButton>
  );
};
