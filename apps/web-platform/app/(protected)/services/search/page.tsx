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
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import {
  getPlatformSearchSettings,
  toPlatformSearchSettings,
} from "#lib/search-settings";

import { SearchSettingsForm } from "./_components/search-settings-form";
import { SearchStatus } from "./_components/search-status";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.search.page_title") };
};

const SectionsSkeleton = () => (
  <>
    <PlatformSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-16 w-full" />
    </PlatformSection>
    <PlatformSection>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-40" />
    </PlatformSection>
  </>
);

const SearchSettingsSections = async () => {
  const [result, locale, timeZone] = await Promise.all([
    getPlatformSearchSettings(),
    getPlatformLocale(),
    getPlatformDisplayTimeZone(),
  ]);

  if (!result.ok) {
    return (
      <SearchSettingsForm
        loadErrorMessage={result.message}
        settings={toPlatformSearchSettings()}
      />
    );
  }

  return (
    <>
      <SearchStatus
        locale={locale}
        settings={result.settings}
        timeZone={timeZone}
      />
      <SearchSettingsForm settings={result.settings} />
    </>
  );
};

const PlatformSearchSettingsPage = () => (
  <PlatformPage>
    <PlatformPageHeader>
      <PlatformPageHeading>
        <PlatformPageTitle>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.search.heading" />
          </Suspense>
        </PlatformPageTitle>
        <PlatformPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.page_description" />
          </Suspense>
        </PlatformPageDescription>
      </PlatformPageHeading>
    </PlatformPageHeader>
    <PlatformPageContent>
      <Suspense fallback={<SectionsSkeleton />}>
        <SearchSettingsSections />
      </Suspense>
    </PlatformPageContent>
  </PlatformPage>
);

export default PlatformSearchSettingsPage;
