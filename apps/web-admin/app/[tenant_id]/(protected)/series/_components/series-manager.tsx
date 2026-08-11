import { Badge } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
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

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { SeriesListItem } from "../series-types";

type SeriesManagerProps = CursorPageHrefs & {
  series: SeriesListItem[];
  listErrorMessage?: string;
  pageSize: number;
};

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
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
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
          <CursorPageEmptyState
            description="新規作成ページからシリーズを作成してください。"
            hasPageLinks={hasPageLinks}
            itemLabel="シリーズ"
            title="シリーズがまだ登録されていません。"
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
          <PaginationFooter
            ariaLabel="シリーズ一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
