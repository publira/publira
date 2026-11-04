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
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { PromotionCodeItem } from "#lib/promotion-code-shared";

import {
  PromotionCodeStatusChip,
  PromotionCodeTargetName,
  promotionCodeDiscountLabel,
  promotionCodeRedemptionsLabel,
  promotionCodeWindowLabel,
} from "./promotion-code-terms";

type PromotionCodeListProps = CursorPageHrefs & {
  codes: PromotionCodeItem[];
  /** The href that opens the drawer on a code, keeping the list's page. */
  detailHref: (codeId: string) => string;
  listErrorMessage?: string;
  locale: Locale;
  /** The instant each code's status is read against. */
  now: Temporal.Instant;
  pageSize: number;
  timeZone: string;
};

/**
 * The tenant's codes, newest first: the code, what it takes off and what it
 * applies to, when it works, how many purchases it has discounted, and where
 * it stands, each opening its drawer.
 */
export const PromotionCodeList = async ({
  codes,
  detailHref,
  listErrorMessage,
  locale,
  nextHref,
  now,
  pageSize,
  previousHref,
  timeZone,
}: PromotionCodeListProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.promotion_codes.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const pagination = (
    <PaginationFooter.Root>
      <PaginationFooter.Description>
        {t("admin.promotion_codes.pagination_description", {
          count: pageSize,
        })}
      </PaginationFooter.Description>
      <PaginationFooter.Controls
        aria-label={t("admin.promotion_codes.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </PaginationFooter.Root>
  );

  if (codes.length === 0) {
    return (
      <div className="grid gap-6">
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.promotion_codes.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                <Message message="admin.promotion_codes.empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="admin.promotion_codes.empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
        {hasPageLinks ? pagination : null}
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.promotion_codes.columns.code" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-28">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.columns.discount" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.columns.target" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.columns.window" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-28 text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.promotion_codes.columns.redemptions" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-28">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.promotion_codes.columns.status" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24">
              <span className="sr-only">
                <Suspense fallback={null}>
                  <Message message="admin.promotion_codes.columns.actions" />
                </Suspense>
              </span>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {codes.map((code) => (
            <Table.Row key={code.id}>
              <Table.Cell className="font-medium">
                {code.code.toUpperCase()}
              </Table.Cell>
              <Table.Cell className="tabular-nums">
                {promotionCodeDiscountLabel(code, t, locale)}
              </Table.Cell>
              <Table.Cell>
                <PromotionCodeTargetName target={code.target} />
              </Table.Cell>
              <Table.Cell className="text-sm tabular-nums">
                {promotionCodeWindowLabel(code, t, { locale, timeZone })}
              </Table.Cell>
              <Table.Cell className="text-right tabular-nums">
                {promotionCodeRedemptionsLabel(code, t)}
              </Table.Cell>
              <Table.Cell>
                <PromotionCodeStatusChip code={code} now={now} />
              </Table.Cell>
              <Table.Cell>
                <LinkButton
                  aria-label={t("admin.promotion_codes.view_aria", {
                    code: code.code.toUpperCase(),
                  })}
                  render={<Link href={detailHref(code.id)} scroll={false} />}
                  size="sm"
                  variant="outline"
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                    <Message message="admin.common.view_action" />
                  </Suspense>
                </LinkButton>
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>

      {pagination}
    </div>
  );
};
