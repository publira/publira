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
import { FlashToast } from "#components/flash-toast";
import { listAccessTickets } from "#lib/access-ticket";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { TicketFilterForm } from "./_components/ticket-filter-form";
import { TicketManager } from "./_components/ticket-manager";
import { parseAccessTicketFilters } from "./_lib/search-params";

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

const accessTicketFilterQuery = (
  filters: ReturnType<typeof parseAccessTicketFilters>,
  token?: string
) =>
  buildQueryString({
    active: filters.active ? "1" : undefined,
    episode: filters.episode,
    token,
    user: filters.user,
  });

const TicketManagerData = async ({
  searchParams,
}: Pick<AccessTicketsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseAccessTicketFilters(sp);
  const [listResult, timeZone] = await Promise.all([
    listAccessTickets(tenantId, {
      activeOnly: filters.active,
      episodePublicId: filters.episode,
      token: filters.token,
      userPublicId: filters.user,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <div className="grid gap-6">
      <TicketFilterForm filters={filters} />
      <TicketManager
        listErrorMessage={listResult.ok ? undefined : listResult.message}
        nextHref={
          listResult.nextToken
            ? accessTicketFilterQuery(filters, listResult.nextToken)
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          listResult.previousToken
            ? accessTicketFilterQuery(filters, listResult.previousToken)
            : undefined
        }
        tickets={listResult.tickets}
        timeZone={timeZone}
      />
    </div>
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
      <FlashToast title="チケットを発行しました。" />
      <Suspense fallback={<TicketManagerSkeleton />}>
        <TicketManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default AccessTicketsPage;
