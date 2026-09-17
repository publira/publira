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
import { getTenantDefaultLocale } from "#lib/tenant";

import { FollowButton, FollowLoginLink } from "./follow-button";

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
  const [defaultLocale, result] = await Promise.all([
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
        href={buildLoginPath(locale, defaultLocale, returnTo)}
        targetName={targetName}
      />
    );
  }

  return (
    <FollowButton
      isFollowing={result.isFollowing}
      publicId={publicId}
      returnTo={returnTo}
      targetKind={targetKind}
      targetName={targetName}
      tenantId={tenantId}
    />
  );
};
