import { getMessage } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listGenres } from "#lib/genre";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { GenreManager } from "./_components/genre-manager";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.genres.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const GenreManagerSkeleton = () => (
  <div className="grid gap-6">
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
      <div className="h-10 animate-pulse rounded bg-muted/70" />
    </div>
    <div className="rounded-2xl border border-border/70 bg-card p-6">
      <div className="mb-4 h-6 w-32 animate-pulse rounded bg-muted" />
      <div className="grid gap-3">
        <div className="h-14 animate-pulse rounded bg-muted/70" />
        <div className="h-14 animate-pulse rounded bg-muted/70" />
        <div className="h-14 animate-pulse rounded bg-muted/70" />
      </div>
    </div>
  </div>
);

const GenreManagerData = async () => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const listResult = await listGenres(tenantId, locale);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <GenreManager
      genres={listResult.genres}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      tenantId={tenantId}
    />
  );
};

const GenrePage = () => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.genres.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.genres.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<GenreManagerSkeleton />}>
        <GenreManagerData />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default GenrePage;
