import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { TableSkeleton } from "@publira/ui-components/table";
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
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listContactMessages } from "#lib/contact-message";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { buildQueryString } from "#lib/query-string";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { ContactMessageFilterForm } from "./_components/contact-message-filter-form";
import { ContactMessageManager } from "./_components/contact-message-manager";
import { parseContactMessageFilters } from "./_lib/search-params";
import type { ContactMessageFilters } from "./_lib/search-params";

type ContactMessagesPageProps = PageProps<"/[tenant_id]/contact-messages">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.contact_messages.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const ContactMessagesSkeleton = () => (
  <AdminSections>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-16" />
    </div>
    <TableSkeleton />
  </AdminSections>
);

/**
 * Query-only href for one page of the inbox. A cursor names a row of the list
 * it was issued for, so the status travels with it.
 */
const contactMessagePageHref = (
  filters: ContactMessageFilters,
  token: string
) => buildQueryString({ status: filters.status, token });

const ContactMessagesContent = async ({
  searchParams,
}: Pick<ContactMessagesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const filters = parseContactMessageFilters(sp);
  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    listContactMessages(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      status: filters.status,
      token: filters.token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result);

  return (
    <AdminSections>
      <ContactMessageFilterForm filters={filters} locale={locale} />
      <ContactMessageManager
        filtered={Boolean(filters.status)}
        listErrorMessage={result.ok ? undefined : result.message}
        locale={locale}
        messages={result.messages}
        nextHref={
          result.nextToken
            ? contactMessagePageHref(filters, result.nextToken)
            : undefined
        }
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          result.previousToken
            ? contactMessagePageHref(filters, result.previousToken)
            : undefined
        }
        timeZone={timeZone}
      />
    </AdminSections>
  );
};

const ContactMessagesPage = ({ searchParams }: ContactMessagesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
            <Message message="admin.contact_messages.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.contact_messages.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.contact_messages.list_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<ContactMessagesSkeleton />}>
          <ContactMessagesContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default ContactMessagesPage;
