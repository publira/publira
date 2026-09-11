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
  RESEND_VERIFICATION_REQUESTED_EMAIL_COOKIE,
} from "#lib/email-flash-cookie";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return {
    title: getMessage(
      messages,
      "host.auth.resend_verification_requested.title"
    ),
  };
};

const ResendVerificationRequestedHeader = async () => {
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
          "host.auth.resend_verification_requested.title"
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
const ResendVerificationRequestedRecipient = async () => {
  const email = await readEmailFlashCookie(
    RESEND_VERIFICATION_REQUESTED_EMAIL_COOKIE
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

const ResendVerificationRequestedPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <ResendVerificationRequestedHeader />
      </Suspense>
    </AuthScreenHeader>

    <AuthScreenBody>
      <AuthScreenText>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.resend_verification_requested.sent" />
        </Suspense>
      </AuthScreenText>
      <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
        <ResendVerificationRequestedRecipient />
      </Suspense>
      <AuthScreenNote>
        <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
          <Message message="host.auth.fields.check_spam" />
        </Suspense>
      </AuthScreenNote>
    </AuthScreenBody>

    <AuthScreenFooter>
      <p>
        <Suspense fallback={<SkeletonLine className="inline-block h-4 w-32" />}>
          <LocaleLink
            href="/login"
            className="text-primary underline underline-offset-4"
          >
            <Message message="host.auth.fields.to_login" />
          </LocaleLink>
        </Suspense>
      </p>
    </AuthScreenFooter>
  </AuthScreen>
);

export default ResendVerificationRequestedPage;
