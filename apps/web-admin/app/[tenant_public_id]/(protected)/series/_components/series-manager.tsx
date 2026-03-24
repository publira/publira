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
import { useMemo } from "react";

import type { SeriesListItem } from "../series-types";

interface SeriesManagerProps {
  initialSeries: SeriesListItem[];
  initialListErrorMessage?: string;
}

const getStatusTone = (isPublished: boolean) =>
  isPublished ? ("info" as const) : ("muted" as const);

const getStatusLabel = (isPublished: boolean) =>
  isPublished ? "公開中" : "下書き";

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

export const SeriesManager = ({
  initialSeries,
  initialListErrorMessage,
}: SeriesManagerProps) => {
  const sortedSeries = useMemo(
    () =>
      initialSeries.toSorted((a, b) => {
        if (a.isPublished !== b.isPublished) {
          return a.isPublished ? -1 : 1;
        }

        return a.title.localeCompare(b.title, "ja");
      }),
    [initialSeries]
  );

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
      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {sortedSeries.length === 0 ? (
          <EmptyState
            description="新規作成ページからシリーズを作成してください。"
            title="シリーズがまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>タイトル</TableHead>
                <TableHead>レーベル</TableHead>
                <TableHead className="w-40">閲覧可能期間</TableHead>
                <TableHead>概要</TableHead>
                <TableHead className="w-32">状態</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedSeries.map((series) => (
                <TableRow key={series.publicId}>
                  <TableCell className="font-medium">{series.title}</TableCell>
                  <TableCell>{series.labelName || "-"}</TableCell>
                  <TableCell>{series.readingPeriodHours}</TableCell>
                  <TableCell>{excerpt(series.synopsis)}</TableCell>
                  <TableCell>
                    <Badge tone={getStatusTone(series.isPublished)}>
                      {getStatusLabel(series.isPublished)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton
                        href={`/series/${series.publicId}`}
                        variant="outline"
                      >
                        編集
                      </LinkButton>
                      <LinkButton
                        href={`/series/${series.publicId}/episodes`}
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
      </CardContent>
    </Card>
  );
};
