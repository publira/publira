import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import { TenantEditorOnly } from "#components/tenant-role-gate";
import { isSignedInTenantEditor } from "#lib/auth-session";
import { listCreators } from "#lib/creator";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

import { CreatorManager } from "./_components/creator-manager";

type CreatorPageProps = PageProps<"/[tenant_id]/creators">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.creators.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const CreatorManagerData = async ({
  searchParams,
}: Pick<CreatorPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const [locale, listResult, canEdit] = await Promise.all([
    getLocale(tenantId),
    listCreators({ token }),
    isSignedInTenantEditor(tenantId),
  ]);

  return (
    <CreatorManager
      canEdit={canEdit}
      {...cursorPageHrefs(listResult)}
      creators={listResult.creators}
      listErrorMessage={listResult.ok ? undefined : listResult.message}
      locale={locale}
      pageSize={DEFAULT_PAGE_SIZE}
    />
  );
};

const CreatorPage = ({ searchParams }: CreatorPageProps) => (
  <ConsolePage.Root>
    <ConsolePage.Header>
      <ConsolePage.Heading>
        <ConsolePage.Title>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.creators.title" />
          </Suspense>
        </ConsolePage.Title>
        <ConsolePage.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="admin.creators.page_description" />
          </Suspense>
        </ConsolePage.Description>
      </ConsolePage.Heading>
      <Suspense fallback={null}>
        <TenantEditorOnly>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/creators/new" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <Message message="admin.creators.new_action" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </TenantEditorOnly>
      </Suspense>
    </ConsolePage.Header>
    <ConsolePage.Content>
      <Suspense fallback={<Table.Skeleton />}>
        <CreatorManagerData searchParams={searchParams} />
      </Suspense>
    </ConsolePage.Content>
  </ConsolePage.Root>
);

export default CreatorPage;
