import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformPolicy } from "#lib/platform-policy";
import type { PlatformCommunityLimits } from "#lib/platform-policy";

import { CommunityLimitsForm } from "./_components/community-limits-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.policy.community.page_title") };
};

const emptyValues: PlatformCommunityLimits = {
  commentPost: { perDay: 1, perMinute: 1 },
  commentReport: { perDay: 1, perMinute: 1 },
  contactMessagePerAccount: { perDay: 1, perHour: 1 },
  contactMessagePerClient: { perDay: 1, perHour: 1 },
  duplicateCommentWindowMinutes: 1,
  episodeRating: { perDay: 1, perMinute: 1 },
  notificationSettings: { perDay: 1, perMinute: 1 },
  viewerPreferences: { perDay: 1, perMinute: 1 },
};

const FormSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-6 w-32" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
  </ConsoleSection.Root>
);

const Content = async () => {
  const result = await getPlatformPolicy();
  return (
    <CommunityLimitsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      revision={result.ok ? result.revision : "0"}
      values={result.ok ? result.values.community : emptyValues}
    />
  );
};

const CommunityPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-28" />}>
            <Message message="platform.policy.community.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="platform.policy.community.page_description" />
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

export default CommunityPage;
