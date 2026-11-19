import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getPlatformWebPushSettings,
  toPlatformWebPushSettings,
} from "#lib/webpush-settings";

import { WebPushSettingsForm } from "./_components/webpush-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);

  return { title: t("platform.webpush.page_title") };
};

const FormSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40 justify-self-end" />
  </ConsoleSection.Root>
);

const WebPushSettingsSection = async () => {
  const locale = await getPlatformLocale();
  const result = await getPlatformWebPushSettings(locale);
  await redirectToLoginIfSessionRejected(result);

  return (
    <WebPushSettingsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      settings={result.ok ? result.settings : toPlatformWebPushSettings()}
    />
  );
};

const PlatformWebPushSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-56" />}>
            <Message message="platform.webpush.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.webpush.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<FormSkeleton />}>
        <WebPushSettingsSection />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default PlatformWebPushSettingsPage;
