import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getAdminMfaStatus } from "#lib/admin-mfa";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { EmailChangeForm } from "../_components/email-change-form";
import { MfaSettingsCard } from "../_components/mfa-settings-card";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.settings.account_title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const MfaSectionSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-10" />
  </div>
);

const EmailChangeFormSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-16" />
    <Skeleton className="h-16" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-36" />
  </div>
);

const EmailChangeSection = async () => {
  const tenantId = await getTenantId();

  return <EmailChangeForm tenantId={tenantId} />;
};

const MfaSection = async () => {
  const tenantId = await getTenantId();
  const [result, locale, timeZone] = await Promise.all([
    getAdminMfaStatus(tenantId),
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.settings.section_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.settings.mfa.load_failed" />
            </Suspense>
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <MfaSettingsCard
      locale={locale}
      status={result.status}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const AccountSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.settings.account_title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.settings.account_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <div className="grid gap-6">
        <Suspense fallback={<EmailChangeFormSkeleton />}>
          <EmailChangeSection />
        </Suspense>
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
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default AccountSettingsPage;
