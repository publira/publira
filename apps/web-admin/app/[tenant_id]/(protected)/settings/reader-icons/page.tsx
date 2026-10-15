import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminCurrentUser, isTenantAdminRole } from "#lib/admin-auth";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getTenantReaderIconPolicy,
  listReaderIconPresets,
} from "#lib/reader-icon-settings";
import { getTenantId } from "#lib/tenant-id";

import { SettingsTabNav } from "../_components/settings-tab-nav";
import { ReaderIconPolicyForm } from "./_components/reader-icon-policy-form";
import { ReaderIconPresetGallery } from "./_components/reader-icon-preset-gallery";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.settings.reader_icons_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const ReaderIconSettingsSkeleton = () => (
  <AdminSections>
    <AdminSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-32" />
      <Skeleton className="h-24" />
      <Skeleton className="h-10" />
    </AdminSection>
  </AdminSections>
);

const ReaderIconSettings = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);

  const [policyResult, presetsResult, currentUserResult] = await Promise.all([
    getTenantReaderIconPolicy(tenantId, locale),
    listReaderIconPresets(tenantId, locale),
    getAdminCurrentUser(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(
    policyResult,
    presetsResult,
    currentUserResult
  );

  const canEdit = isTenantAdminRole(
    currentUserResult.ok ? currentUserResult.user.role : undefined
  );

  return (
    <AdminSections>
      <ReaderIconPolicyForm
        canEdit={canEdit}
        initialPolicy={policyResult.ok ? policyResult.policy : undefined}
        loadErrorMessage={policyResult.ok ? undefined : policyResult.message}
        tenantId={tenantId}
      />

      <ReaderIconPresetGallery
        canEdit={canEdit}
        listErrorMessage={presetsResult.ok ? undefined : presetsResult.message}
        presets={presetsResult.ok ? presetsResult.presets : []}
        tenantId={tenantId}
      />
    </AdminSections>
  );
};

const ReaderIconSettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-24" />}>
            <Message message="admin.settings.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.reader_icons_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <SettingsTabNav current="reader-icons" />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.section_error" />
            </Suspense>
          }
        >
          <Suspense fallback={<ReaderIconSettingsSkeleton />}>
            <ReaderIconSettings />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default ReaderIconSettingsPage;
