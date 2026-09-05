import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
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
  AdminPageEyebrow,
  AdminPageHeader,
  AdminPageHeading,
  AdminPageTitle,
} from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import {
  cursorPageHrefs,
  DEFAULT_PAGE_SIZE,
  hasCursorPageLinks,
  parseCursorSearchParams,
} from "#lib/cursor-page";
import { listEpisodeReadThrough, readThroughRate } from "#lib/engagement";
import { getLocale, loadAdminMessages } from "#lib/locale";
import type { AdminMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

type EngagementPageProps = PageProps<"/[tenant_id]/engagement">;

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const locale = await getLocale(tenantId);
  const messages = await loadAdminMessages(locale);

  return { title: getMessage(messages, "admin.engagement.title") };
};

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

/**
 * The rate as the console words it. `null` is not zero: no member opened the
 * episode in the period, so there is nothing a completion could be a share of.
 */
const formatReadThroughRate = (
  rate: number | null,
  locale: Locale,
  messages: AdminMessages
): string =>
  rate === null
    ? getMessage(messages, "admin.engagement.rate_unavailable")
    : formatPercent(rate, { locale });

const EngagementSkeleton = () => (
  <div className="grid gap-6">
    <Card>
      <CardHeader>
        <div className="h-5 w-40 animate-pulse rounded bg-muted" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted/70" />
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div className="h-20 animate-pulse rounded bg-muted/70" />
        <div className="h-20 animate-pulse rounded bg-muted/70" />
        <div className="h-20 animate-pulse rounded bg-muted/70" />
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <div className="h-5 w-36 animate-pulse rounded bg-muted" />
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  </div>
);

const EngagementContent = async ({
  searchParams,
}: Pick<EngagementPageProps, "searchParams">) => {
  const [sp, tenantId] = await Promise.all([searchParams, getTenantId()]);
  const { token } = parseCursorSearchParams(sp);
  const locale = await getLocale(tenantId);
  const [result, messages] = await Promise.all([
    listEpisodeReadThrough(tenantId, locale, {
      limit: DEFAULT_PAGE_SIZE,
      token,
    }),
    loadAdminMessages(locale),
  ]);

  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={getMessage(messages, "admin.engagement.section_error")}
      />
    );
  }

  const pageHrefs = cursorPageHrefs(result);
  const hasPageLinks = hasCursorPageLinks(pageHrefs);
  const totalRate = readThroughRate(
    result.totalCompleteCount,
    result.totalMemberViewCount
  );

  const summaryItems = [
    {
      label: "admin.engagement.complete_count_label",
      value: String(result.totalCompleteCount),
    },
    {
      label: "admin.engagement.member_view_count_label",
      value: String(result.totalMemberViewCount),
    },
    {
      label: "admin.engagement.rate_label",
      value: formatReadThroughRate(totalRate, locale, messages),
    },
  ] as const;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.engagement.summary_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.engagement.period", {
              end: formatPlainDate(result.period.end, { locale }),
              start: formatPlainDate(result.period.start, { locale }),
              time_zone: result.period.timeZone,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-3">
            {summaryItems.map((item) => (
              <div
                className="rounded-xl border border-border/70 p-4"
                key={item.label}
              >
                <p className="text-sm text-muted-foreground">
                  {getMessage(messages, item.label)}
                </p>
                <p className="mt-1 text-3xl font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {getMessage(messages, "admin.engagement.definition")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {getMessage(messages, "admin.engagement.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.engagement.list_description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {result.episodes.length === 0 ? (
            <CursorPageEmptyState
              description={
                <Message message="admin.engagement.empty_description" />
              }
              hasPageLinks={hasPageLinks}
              itemLabel={getMessage(messages, "admin.engagement.title")}
              title={getMessage(messages, "admin.engagement.empty_title")}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {getMessage(messages, "admin.engagement.columns.series")}
                  </TableHead>
                  <TableHead>
                    {getMessage(messages, "admin.engagement.columns.episode")}
                  </TableHead>
                  <TableHead className="w-32">
                    {getMessage(
                      messages,
                      "admin.engagement.columns.complete_count"
                    )}
                  </TableHead>
                  <TableHead className="w-32">
                    {getMessage(
                      messages,
                      "admin.engagement.columns.member_view_count"
                    )}
                  </TableHead>
                  <TableHead className="w-32">
                    {getMessage(messages, "admin.engagement.columns.rate")}
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
                      {formatReadThroughRate(
                        readThroughRate(
                          item.completeCount,
                          item.memberViewCount
                        ),
                        locale,
                        messages
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {result.episodes.length > 0 || hasPageLinks ? (
            <PaginationFooter
              {...pageHrefs}
              ariaLabel={getMessage(
                messages,
                "admin.engagement.pagination_aria"
              )}
              description={getMessage(
                messages,
                "admin.engagement.pagination_description",
                { count: DEFAULT_PAGE_SIZE }
              )}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
};

const EngagementPage = ({ searchParams }: EngagementPageProps) => (
  <AdminPage>
    <AdminPageHeader>
      <AdminPageHeading>
        <AdminPageEyebrow>Console</AdminPageEyebrow>
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
