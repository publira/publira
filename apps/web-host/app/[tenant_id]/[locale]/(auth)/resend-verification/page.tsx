import {
  AuthScreen,
  AuthScreenHeader,
  AuthScreenMain,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { ResendVerificationForm } from "./_components/resend-verification-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("host.auth.resend_verification.title") };
};

const ResendVerificationHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [info, siteLabel, t] = await Promise.all([
    getTenantSiteInfo(tenantId),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);
  const siteTagline = info?.siteTagline?.trim();

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("host.auth.resend_verification.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

const ResendVerificationPage = () => (
  <AuthScreen>
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ResendVerificationHeader />
        </Suspense>
      </AuthScreenHeader>

      <ResendVerificationForm />
    </AuthScreenMain>
  </AuthScreen>
);

export default ResendVerificationPage;
