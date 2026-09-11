import { getMessage } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageActions,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { listAccessTickets } from "#lib/access-ticket";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { TicketFilterForm } from "./_components/ticket-filter-form";
import { TicketManager } from "./_components/ticket-manager";
import { parseAccessTicketFilters } from "./_lib/search-params";

type AccessTicketsPageProps = PageProps<"/[tenant_id]/access-tickets">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.access_tickets.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

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
  const locale = await getLocale(tenantId);
  const [listResult, timeZone] = await Promise.all([
    listAccessTickets(tenantId, locale, {
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
      <TicketFilterForm filters={filters} locale={locale} />
      <TicketManager
        listErrorMessage={listResult.ok ? undefined : listResult.message}
        locale={locale}
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
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.access_tickets.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.access_tickets.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton
          render={<Link href="/access-tickets/new" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.access_tickets.new_action" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <FlashToast message="admin.access_tickets.issued" />
      <Suspense fallback={<TableSkeleton />}>
        <TicketManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default AccessTicketsPage;
