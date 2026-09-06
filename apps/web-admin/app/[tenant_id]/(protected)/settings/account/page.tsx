import { getMessage } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminMfaStatus } from "#lib/admin-mfa";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { EmailChangeForm } from "../_components/email-change-form";
import { MfaSettingsCard } from "../_components/mfa-settings-card";
import { requestEmailChangeAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.settings.account_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const MfaSectionSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="h-10 animate-pulse rounded bg-muted/70" />
  </div>
);

const MfaSection = async () => {
  const tenantId = await getTenantId();
  const result = await getAdminMfaStatus(tenantId);

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.section_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.mfa.load_failed" />
            </Suspense>
          </SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  return <MfaSettingsCard status={result.status} />;
};

const AccountSettingsPage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.settings.account_title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.account_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <div className="grid gap-6">
        <EmailChangeForm action={requestEmailChangeAction} />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.mfa.title" />
            </Suspense>
          }
        >
          <Suspense fallback={<MfaSectionSkeleton />}>
            <MfaSection />
          </Suspense>
        </SectionErrorBoundary>
      </div>
    </AdminPageContent>
  </AdminPage>
);

export default AccountSettingsPage;
