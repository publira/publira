import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PlatformPage,
  PlatformPageContent,
  PlatformPageDescription,
  PlatformPageHeader,
  PlatformPageHeading,
  PlatformPageTitle,
  PlatformSection,
} from "#components/platform-page";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformRetentionDefaults } from "#lib/platform-policy";
import type { PlatformRetentionDefaults } from "#lib/platform-policy";

import { SettingsNavigation } from "../_components/settings-navigation";
import { RetentionDefaultsForm } from "./_components/retention-defaults-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.policy.retention.page_title") };
};

const emptyValues: PlatformRetentionDefaults = {
  contentEventDays: 1,
  dailyRankingSnapshotDays: 1,
  weeklyRankingSnapshotDays: 1,
  withdrawnCommentDays: 1,
};

const FormSkeleton = () => (
  <PlatformSection>
    <SkeletonLine className="h-6 w-32" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
  </PlatformSection>
);

const Content = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformRetentionDefaults(locale);
  await redirectToLoginIfSessionRejected(result);
  return (
    <RetentionDefaultsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      revision={result.ok ? result.revision : "0"}
      values={result.ok ? result.values : emptyValues}
    />
  );
};

const RetentionPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-28" />}>
            <Message message="platform.policy.retention.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.retention.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsNavigation current="retention" />
        <Suspense fallback={<FormSkeleton />}>
          <Content />
        </Suspense>
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default RetentionPage;
