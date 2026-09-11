import { getMessage } from "@publira/i18n";
import {
  AuthScreen,
  AuthScreenHeader,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.auth.reset_password.title") };
};

const ResetPasswordHeader = async () => {
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
        pageTitle={getMessage(messages, "host.auth.reset_password.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

const ResetPasswordPage = () => (
  <AuthScreen>
    <AuthScreenHeader>
      <Suspense fallback={<Skeleton className="h-8 w-40" />}>
        <ResetPasswordHeader />
      </Suspense>
    </AuthScreenHeader>

    <ResetPasswordForm />
  </AuthScreen>
);

export default ResetPasswordPage;
