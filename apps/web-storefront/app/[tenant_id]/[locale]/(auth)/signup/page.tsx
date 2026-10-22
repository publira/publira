import {
  AuthScreen,
  AuthScreenBody,
  AuthScreenHeader,
  AuthScreenMain,
  AuthScreenTagline,
  AuthScreenTitle,
} from "@publira/layouts/auth-screen";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { TenantDocumentTitle } from "#components/tenant-document-title";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantSiteCopy, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { SignupContent } from "./_components/signup-content";

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getMessages();

  return { title: t("storefront.auth.signup.title") };
};

const SignupPageHeader = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [{ siteTagline }, siteLabel, t] = await Promise.all([
    getTenantSiteCopy(tenantId, locale),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return (
    <>
      <TenantDocumentTitle
        pageTitle={t("storefront.auth.signup.title")}
        siteLabel={siteLabel}
      />
      <AuthScreenTitle>{siteLabel}</AuthScreenTitle>
      {siteTagline ? (
        <AuthScreenTagline>{siteTagline}</AuthScreenTagline>
      ) : null}
    </>
  );
};

const SignupFormSkeleton = () => (
  <AuthScreenBody>
    <div className="grid gap-2">
      <SkeletonLine className="h-4 w-20" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="grid gap-2">
      <SkeletonLine className="h-4 w-28" />
      <Skeleton className="h-10 w-full" />
    </div>
    <div className="grid gap-2">
      <SkeletonLine className="h-4 w-20" />
      <Skeleton className="h-10 w-full" />
    </div>
    <Skeleton className="h-9 w-24" />
  </AuthScreenBody>
);

const SignupPage = () => (
  <AuthScreen>
    <AuthScreenMain>
      <AuthScreenHeader>
        <Suspense fallback={<Skeleton className="h-8 w-40" />}>
          <SignupPageHeader />
        </Suspense>
      </AuthScreenHeader>

      <Suspense fallback={<SignupFormSkeleton />}>
        <SignupContent />
      </Suspense>
    </AuthScreenMain>
  </AuthScreen>
);

export default SignupPage;
