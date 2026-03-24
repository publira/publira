"use client";

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
import Link from "next/link";
import { useMemo } from "react";

import type { LabelListItem } from "../label-types";

interface LabelManagerProps {
  initialLabels: LabelListItem[];
  initialListErrorMessage?: string;
}

export const LabelManager = ({
  initialLabels,
  initialListErrorMessage,
}: LabelManagerProps) => {
  const sortedLabels = useMemo(
    () => initialLabels.toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
    [initialLabels]
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>レーベル一覧</CardTitle>
          <CardDescription>
            レーベル名を確認し、必要な項目を編集します。
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/labels/new" />} variant="outline">
          レーベルを新規作成
        </LinkButton>
      </CardHeader>
      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {sortedLabels.length === 0 ? (
          <EmptyState
            description="新規作成ページからレーベルを作成してください。"
            title="レーベルがまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>レーベル名</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedLabels.map((label) => (
                <TableRow key={label.publicId}>
                  <TableCell className="font-medium">{label.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton
                        render={<Link href={`/labels/${label.publicId}`} />}
                        variant="outline"
                      >
                        編集
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
