import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
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
import { Message } from "#components/message";
import { getAdminMetadata } from "#lib/admin-metadata";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listLabels } from "#lib/label";
import { getTenantId } from "#lib/tenant-id";

import { LabelManager } from "./_components/label-manager";

type LabelPageProps = PageProps<"/[tenant_id]/labels">;

export const generateMetadata = () => getAdminMetadata("admin.labels.title");

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const LabelManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const LabelManagerData = async ({
  searchParams,
}: Pick<LabelPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const listResult = await listLabels(tenantId, { token });

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <LabelManager
      {...cursorPageHrefs(listResult)}
      labels={listResult.labels}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const LabelPage = ({ searchParams }: LabelPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>
          <Message message="admin.labels.title" />
        </AdminPageTitle>
        <AdminPageDescription>
          <Message message="admin.labels.page_description" />
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<LabelManagerSkeleton />}>
        <LabelManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default LabelPage;
