import * as ConsolePage from "@publira/layouts/admin/console-page";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  TenantAdminRoute,
  TenantRoleRouteSkeleton,
} from "#components/tenant-role-gate";
import { isSignedInTenantAdmin } from "#lib/auth-session";
import { listAllLabels } from "#lib/label";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantCurrency } from "#lib/public-api";
import { listAllSeries } from "#lib/series";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { PromotionCodeForm } from "../_components/promotion-code-form";
import { createPromotionCodeAction } from "../_lib/actions";

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin
      ? t("admin.promotion_codes.new_title")
      : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const NewPromotionCodeFormSkeleton = () => (
  <div className="grid gap-4">
    <Skeleton className="h-20" />
    <Skeleton className="h-28" />
    <Skeleton className="h-36" />
    <Skeleton className="h-20" />
    <Skeleton className="ml-auto h-10 w-40" />
  </div>
);

/**
 * The form with every label and series of the tenant to choose from. A list
 * that cannot be read empties its picker and says why beside it. Without the
 * tenant's currency no amount can be entered, so the form is not offered.
 */
const NewPromotionCodeFormData = async () => {
  const tenantId = await getTenantId();

  const [currency, timeZone, labelsResult, seriesResult] = await Promise.all([
    getTenantCurrency(tenantId),
    getTenantDisplayTimeZone(tenantId),
    listAllLabels(),
    listAllSeries(),
  ]);

  if (!currency) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.promotion_codes.currency_unavailable" />
            </Suspense>
          </SectionError.Title>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  return (
    <PromotionCodeForm
      action={createPromotionCodeAction}
      currency={currency}
      labels={labelsResult.labels.map((label) => ({
        id: label.id,
        label: label.name,
      }))}
      labelsErrorMessage={labelsResult.ok ? undefined : labelsResult.message}
      series={seriesResult.series.map((item) => ({
        id: item.id,
        label: item.title || item.publicId,
      }))}
      seriesErrorMessage={seriesResult.ok ? undefined : seriesResult.message}
      tenantId={tenantId}
      timeZone={timeZone}
    />
  );
};

const NewPromotionCodePage = () => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-48" />}>
                <Message message="admin.promotion_codes.new_title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.promotion_codes.new_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/promotion-codes" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
                <Message message="admin.promotion_codes.back_to_list" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <Suspense fallback={<NewPromotionCodeFormSkeleton />}>
            <NewPromotionCodeFormData />
          </Suspense>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default NewPromotionCodePage;
