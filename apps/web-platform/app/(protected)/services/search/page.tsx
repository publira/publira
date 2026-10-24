import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getPlatformLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPlatformDisplayTimeZone } from "#lib/platform-settings";
import {
  getPlatformSearchSettings,
  toPlatformSearchSettings,
} from "#lib/search-settings";

import { SearchAnalysisForm } from "./_components/search-analysis-form";
import { SearchSettingsForm } from "./_components/search-settings-form";
import { SearchStatus } from "./_components/search-status";

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getPlatformLocale();
  const t = await getMessagesFor(locale);
  return { title: t("platform.search.page_title") };
};

const SectionsSkeleton = () => (
  <>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-16 w-full" />
    </ConsoleSection.Root>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-40" />
    </ConsoleSection.Root>
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
      {/* The SQL engine keeps no index, so it has no analysis to edit. */}
      {result.settings.engine === "sql" ? null : (
        <SearchAnalysisForm locale={locale} settings={result.settings} />
      )}
    </>
  );
};

const PlatformSearchSettingsPage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
            <Message message="platform.search.heading" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="platform.search.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<SectionsSkeleton />}>
        <SearchSettingsSections />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default PlatformSearchSettingsPage;
