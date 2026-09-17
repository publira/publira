import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
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
  TableRow,
} from "@publira/ui-components/table";
import { formatDate } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { AdminSection } from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

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

const ReaderListBody = ({
  filtered,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  readers,
  timeZone,
}: {
  filtered: boolean;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  readers: ReaderItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.readers.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (readers.length === 0) {
    return (
      <CursorPageEmptyState
        description={
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            {filtered ? (
              <Message message="admin.readers.empty_filtered_description" />
            ) : (
              <Message message="admin.readers.empty_description" />
            )}
          </Suspense>
        }
        hasPageLinks={hasPageLinks}
        itemLabel={itemLabel}
        title={
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="admin.readers.empty_title" />
          </Suspense>
        }
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.name" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.email" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.readers.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.readers.columns.created_at" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {readers.map((reader) => (
          <TableRow key={reader.publicId}>
            <TableCell>
              <Link
                className="font-medium underline-offset-4 hover:underline"
                href={`/readers/${reader.publicId}`}
              >
                {reader.name || reader.publicId}
              </Link>
            </TableCell>
            <TableCell>{reader.email}</TableCell>
            <TableCell>
              <StatusChip status={readerStatusTone(reader.status)}>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <ReaderStatusMessage status={reader.status} />
                </Suspense>
              </StatusChip>
            </TableCell>
            <TableCell className="tabular-nums">
              {reader.createdAt
                ? formatDate(reader.createdAt, { locale, timeZone })
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (readers.length > 0 || hasPageLinks);

  return (
    <AdminSection>
      <ReaderListBody
        filtered={filtered}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.readers.item_label")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        readers={readers}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter
          ariaLabel={t("admin.readers.pagination_aria")}
          description={t("admin.readers.pagination_description", {
            count: pageSize,
          })}
          nextHref={nextHref}
          previousHref={previousHref}
        />
      ) : null}
    </AdminSection>
  );
};
