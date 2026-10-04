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
import { TenantEditorOnly } from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listLabels } from "#lib/label";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { LabelManager } from "./_components/label-manager";

type LabelPageProps = PageProps<"/[tenant_id]/labels">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.labels.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const LabelManagerData = async ({
  searchParams,
}: Pick<LabelPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const [locale, listResult, canEdit] = await Promise.all([
    getLocale(tenantId),
    listLabels({ token }),
    isSignedInTenantEditor(tenantId),
  ]);

  return (
    <LabelManager
      canEdit={canEdit}
      {...cursorPageHrefs(listResult)}
      labels={listResult.labels}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const LabelPage = ({ searchParams }: LabelPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.labels.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.labels.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <Suspense fallback={null}>
        <TenantEditorOnly>
          <AdminPageActions>
            <LinkButton render={<Link href="/labels/new" />} variant="outline">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.labels.new_action" />
              </Suspense>
            </LinkButton>
          </AdminPageActions>
        </TenantEditorOnly>
      </Suspense>
    </AdminPageHeader>
    <AdminPageContent>
      <Suspense fallback={<TableSkeleton />}>
        <LabelManagerData searchParams={searchParams} />
      </Suspense>
    </AdminPageContent>
  </AdminPage>
);

export default LabelPage;
