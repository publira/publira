import { getMessage } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";

import { buildLoginPath } from "#lib/auth-shared";
import type { FollowTargetKind } from "#lib/follow";
import { getMyFollowStatus } from "#lib/follow";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantDefaultLocale } from "#lib/tenant";

import { FollowButton, FollowLoginLink } from "./follow-button";

/**
 * Member-specific follow island. The surrounding series/author body stays on
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
  const [defaultLocale, result, messages] = await Promise.all([
    getTenantDefaultLocale(tenantId),
    getMyFollowStatus(tenantId, targetKind, publicId, locale),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError className="max-w-sm">
        <SectionErrorHeading>
          <SectionErrorTitle>
            {getMessage(messages, "host.follow.status_error")}
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (!result.signedIn) {
    return (
      <FollowLoginLink
        ariaLabel={getMessage(messages, "host.follow.login_aria", {
          name: targetName,
        })}
        href={buildLoginPath(locale, defaultLocale, returnTo)}
        label={getMessage(messages, "host.follow.follow")}
      />
    );
  }

  return (
    <FollowButton
      copy={{
        follow: getMessage(messages, "host.follow.follow"),
        followAriaLabel: getMessage(messages, "host.follow.follow_aria", {
          name: targetName,
        }),
        pending: getMessage(messages, "host.follow.pending"),
        unfollow: getMessage(messages, "host.follow.unfollow"),
        unfollowAriaLabel: getMessage(messages, "host.follow.unfollow_aria", {
          name: targetName,
        }),
      }}
      isFollowing={result.isFollowing}
      publicId={publicId}
      returnTo={returnTo}
      targetKind={targetKind}
      tenantId={tenantId}
    />
  );
};
