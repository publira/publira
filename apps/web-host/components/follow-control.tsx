import { SectionError } from "@publira/ui-components/section-error";

import { buildLoginPath } from "#lib/auth-shared";
import type { FollowTargetKind } from "#lib/follow";
import { getMyFollowStatus } from "#lib/follow";
import { getLocale } from "#lib/locale";

import { FollowButton, FollowLoginLink } from "./follow-button";

/**
 * Member-specific follow island. The surrounding series/author body stays on
 * the public cache; this component must sit inside its own `<Suspense>` so
 * the session cookie does not personalize the static shell (#1130).
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
  const [locale, result] = await Promise.all([
    getLocale(),
    getMyFollowStatus(tenantId, targetKind, publicId),
  ]);

  if (!result.ok) {
    return (
      <SectionError
        className="max-w-sm"
        description={result.message}
        title="フォロー状態を表示できませんでした"
      />
    );
  }

  if (!result.signedIn) {
    return (
      <FollowLoginLink
        href={buildLoginPath(locale, returnTo)}
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
