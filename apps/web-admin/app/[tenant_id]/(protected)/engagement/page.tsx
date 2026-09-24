import type { Locale } from "@publira/i18n";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  Figure,
  FigureLabel,
  FigureLine,
  FigureValue,
} from "@publira/ui-components/figure-line";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLoadingRow,
  TableRow,
} from "@publira/ui-components/table";
import { formatPercent, formatPlainDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  AdminPage,
  AdminPageContent,
  AdminPageDescription,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSections,
  AdminSectionTitle,
} from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listEpisodeReadThrough, readThroughRate } from "#lib/engagement";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantId } from "#lib/tenant-id";

type EngagementPageProps = PageProps<"/[tenant_id]/engagement">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const t = await getMessagesFor(locale);

  return { title: t("admin.engagement.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * The rate as the console words it. `null` is not zero: no member opened the
 * episode in the period, so there is nothing a completion could be a share of.
 */
const formatReadThroughRate = async (
  rate: number | null,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  return rate === null
    ? t("admin.engagement.rate_unavailable")
    : formatPercent(rate, { locale });
};

/**
 * One episode's read-through rate, as its own async component: the "no reader
 * opened it" wording comes from the catalog, and a row rendered inside `.map()`
 * cannot await.
 */
const ReadThroughRateCell = async ({
  completeCount,
  locale,
  memberViewCount,
}: {
  completeCount: number;
  locale: Locale;
  memberViewCount: number;
}) =>
  await formatReadThroughRate(
    readThroughRate(completeCount, memberViewCount),
    locale
  );

const EngagementSkeleton = () => (
  <AdminSections>
    <FigureLine>
      {(["skeleton-1", "skeleton-2", "skeleton-3"] as const).map((key) => (
        <Figure key={key}>
          <FigureLabel>
            <SkeletonLine className="h-4 w-28" />
          </FigureLabel>
          <FigureValue>
            <SkeletonLine className="h-6 w-12" />
          </FigureValue>
        </Figure>
      ))}
    </FigureLine>

    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <SkeletonLine className="h-4 w-24" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-32" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-16" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-16" />
          </TableHead>
          <TableHead>
            <SkeletonLine className="h-4 w-20" />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableLoadingRow colSpan={5} rows={6} />
      </TableBody>
    </Table>
  </AdminSections>
);

const EngagementContent = async ({
  searchParams,
}: Pick<EngagementPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [result, t] = await Promise.all([
    listEpisodeReadThrough(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    getMessagesFor(locale),
  ]);

  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.engagement.section_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);
  const totalRate = readThroughRate(
    result.totalCompleteCount,
    result.totalMemberViewCount
  );

  return (
    <AdminSections>
      <AdminSection>
        <p className="max-w-3xl text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message
              message="admin.engagement.period"
              values={{
                end: formatPlainDate(result.period.end, { locale }),
                start: formatPlainDate(result.period.start, { locale }),
                time_zone: result.period.timeZone,
              }}
            />
          </Suspense>
        </p>
        <FigureLine>
          <Figure>
            <FigureLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.engagement.complete_count_label" />
              </Suspense>
            </FigureLabel>
            <FigureValue>{result.totalCompleteCount}</FigureValue>
          </Figure>
          <Figure>
            <FigureLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.engagement.member_view_count_label" />
              </Suspense>
            </FigureLabel>
            <FigureValue>{result.totalMemberViewCount}</FigureValue>
          </Figure>
          <Figure>
            <FigureLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.engagement.rate_label" />
              </Suspense>
            </FigureLabel>
            <FigureValue>
              {await formatReadThroughRate(totalRate, locale)}
            </FigureValue>
          </Figure>
        </FigureLine>
        <p className="text-xs text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
            <Message message="admin.engagement.definition" />
          </Suspense>
        </p>
      </AdminSection>

      <AdminSection>
        <AdminSectionHeader>
          <AdminSectionHeading>
            <AdminSectionTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.engagement.list_title" />
              </Suspense>
            </AdminSectionTitle>
            <AdminSectionDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="admin.engagement.list_description" />
              </Suspense>
            </AdminSectionDescription>
          </AdminSectionHeading>
        </AdminSectionHeader>
        {result.episodes.length === 0 ? (
          <CursorPageEmptyState
            hasPageLinks={hasPageLinks}
            itemLabel={t("admin.engagement.title")}
          >
            <EmptyStateHeading>
              <EmptyStateTitle>
                {t("admin.engagement.empty_title")}
              </EmptyStateTitle>
              <EmptyStateDescription>
                <Message message="admin.engagement.empty_description" />
              </EmptyStateDescription>
            </EmptyStateHeading>
          </CursorPageEmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.engagement.columns.series" />
                  </Suspense>
                </TableHead>
                <TableHead>
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.engagement.columns.episode" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.engagement.columns.complete_count" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.engagement.columns.member_view_count" />
                  </Suspense>
                </TableHead>
                <TableHead className="w-32">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <Message message="admin.engagement.columns.rate" />
                  </Suspense>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.episodes.map((item) => (
                <TableRow
                  key={`${item.seriesPublicId}-${item.episodePublicId}`}
                >
                  <TableCell>{item.seriesTitle}</TableCell>
                  <TableCell className="font-medium">
                    {item.episodeTitle}
                  </TableCell>
                  <TableCell>{item.completeCount}</TableCell>
                  <TableCell>{item.memberViewCount}</TableCell>
                  <TableCell>
                    <ReadThroughRateCell
                      completeCount={item.completeCount}
                      locale={locale}
                      memberViewCount={item.memberViewCount}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {result.episodes.length > 0 || hasPageLinks ? (
          <PaginationFooter>
            <PaginationFooterDescription>
              {t("admin.engagement.pagination_description", {
                count: DEFAULT_PAGE_SIZE,
              })}
            </PaginationFooterDescription>
            <PaginationControls
              {...pageHrefs}
              aria-label={t("admin.engagement.pagination_aria")}
            />
          </PaginationFooter>
        ) : null}
      </AdminSection>
    </AdminSections>
  );
};

const EngagementPage = ({ searchParams }: EngagementPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageTitle>
          <Suspense fallback={<SkeletonLine className="h-7 w-40" />}>
            <Message message="admin.engagement.title" />
          </Suspense>
        </AdminPageTitle>
        <AdminPageDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
            <Message message="admin.engagement.page_description" />
          </Suspense>
        </AdminPageDescription>
      </AdminPageHeading>
    </AdminPageHeader>
    <AdminPageContent>
      <SectionErrorBoundary
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.engagement.section_error" />
          </Suspense>
        }
      >
        <Suspense fallback={<EngagementSkeleton />}>
          <EngagementContent searchParams={searchParams} />
        </Suspense>
      </SectionErrorBoundary>
    </AdminPageContent>
  </AdminPage>
);

export default EngagementPage;
