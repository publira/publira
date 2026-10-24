import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { listGenres } from "#lib/genre";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";
import { findTenantLocales } from "#lib/tenant-locales";

import { GenreManager } from "./_components/genre-manager";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.genres.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const GenreManagerSkeleton = () => (
  <ConsoleSection.Stack>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-40" />
      <Skeleton className="h-10 sm:max-w-sm" />
    </ConsoleSection.Root>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-32" />
      <Table.Skeleton />
    </ConsoleSection.Root>
  </ConsoleSection.Stack>
);

const GenreManagerData = async () => {
  const tenantId = await getTenantId();
  const [locale, listResult, canEdit, tenantLocales] = await Promise.all([
    getLocale(tenantId),
    listGenres(),
    isSignedInTenantEditor(tenantId),
    findTenantLocales(tenantId),
  ]);

  return (
    <GenreManager
      canEdit={canEdit}
      genres={listResult.genres}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      tenantId={tenantId}
      tenantLocales={tenantLocales}
    />
  );
};

const GenrePage = () => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.genres.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.genres.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<GenreManagerSkeleton />}>
        <GenreManagerData />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default GenrePage;
