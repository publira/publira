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
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.royalties.statements.title") };
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
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.royalties.statements.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.royalties.statements.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/royalties" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.royalties.open_month_link" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.royalties.statements.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<TableSkeleton />}>
          <StatementListContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default RoyaltyStatementsPage;
