import * as ConsolePage from "@publira/layouts/admin/console-page";
import { Button, LinkButton } from "@publira/ui-components/button";
import * as Drawer from "@publira/ui-components/drawer";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FlashToast } from "#components/flash-toast";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { UrlDrawer } from "#components/url-drawer";
import {
  isSignedInTenantAdmin,
  redirectToLoginIfSessionRejected,
} from "#lib/auth-session";
import { DEFAULT_PAGE_SIZE } from "#lib/cursor-page";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listPromotionCodes } from "#lib/promotion-code";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PromotionCodeDetail } from "./_components/promotion-code-detail";
import { PromotionCodeList } from "./_components/promotion-code-list";
import {
  parsePromotionCodeParams,
  promotionCodeListQuery,
} from "./_lib/search-params";

type PromotionCodesPageProps = PageProps<"/[tenant_id]/promotion-codes">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.promotion_codes.title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const PromotionCodeDetailSkeleton = () => (
  <div className="grid gap-3">
    <SkeletonLine className="h-6 w-32" />
    <Skeleton className="h-64 w-full" />
  </div>
);

const PromotionCodesContent = async ({
  searchParams,
}: Pick<PromotionCodesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const params = parsePromotionCodeParams(sp);

  const [locale, timeZone] = await Promise.all([
    getLocale(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  const now = Temporal.Now.instant();

  const result = await listPromotionCodes(tenantId, locale, {
    token: params.token,
  });

  await redirectToLoginIfSessionRejected(result);

  return (
    <div className="grid gap-6">
      <PromotionCodeList
        codes={result.codes}
        detailHref={(codeId) =>
          promotionCodeListQuery({ code: codeId, token: params.token })
        }
        listErrorMessage={result.ok ? undefined : result.message}
        locale={locale}
        nextHref={
          result.nextToken
            ? promotionCodeListQuery({ token: result.nextToken })
            : undefined
        }
        now={now}
        pageSize={DEFAULT_PAGE_SIZE}
        previousHref={
          result.previousToken
            ? promotionCodeListQuery({ token: result.previousToken })
            : undefined
        }
        timeZone={timeZone}
      />
      {params.code ? (
        <UrlDrawer
          closeHref={promotionCodeListQuery({ token: params.token })}
          key={params.code}
        >
          <Drawer.Header>
            <Drawer.Title className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
                {params.edit ? (
                  <Message message="admin.promotion_codes.edit_title" />
                ) : (
                  <Message message="admin.promotion_codes.detail_title" />
                )}
              </Suspense>
            </Drawer.Title>
            <Drawer.Close
              render={<Button size="sm" type="button" variant="outline" />}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.promotion_codes.close" />
              </Suspense>
            </Drawer.Close>
          </Drawer.Header>
          <Suspense fallback={<PromotionCodeDetailSkeleton />}>
            <PromotionCodeDetail
              locale={locale}
              now={now}
              params={params}
              tenantId={tenantId}
              timeZone={timeZone}
            />
          </Suspense>
        </UrlDrawer>
      ) : null}
    </div>
  );
};

const PromotionCodesPage = ({ searchParams }: PromotionCodesPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
                <Message message="admin.promotion_codes.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.promotion_codes.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton render={<Link href="/promotion-codes/new" />}>
              <Suspense fallback={<SkeletonLine className="h-5 w-36" />}>
                <Message message="admin.promotion_codes.new_action" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.promotion_codes.list_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<Table.Skeleton />}>
              <PromotionCodesContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
        <FlashToast message="admin.promotion_codes.created" />
        <FlashToast keyName="saved" message="admin.promotion_codes.saved" />
        <FlashToast keyName="deleted" message="admin.promotion_codes.deleted" />
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default PromotionCodesPage;
