import * as AuthScreen from "@publira/layouts/auth-screen";
import { Skeleton } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignInPanel } from "../_components/sign-in-panel";
import { ResendVerificationForm } from "./_components/resend-verification-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.resend_verification.title") };
};

const ResendVerificationHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);

  const [{ siteTagline }, siteLabel] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
  ]);

  return (
    <>
      <AuthScreen.Title>{siteLabel}</AuthScreen.Title>
      {siteTagline ? (
        <AuthScreen.Tagline>{siteTagline}</AuthScreen.Tagline>
      ) : null}
    </>
  );
};

const ResendVerificationPage = () => (
  <AuthScreen.Root>
    <AuthScreen.Main>
      <AuthScreen.Header>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <ResendVerificationHeader />
        </Suspense>
      </AuthScreen.Header>

      <ResendVerificationForm />
    </AuthScreen.Main>

    <SignInPanel />
  </AuthScreen.Root>
);

export default ResendVerificationPage;
