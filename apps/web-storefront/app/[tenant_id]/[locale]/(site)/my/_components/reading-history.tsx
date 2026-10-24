import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { AgeRatedVisibility } from "#components/age-rated-visibility";
import { EyeCatchThumbnail } from "#components/eye-catch-thumbnail";
import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { listMyEpisodeReads } from "#lib/reading-history";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  defaultReadingHistoryPageSize,
  myPageHref,
  resolveMyPageToken,
} from "../_lib/search-params";
import type { MyPageSearchParams } from "../_lib/search-params";

/**
 * The heading names the section, which is what turns the `<section>` into a
 * landmark a reader can jump to and a test can scope to. `/my` renders this
 * section once, so the id is a constant rather than a generated one.
 */
const HISTORY_HEADING_ID = "reading-history-heading";

/**
 * The episodes this reader has finished, most recent first.
 *
 * It is the only place a reader is told what they have read: `/my/library`
 * lists purchases, and a free episode is never one. The page it sits on is
 * already behind a session, so a rejected session sends the reader back to sign
 * in rather than showing them the empty state of someone who has read nothing.
 */
export const ReadingHistorySection = async ({
  searchParams,
}: {
  searchParams: MyPageSearchParams;
}) => {
  const [tenantId, locale, token] = await Promise.all([
    getTenantId(),
    getLocale(),
    resolveMyPageToken(searchParams),
  ]);
  const [result, t, timeZone] = await Promise.all([
    listMyEpisodeReads(tenantId, {
      limit: defaultReadingHistoryPageSize,
      locale,
      token,
    }),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, myPageHref(token), tenantId);
  }

  return (
    <section
      aria-labelledby={HISTORY_HEADING_ID}
      className="border border-border bg-card p-6"
    >
      <h2 className="mb-4 text-lg font-semibold" id={HISTORY_HEADING_ID}>
        {t("storefront.my.history_heading")}
      </h2>
      {result.ok ? null : (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.my.history_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {result.message}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      )}
      {result.ok && result.reads.length === 0 ? (
        <EmptyState.Root>
          <EmptyState.Heading>
            <EmptyState.Title>
              {t("storefront.my.history_empty_title")}
            </EmptyState.Title>
            <EmptyState.Description>
              {t("storefront.my.history_empty_description")}
            </EmptyState.Description>
          </EmptyState.Heading>
        </EmptyState.Root>
      ) : null}
      {result.ok && result.reads.length > 0 ? (
        <div className="grid gap-6">
          <ol className="grid gap-3">
            {result.reads.map((read) => (
              <AgeRatedVisibility
                key={read.episode.publicId}
                rating={read.series.ageRating}
              >
                <li className="flex items-center gap-4 rounded-xl border border-border/70 bg-background p-4">
                  <EyeCatchThumbnail
                    // The series title is right beside it in the row, so the
                    // artwork adds nothing a reader has not already been given.
                    alt=""
                    variants={read.eyeCatchImageVariants}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">
                      {read.series.title}
                    </p>
                    <h3 className="mt-1 font-medium">
                      <LocaleLink
                        className="hover:underline"
                        href={`/series/${read.series.publicId}/episodes/${read.episode.publicId}`}
                      >
                        #{read.episode.orderIndex} {read.episode.title}
                      </LocaleLink>
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("storefront.my.history_finished_at")}{" "}
                      <span className="text-foreground">
                        {formatDateTime(read.readAt, {
                          fallback: "-",
                          locale,
                          timeZone,
                        })}
                      </span>
                    </p>
                  </div>
                </li>
              </AgeRatedVisibility>
            ))}
          </ol>
          <ListPagination.Root
            aria-label={t("storefront.my.history_pagination_aria")}
          >
            <ListPagination.Step
              href={
                result.previousToken ? myPageHref(result.previousToken) : ""
              }
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="storefront.common.previous_page" />
              </Suspense>
            </ListPagination.Step>
            <ListPagination.Step
              href={result.nextToken ? myPageHref(result.nextToken) : ""}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="storefront.common.next_page" />
              </Suspense>
            </ListPagination.Step>
          </ListPagination.Root>
        </div>
      ) : null}
    </section>
  );
};
