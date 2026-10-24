import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { Badge, StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { ReaderIcon } from "#components/reader-icon";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import { getTenantRoleLabel } from "#lib/role-labels";

import type { ReaderItem } from "../reader-types";
import { ReaderStatusMessage, readerStatusTone } from "./reader-status-label";

type ReaderManagerProps = CursorPageHrefs & {
  /** Whether a search or a status filter narrowed the list. */
  filtered: boolean;
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  readers: ReaderItem[];
  timeZone: string;
};

/** A reader with the name of their console role, empty for one with none. */
interface ReaderRow {
  reader: ReaderItem;
  roleLabel: string;
}

const ReaderListBody = ({
  filtered,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  rows,
  timeZone,
}: {
  filtered: boolean;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  rows: ReaderRow[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (rows.length === 0) {
    return (
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              {filtered ? (
                <Message message="admin.readers.empty_filtered_description" />
              ) : (
                <Message message="admin.readers.empty_description" />
              )}
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.name" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.email" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.role" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.readers.columns.created_at" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map(({ reader, roleLabel }) => (
          <Table.Row key={reader.publicId}>
            <Table.Cell>
              <div className="flex min-w-0 items-center gap-2">
                {/* The name beside it says whose icon it is. */}
                <ReaderIcon alt="" icon={reader.icon} size={32} />
                <Link
                  className="font-medium underline-offset-4 hover:underline"
                  href={`/readers/${reader.publicId}`}
                >
                  {reader.name || reader.publicId}
                </Link>
              </div>
            </Table.Cell>
            <Table.Cell>{reader.email}</Table.Cell>
            <Table.Cell>
              {roleLabel ? <Badge tone="info">{roleLabel}</Badge> : null}
            </Table.Cell>
            <Table.Cell>
              <StatusChip status={readerStatusTone(reader.status)}>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <ReaderStatusMessage status={reader.status} />
                </Suspense>
              </StatusChip>
            </Table.Cell>
            <Table.Cell className="tabular-nums">
              {reader.createdAt
                ? formatDate(reader.createdAt, { locale, timeZone })
                : "—"}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

export const ReaderManager = async ({
  filtered,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  readers,
  timeZone,
}: ReaderManagerProps) => {
  const [t, rows] = await Promise.all([
    getMessagesFor(locale),
    Promise.all(
      readers.map(async (reader): Promise<ReaderRow> => ({
        reader,
        roleLabel: reader.role
          ? await getTenantRoleLabel(reader.role, locale)
          : "",
      }))
    ),
  ]);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (readers.length > 0 || hasPageLinks);

  return (
    <ConsoleSection.Root>
      <ReaderListBody
        filtered={filtered}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.readers.item_label")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        rows={rows}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.readers.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.readers.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </ConsoleSection.Root>
  );
};
