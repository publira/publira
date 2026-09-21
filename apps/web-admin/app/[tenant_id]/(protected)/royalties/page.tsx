import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorActions,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
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
  AdminSection,
  AdminSections,
} from "#components/admin-page";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
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
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.royalties.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

const OpenMonthSkeleton = () => (
  <AdminSections>
    <AdminSection>
      <SkeletonLine className="h-5 w-48" />
      <Skeleton className="h-24" />
    </AdminSection>
    <AdminSection>
      <SkeletonLine className="h-5 w-32" />
      <TableSkeleton />
    </AdminSection>
  </AdminSections>
);

const LoadError = ({ message }: { message: string }) => (
  <SectionError>
    <SectionErrorHeading>
      <SectionErrorTitle>
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="admin.royalties.open.section_error" />
        </Suspense>
      </SectionErrorTitle>
      <SectionErrorDescription>{message}</SectionErrorDescription>
    </SectionErrorHeading>
  </SectionError>
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
  timeZone,
}: {
  locale: Locale;
  period: string;
  policy: RoyaltyClosePolicy;
  preview: PreviewRoyaltyStatementResult;
  timeZone: string;
}) => {
  if (preview.ok) {
    const zone = preview.timeZone || timeZone;
    return (
      <OpenMonth
        closeState={royaltyCloseState(period, policy, zone)}
        lines={preview.lines}
        locale={locale}
        period={period}
        timeZone={zone}
        totals={preview.totals}
      />
    );
  }
  if (!preview.notOpen) {
    return <LoadError message={preview.message} />;
  }

  return (
    <SectionError>
      <SectionErrorHeading>
        <SectionErrorTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.royalties.open.not_open_title" />
          </Suspense>
        </SectionErrorTitle>
        <SectionErrorDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.royalties.open.not_open_description" />
          </Suspense>
        </SectionErrorDescription>
      </SectionErrorHeading>
      <SectionErrorActions>
        <LinkButton
          render={<Link href="/royalties/statements" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.royalties.statements_link" />
          </Suspense>
        </LinkButton>
      </SectionErrorActions>
    </SectionError>
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
    <AdminSections>
      <PeriodPicker maxPeriod={currentPeriod} period={period} />
      <PreviewContent
        locale={locale}
        period={period}
        policy={policyResult.policy}
        preview={preview}
        timeZone={timeZone}
      />
    </AdminSections>
  );
};

const RoyaltiesPage = ({ searchParams }: RoyaltiesPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-32" />}>
            <Message message="admin.royalties.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.royalties.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
      <AdminPageActions>
        <LinkButton
          render={<Link href="/royalties/statements" />}
          variant="outline"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="admin.royalties.statements_link" />
          </Suspense>
        </LinkButton>
      </AdminPageActions>
    </AdminPageHeader>
    <AdminPageContent>
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
    </AdminPageContent>
  </AdminPage>
);

export default RoyaltiesPage;
