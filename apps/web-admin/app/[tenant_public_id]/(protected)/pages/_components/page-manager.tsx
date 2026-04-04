"use client";

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
import type { PageListItem } from "../page-types";
import { formatPageDateTime, formatPagePath } from "../page-types";

interface PageManagerProps {
  initialListErrorMessage?: string;
  initialPages: PageListItem[];
}

export const PageManager = ({
  initialListErrorMessage,
  initialPages,
}: PageManagerProps) => {
  const sortedPages = initialPages.toSorted((left, right) => {
    const leftPublished = left.publishedVersionId.length > 0;
    const rightPublished = right.publishedVersionId.length > 0;

    if (leftPublished !== rightPublished) {
      return leftPublished ? -1 : 1;
    }

    return left.slug.localeCompare(right.slug, "ja");
  });

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
      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {sortedPages.length === 0 ? (
          <EmptyState
            description="新規作成ページから固定ページを登録してください。"
            title="ページはまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>タイトル</TableHead>
                <TableHead>slug</TableHead>
                <TableHead className="w-32">状態</TableHead>
                <TableHead className="w-40">更新日時</TableHead>
                <TableHead className="w-32">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPages.map((page) => (
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
      </CardContent>
    </Card>
  );
};