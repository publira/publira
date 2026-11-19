import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformMfaStatus } from "#lib/platform-mfa";

import { EmailChangeForm } from "./_components/email-change-form";
import { MfaSettingsCard } from "./_components/mfa-settings-card";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.settings.account_title") };
};

const MfaSectionSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-10" />
  </div>
);

const MfaSection = async () => {
  const result = await getPlatformMfaStatus();

  if (!result.ok) {
    await redirectToLoginIfSessionRejected(result);

    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.settings.mfa.title" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="platform.settings.mfa.load_failed" />
            </Suspense>
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return <MfaSettingsCard status={result.status} />;
};

const PlatformAccountSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.settings.account_heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.settings.account_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <div className="grid gap-6">
        <EmailChangeForm />
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="platform.settings.mfa.title" />
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

export default PlatformAccountSettingsPage;
