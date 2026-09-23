import { LinkButton } from "@publira/ui-components/button";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getRoyaltyClosePolicy } from "#lib/royalties";
import { getTenantId } from "#lib/tenant-id";

import { RoyaltyCloseSettingsForm } from "./_components/royalty-close-settings-form";
import { updateRoyaltyCloseSettingsAction } from "./_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.royalties.close_settings.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const RoyaltyCloseSettingsSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-48" />
    <div className="grid gap-3 sm:max-w-lg">
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
    </div>
  </div>
);

const RoyaltyCloseSettingsSection = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const [policyResult, currentUserResult] = await Promise.all([
    getRoyaltyClosePolicy(tenantId, locale),
    getAdminCurrentUser(tenantId),
  ]);
  await redirectToLoginIfSessionRejected(policyResult, currentUserResult);

  return (
    <RoyaltyCloseSettingsForm
      action={updateRoyaltyCloseSettingsAction}
      canEdit={isTenantAdminRole(
        currentUserResult.ok ? currentUserResult.user.role : undefined
      )}
      initialPolicy={policyResult.ok ? policyResult.policy : undefined}
      loadErrorMessage={policyResult.ok ? undefined : policyResult.message}
    />
  );
};

const RoyaltyCloseSettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.royalties.close_settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.royalties.close_settings.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/royalties" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.royalties.open_month_link" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.royalties.close_settings.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<RoyaltyCloseSettingsSkeleton />}>
          <RoyaltyCloseSettingsSection />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default RoyaltyCloseSettingsPage;
