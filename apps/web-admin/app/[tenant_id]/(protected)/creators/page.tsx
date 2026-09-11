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
import { Message } from "#components/message";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { listCreators } from "#lib/creator";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale, loadAdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import { CreatorManager } from "./_components/creator-manager";

type CreatorPageProps = PageProps<"/[tenant_id]/creators">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.creators.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CreatorManagerData = async ({
  searchParams,
}: Pick<CreatorPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const listResult = await listCreators(tenantId, locale, { token });

  await redirectToLoginIfSessionRejected(listResult);

  return (
    <CreatorManager
      {...cursorPageHrefs(listResult)}
      creators={listResult.creators}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const CreatorPage = ({ searchParams }: CreatorPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.creators.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.creators.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton render={<Link href="/creators/new" />} variant="outline">
          <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
            <Message message="admin.creators.new_action" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TableSkeleton />}>
        <CreatorManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default CreatorPage;
