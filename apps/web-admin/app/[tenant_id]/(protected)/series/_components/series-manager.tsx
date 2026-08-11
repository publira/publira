import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { EmptyState } from "@publira/ui-components/empty-state";
import { FormMessage } from "@publira/ui-components/form-message";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";

import { PaginationControls } from "#components/pagination-controls";

import type { SeriesListItem } from "../series-types";

interface SeriesManagerProps {
  series: SeriesListItem[];
  listErrorMessage?: string;
  nextHref?: string;
  pageSize: number;
  previousHref?: string;
}

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

const getStatusLabel = (isPublished: boolean) =>
  isPublished ? "公開中" : "下書き";

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

export const SeriesManager = ({
  series,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
}: SeriesManagerProps) => {
  /*
   * Page links stay up even on an empty page: the server hands back a recovery
   * token when the row a token pointed at is gone, and hiding the links would
   * leave that page with no way back into the list. That page is also the
   * reason the empty state is worded twice — an empty page one means the tenant
   * has no series, while an empty page with links only means this page lost the
   * rows it pointed at.
   */
  const hasPageLinks = Boolean(previousHref) || Boolean(nextHref);
  const showPagination = series.length > 0 || hasPageLinks;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>シリーズ一覧</CardTitle>
          <CardDescription>
            タイトルや公開状態を確認し、必要なシリーズを編集またはエピソード管理へ進めます。
          </CardDescription>
        </div>
        <LinkButton href="/series/new" variant="outline">
          シリーズを新規作成
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        {listErrorMessage ? (
          <FormMessage variant="destructive">{listErrorMessage}</FormMessage>
        ) : null}

        {series.length === 0 ? (
          <EmptyState
            description={
              hasPageLinks
                ? "表示中に他の操作で削除された可能性があります。前後のページへ移動してください。"
                : "新規作成ページからシリーズを作成してください。"
            }
            title={
              hasPageLinks
                ? "このページに表示できるシリーズはありません。"
                : "シリーズがまだ登録されていません。"
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>タイトル</TableHead>
                <TableHead>レーベル</TableHead>
                <TableHead className="w-44">公開日</TableHead>
                <TableHead className="w-40">閲覧可能期間</TableHead>
                <TableHead>概要</TableHead>
                <TableHead className="w-32">状態</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {series.map((item) => (
                <TableRow key={item.publicId}>
                  <TableCell className="font-medium">{item.title}</TableCell>
                  <TableCell>{item.labelName || "-"}</TableCell>
                  <TableCell>
                    {formatDateTime(item.publishedAt, { fallback: "-" })}
                  </TableCell>
                  <TableCell>{item.readingPeriodHours}</TableCell>
                  <TableCell>{excerpt(item.synopsis)}</TableCell>
                  <TableCell>
                    <Badge tone={getStatusTone(item.isPublished)}>
                      {getStatusLabel(item.isPublished)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton
                        href={`/series/${item.publicId}`}
                        variant="outline"
                      >
                        編集
                      </LinkButton>
                      <LinkButton
                        href={`/series/${item.publicId}/episodes`}
                        variant="outline"
                      >
                        エピソード
                      </LinkButton>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {showPagination ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              新しい順に、1ページあたり {pageSize} 件まで表示します。
            </p>
            <PaginationControls
              ariaLabel="シリーズ一覧のページ送り"
              nextHref={nextHref}
              previousHref={previousHref}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};
