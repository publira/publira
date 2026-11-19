import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CreatorCreditItem } from "#lib/creator";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import { CREATOR_CREDITS_TITLE_ID } from "../_lib/creator-credits-anchor";

type CreatorCreditsProps = CursorPageHrefs & {
  credits: CreatorCreditItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
};

/**
 * A page link that lands on this section rather than at the top of the
 * Author's screen, which holds the form above it.
 */
const toSectionHref = (href: string | undefined) =>
  href ? `${href}#${CREATOR_CREDITS_TITLE_ID}` : undefined;

const creditHref = ({ episode, series }: CreatorCreditItem) =>
  episode
    ? `/series/${series.publicId}/episodes/${episode.publicId}`
    : `/series/${series.publicId}`;

const creditKey = ({ episode, roleId, series }: CreatorCreditItem) =>
  `${series.id}:${episode?.id ?? ""}:${roleId}`;

const Untitled = () => (
  <span className="text-muted-foreground">
    <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
      <Message message="admin.creators.credits.untitled" />
    </Suspense>
  </span>
);

/**
 * The series and episode credits naming one Author, in the API's order —
 * grouped by series, the series' own credit before its episodes' — each with a
 * link to the screen where that credit is changed.
 */
export const CreatorCredits = async ({
  credits,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
}: CreatorCreditsProps) => {
  // A failed read still hands an empty `credits` array; the empty state next
  // to the error would read as "nothing credits this Author", which is what
  // decides whether they can be deleted.
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.creators.credits.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  return (
    <div className="grid gap-6">
      {credits.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.creators.credits.title")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              {t("admin.creators.credits.empty_title")}
            </EmptyState.Title>
            <EmptyState.Description>
              {t("admin.creators.credits.empty_description")}
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.creators.credits.columns.series" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.creators.credits.columns.episode" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.creators.credits.columns.role" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-40">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.creators.credits.columns.actions" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {credits.map((credit) => (
              <Table.Row key={creditKey(credit)}>
                <Table.Cell className="font-medium">
                  {credit.series.title || <Untitled />}
                </Table.Cell>
                <Table.Cell>
                  {credit.episode ? (
                    credit.episode.title || <Untitled />
                  ) : (
                    <span className="text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-24" />}
                      >
                        <Message message="admin.creators.credits.on_series" />
                      </Suspense>
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  {credit.roleName || (
                    <span className="text-muted-foreground">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <Message message="admin.creators.credits.no_role" />
                      </Suspense>
                    </span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <LinkButton
                    render={<Link href={creditHref(credit)} />}
                    size="sm"
                    variant="outline"
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                      {credit.episode ? (
                        <Message message="admin.creators.credits.open_episode" />
                      ) : (
                        <Message message="admin.creators.credits.open_series" />
                      )}
                    </Suspense>
                  </LinkButton>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {credits.length > 0 || hasPageLinks ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.creators.credits.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.creators.credits.pagination_aria")}
            nextHref={toSectionHref(nextHref)}
            previousHref={toSectionHref(previousHref)}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
