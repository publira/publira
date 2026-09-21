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
import {
  getPlatformWebPushSettings,
  toPlatformWebPushSettings,
} from "#lib/webpush-settings";

import { SettingsNavigation } from "../_components/settings-navigation";
import { WebPushSettingsForm } from "./_components/webpush-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.webpush.page_title") };
};

const FormSkeleton = () => (
  <PlatformSection>
    <SkeletonLine className="h-5 w-24" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40 justify-self-end" />
  </PlatformSection>
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
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-16" />}>
            <Message message="platform.webpush.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.webpush.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <div className="grid gap-6">
        <SettingsNavigation current="webpush" />
        <Suspense fallback={<FormSkeleton />}>
          <WebPushSettingsSection />
        </Suspense>
      </div>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformWebPushSettingsPage;
