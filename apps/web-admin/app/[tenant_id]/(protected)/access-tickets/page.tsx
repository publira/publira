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
import { listAccessTickets } from "#lib/access-ticket";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getTenantId } from "#lib/tenant-id";

import { TicketManager } from "./_components/ticket-manager";

type AccessTicketsPageProps = PageProps<"/[tenant_id]/access-tickets">;

export const metadata: Metadata = {
  title: "アクセスチケット",
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const TicketManagerSkeleton = () => (
  <div className="rounded-2xl border border-border/70 bg-card p-6">
    <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
    <div className="grid gap-3">
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
      <div className="h-12 animate-pulse rounded bg-muted/70" />
    </div>
  </div>
);

const TicketManagerData = async ({
  searchParams,
}: Pick<AccessTicketsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const listResult = await listAccessTickets(tenantId, { token });

  return (
    <TicketManager
      {...cursorPageHrefs(listResult)}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      pageSize={DEFAULT_PAGE_SIZE}
      tickets={listResult.tickets}
    />
  );
};

const AccessTicketsPage = ({ searchParams }: AccessTicketsPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
        <AdminPageTitle>アクセスチケット</AdminPageTitle>
        <AdminPageDescription>
          決済を経由しない限定閲覧チケットの発行と失効を管理します。
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TicketManagerSkeleton />}>
        <TicketManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default AccessTicketsPage;
