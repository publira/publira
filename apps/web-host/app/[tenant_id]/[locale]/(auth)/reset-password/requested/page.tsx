import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenFooter,
  AuthScreenHeader,
  AuthScreenNote,
  AuthScreenTagline,
  AuthScreenText,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { TenantDocumentTitle } from "#components/tenant-document-title";
import {
  readEmailFlashCookie,
  RESET_PASSWORD_REQUESTED_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return {
    title: getMessage(messages, "host.auth.reset_password_requested.title"),
  };
};

const ResetPasswordRequestedHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, messages] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={getMessage(
          messages,
          "host.auth.reset_password_requested.title"
        )}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

/** The address is only known once the flash cookie is read, so it blocks. */
const ResetPasswordRequestedRecipient = async () => {
  const email = await readEmailFlashCookie(
    RESET_PASSWORD_REQUESTED_EMAIL_COOKIE
  );

  if (!email) {
    return null;
  }

  return (
    <AuthScreenNote>
      <Message message="host.auth.fields.sent_to" values={{ email }} />
    </AuthScreenNote>
  );
};

const ResetPasswordRequestedPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <ResetPasswordRequestedHeader />
      </Suspense>
    </AuthScreenHeader>

    <AuthScreenBody>
      <AuthScreenText>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.reset_password_requested.sent" />
        </Suspense>
      </AuthScreenText>
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <ResetPasswordRequestedRecipient />
      </Suspense>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.fields.check_spam" />
        </Suspense>
      </AuthScreenNote>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <LocaleLink
          href="/login"
          className="text-primary underline underline-offset-4"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.auth.fields.to_login" />
          </Suspense>
        </LocaleLink>
      </p>
    </AuthScreenFooter>
  </AuthScreen>
);

export default ResetPasswordRequestedPage;
