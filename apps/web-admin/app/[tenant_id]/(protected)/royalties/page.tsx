import type { Locale } from "@publira/i18n";
import * as ConsolePage from "@publira/layouts/admin/console-page";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { LinkButton } from "@publira/ui-components/button";
import * as SectionError from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import {
  getRoyaltyClosePolicy,
  listRoyaltyStatements,
  previewRoyaltyStatement,
} from "#lib/royalties";
import type { PreviewRoyaltyStatementResult } from "#lib/royalties";
import {
  currentRoyaltyPeriod,
  defaultOpenRoyaltyPeriod,
  royaltyCloseState,
} from "#lib/royalty-period";
import type { RoyaltyClosePolicy } from "#lib/royalty-period";
import { getTenantId } from "#lib/tenant-id";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import { OpenMonth } from "./_components/open-month";
import { PeriodPicker } from "./_components/period-picker";
import { parseOpenMonthSearchParams } from "./_lib/search-params";

type RoyaltiesPageProps = PageProps<"/[tenant_id]/royalties">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const [locale, isAdmin] = await Promise.all([
    getLocale(tenantId),
    isSignedInTenantAdmin(tenantId),
  ]);

  const t = await getMessagesFor(locale);

  return {
    title: isAdmin ? t("admin.royalties.title") : t("admin.not_found.title"),
  };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const OpenMonthSkeleton = () => (
  <ConsoleSection.Stack>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-24" />
    </ConsoleSection.Root>
    <ConsoleSection.Root>
      <SkeletonLine className="h-5 w-32" />
      <Table.Skeleton />
    </ConsoleSection.Root>
  </ConsoleSection.Stack>
);

const LoadError = ({ message }: { message: string }) => (
  <SectionError.Root>
    <SectionError.Heading>
      <SectionError.Title>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="admin.royalties.open.section_error" />
        </Suspense>
      </SectionError.Title>
      <SectionError.Description>{message}</SectionError.Description>
    </SectionError.Heading>
  </SectionError.Root>
);

/**
 * The preview of `period`, or why there is none: a month that is already closed
 * or not started yet points at the closed statements instead.
 */
const PreviewContent = ({
  locale,
  period,
  policy,
  preview,
  tenantId,
  timeZone,
}: {
  locale: Locale;
  period: string;
  policy: RoyaltyClosePolicy;
  preview: PreviewRoyaltyStatementResult;
  tenantId: string;
  timeZone: string;
}) => {
  if (preview.ok) {
    const zone = preview.timeZone || timeZone;

    return (
      <OpenMonth
        closeState={royaltyCloseState(period, policy, zone)}
        currency={preview.currency}
        endsAt={preview.endsAt}
        lines={preview.lines}
        locale={locale}
        period={period}
        startsAt={preview.startsAt}
        tenantId={tenantId}
        timeZone={zone}
        totals={preview.totals}
      />
    );
  }

  if (!preview.notOpen) {
    return <LoadError message={preview.message} />;
  }

  return (
    <SectionError.Root>
      <SectionError.Heading>
        <SectionError.Title>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.royalties.open.not_open_title" />
          </Suspense>
        </SectionError.Title>
        <SectionError.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.royalties.open.not_open_description" />
          </Suspense>
        </SectionError.Description>
      </SectionError.Heading>
      <SectionError.Actions>
        <LinkButton
          render={<Link href="/royalties/statements" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.royalties.statements_link" />
          </Suspense>
        </LinkButton>
      </SectionError.Actions>
    </SectionError.Root>
  );
};

const OpenMonthContent = async ({
  searchParams,
}: Pick<RoyaltiesPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const requested = parseOpenMonthSearchParams(sp).period;
  const locale = await getLocale(tenantId);

  const [timeZone, policyResult, latestResult] = await Promise.all([
    getTenantDisplayTimeZone(tenantId),
    getRoyaltyClosePolicy(tenantId, locale),
    listRoyaltyStatements(tenantId, locale, { limit: 1 }),
  ]);

  await redirectToLoginIfSessionRejected(policyResult);
  await redirectToLoginIfSessionRejected(latestResult);

  if (!policyResult.ok) {
    return <LoadError message={policyResult.message} />;
  }

  if (!latestResult.ok) {
    return <LoadError message={latestResult.message} />;
  }

  const currentPeriod = currentRoyaltyPeriod(timeZone);

  const period =
    requested !== "" && requested <= currentPeriod
      ? requested
      : defaultOpenRoyaltyPeriod(
          latestResult.statements[0]?.period,
          currentPeriod
        );

  const preview = await previewRoyaltyStatement(tenantId, locale, period);
  await redirectToLoginIfSessionRejected(preview);

  return (
    <ConsoleSection.Stack>
      <PeriodPicker maxPeriod={currentPeriod} period={period} />
      <PreviewContent
        locale={locale}
        period={period}
        policy={policyResult.policy}
        preview={preview}
        tenantId={tenantId}
        timeZone={timeZone}
      />
    </ConsoleSection.Stack>
  );
};

const RoyaltiesPage = ({ searchParams }: RoyaltiesPageProps) => (
  <ConsolePage.Root>
    <Suspense fallback={<TenantRoleRouteSkeleton />}>
      <TenantAdminRoute>
        <ConsolePage.Header>
          <ConsolePage.Heading>
            <ConsolePage.Title>
              <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
                <Message message="admin.royalties.title" />
              </Suspense>
            </ConsolePage.Title>
            <ConsolePage.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
                <Message message="admin.royalties.page_description" />
              </Suspense>
            </ConsolePage.Description>
          </ConsolePage.Heading>
          <ConsolePage.Actions>
            <LinkButton
              render={<Link href="/royalties/statements" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.royalties.statements_link" />
              </Suspense>
            </LinkButton>
            <LinkButton
              render={<Link href="/royalties/settings" />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.royalties.close_settings_link" />
              </Suspense>
            </LinkButton>
          </ConsolePage.Actions>
        </ConsolePage.Header>
        <ConsolePage.Content>
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.royalties.open.section_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<OpenMonthSkeleton />}>
              <OpenMonthContent searchParams={searchParams} />
            </Suspense>
          </SectionErrorBoundary>
        </ConsolePage.Content>
      </TenantAdminRoute>
    </Suspense>
  </ConsolePage.Root>
);

export default RoyaltiesPage;
