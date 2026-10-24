import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getPlatformStorageSettings,
  toPlatformStorageSettings,
} from "#lib/storage-settings";

import { StorageSettingsForm } from "./_components/storage-settings-form";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.storage.page_title") };
};

const FormSkeleton = () => (
  <ConsoleSection.Root>
    <SkeletonLine className="h-5 w-40" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-full" />
    <Skeleton className="h-9 w-40" />
  </ConsoleSection.Root>
);

const StorageSettingsSection = async () => {
  const result = await getPlatformStorageSettings();

  return (
    <StorageSettingsForm
      loadErrorMessage={result.ok ? undefined : result.message}
      settings={result.ok ? result.settings : toPlatformStorageSettings()}
    />
  );
};

const PlatformStorageSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.storage.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.storage.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<FormSkeleton />}>
        <StorageSettingsSection />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default PlatformStorageSettingsPage;
