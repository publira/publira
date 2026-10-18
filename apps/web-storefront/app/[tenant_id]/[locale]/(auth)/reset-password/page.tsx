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
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.reset_password.title") };
};

const ResetPasswordHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.reset_password.title")}
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
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ResetPasswordHeader />
        </Suspense>
      </AuthScreenHeader>

      <ResetPasswordForm />
    </AuthScreenMain>
  </AuthScreen>
);

export default ResetPasswordPage;
