import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformRetentionDefaults } from "#lib/platform-policy";
import type { PlatformRetentionDefaults } from "#lib/platform-policy";

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
  <ConsoleSection.Root>
    <SkeletonLine className="h-6 w-32" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
  </ConsoleSection.Root>
);

const Content = async () => {
  const result = await getPlatformRetentionDefaults();
  return (
    <RetentionDefaultsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      revision={result.ok ? result.revision : "0"}
      values={result.ok ? result.values : emptyValues}
    />
  );
};

const RetentionPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-28" />}>
            <Message message="platform.policy.retention.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.retention.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<FormSkeleton />}>
        <Content />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default RetentionPage;
