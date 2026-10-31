import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
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

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.contact_messages.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const ContactMessagesSkeleton = () => (
  <ConsoleSection.Stack>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Skeleton className="h-16" />
    </div>
    <Table.Skeleton />
  </ConsoleSection.Stack>
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
    <ConsoleSection.Stack>
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
    </ConsoleSection.Stack>
  );
};

const ContactMessagesPage = ({ searchParams }: ContactMessagesPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.contact_messages.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.contact_messages.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
        </ConsolePage.Header>
        <ConsolePage.Content>
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
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default ContactMessagesPage;
