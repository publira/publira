import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { listCreators } from "#lib/creator";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getTenantId } from "#lib/tenant-id";

import { CreatorManager } from "./_components/creator-manager";

type CreatorPageProps = PageProps<"/[tenant_id]/creators">;

export const metadata: Metadata = {
  title: "著者",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CreatorManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const CreatorManagerData = async ({
  searchParams,
}: Pick<CreatorPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const listResult = await listCreators(tenantId, { token });

  return (
    <CreatorManager
      {...cursorPageHrefs(listResult)}
      creators={listResult.creators}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const CreatorPage = ({ searchParams }: CreatorPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>著者</AdminPageTitle>
        <AdminPageDescription>
          著者一覧の確認と、編集への遷移を行います。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<CreatorManagerSkeleton />}>
        <CreatorManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default CreatorPage;
