import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { SectionError } from "@publira/ui-components/section-error";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { AnnouncementItem } from "../announcement-types";

type AnnouncementManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  pageSize: number;
  timeZone: string;
};

const formatAudience = (item: AnnouncementItem): string => {
  if (item.audienceType === "all") {
    return "全体";
  }
  if (item.targetUserName) {
    return `指定 (${item.targetUserName})`;
  }
  return "指定";
};

const excerpt = (text: string, maxLength: number): string => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}...`;
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatAnnouncementDateTime = (value: string, timeZone: string): string =>
  value ? formatDateTime(value, { timeZone }) : "—";

const AnnouncementListBody = ({
  hasPageLinks,
  listErrorMessage,
  announcements,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  timeZone: string;
}) => {
  // A failed fetch still hands an empty `announcements` array; do not show the
  // empty list state alongside the error or operators will read it as "none".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title="お知らせ一覧を表示できませんでした"
      />
    );
  }

  if (announcements.length === 0) {
    return (
      <CursorPageEmptyState
        description="お知らせ作成から対象ユーザーにお知らせを配信してください。"
        hasPageLinks={hasPageLinks}
        itemLabel="お知らせ"
        title="お知らせがまだありません。"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-44">作成日時</TableHead>
          <TableHead>タイトル</TableHead>
          <TableHead>本文</TableHead>
          <TableHead className="w-52">対象</TableHead>
          <TableHead className="w-60">リンク先</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {announcements.map((announcement) => (
          <TableRow key={announcement.id}>
            <TableCell>
              {formatAnnouncementDateTime(announcement.createdAt, timeZone)}
            </TableCell>
            <TableCell className="font-medium">{announcement.title}</TableCell>
            <TableCell>{excerpt(announcement.body, 72)}</TableCell>
            <TableCell>{formatAudience(announcement)}</TableCell>
            <TableCell>{announcement.linkUrl || "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const AnnouncementManager = ({
  listErrorMessage,
  nextHref,
  announcements,
  pageSize,
  previousHref,
  timeZone,
}: AnnouncementManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (announcements.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>お知らせ一覧</CardTitle>
          <CardDescription>
            作成済みのお知らせと配信対象を確認できます。
          </CardDescription>
        </div>
        <LinkButton
          render={<Link href="/announcements/new" />}
          variant="outline"
        >
          お知らせを作成
        </LinkButton>
      </CardHeader>

      <CardContent className="grid gap-4">
        <AnnouncementListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          announcements={announcements}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel="お知らせ一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
