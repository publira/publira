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

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { PageListItem } from "../page-types";
import { formatPageDateTime, formatPagePath } from "../page-types";

type PageManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  pageSize: number;
  pages: PageListItem[];
};

export const PageManager = ({
  listErrorMessage,
  nextHref,
  pageSize,
  pages,
  previousHref,
}: PageManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination = pages.length > 0 || hasPageLinks;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>ページ一覧</CardTitle>
          <CardDescription>
            ページの作成状況、slug、公開状態を確認し、編集画面へ移動します。
          </CardDescription>
        </div>
        <LinkButton href="/pages/new" variant="outline">
          ページを新規作成
        </LinkButton>
      </CardHeader>
      <CardContent className="grid gap-4">
        {listErrorMessage ? (
          <FormMessage variant="destructive">{listErrorMessage}</FormMessage>
        ) : null}

        {pages.length === 0 ? (
          <CursorPageEmptyState
            description="新規作成ページから固定ページを登録してください。"
            hasPageLinks={hasPageLinks}
            itemLabel="ページ"
            title="ページはまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>タイトル</TableHead>
                <TableHead>slug</TableHead>
                <TableHead className="w-32">状態</TableHead>
                <TableHead className="w-28">フッター</TableHead>
                <TableHead className="w-40">更新日時</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pages.map((page) => (
                <TableRow key={page.id}>
                  <TableCell className="font-medium">{page.title}</TableCell>
                  <TableCell>{formatPagePath(page.slug)}</TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        page.publishedVersionId.length > 0 ? "info" : "muted"
                      }
                    >
                      {page.publishedVersionId.length > 0 ? "公開中" : "下書き"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {page.displayInFooter ? (
                      <Badge tone="info">表示</Badge>
                    ) : (
                      <Badge tone="muted">非表示</Badge>
                    )}
                  </TableCell>
                  <TableCell>{formatPageDateTime(page.updatedAt)}</TableCell>
                  <TableCell>
                    <LinkButton href={`/pages/${page.id}`} variant="outline">
                      編集
                    </LinkButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {showPagination ? (
          <PaginationFooter
            ariaLabel="ページ一覧のページ送り"
            description={`作成順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
