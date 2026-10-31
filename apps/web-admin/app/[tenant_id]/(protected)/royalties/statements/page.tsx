import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
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
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listRoyaltyStatements } from "#lib/royalties";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { StatementList } from "./_components/statement-list";

type RoyaltyStatementsPageProps =
  PageProps<"/[tenant_id]/royalties/statements">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.royalties.statements.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const StatementListContent = async ({
  searchParams,
}: Pick<RoyaltyStatementsPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);

  const [result, timeZone] = await Promise.all([
    listRoyaltyStatements(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    getTenantDisplayTimeZone(tenantId),
  ]);

  await redirectToLoginIfSessionRejected(result);

  return result.ok ? (
    <StatementList
      {...cursorPageHrefs(result)}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      statements={result.statements}
      timeZone={timeZone}
    />
  ) : (
    <StatementList
      listErrorMessage={result.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
      statements={[]}
      timeZone={timeZone}
    />
  );
};

const RoyaltyStatementsPage = ({
  searchParams,
}: RoyaltyStatementsPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
                <Message message="admin.royalties.statements.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.royalties.statements.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton render={<Link href="/royalties" />} variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.royalties.open_month_link" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.royalties.statements.section_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<Table.Skeleton />}>
              <StatementListContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default RoyaltyStatementsPage;
