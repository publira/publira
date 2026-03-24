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

import type { CreatorListItem } from "../creator-types";

interface CreatorManagerProps {
  initialCreators: CreatorListItem[];
  initialListErrorMessage?: string;
}

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/g, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

export const CreatorManager = ({
  initialCreators,
  initialListErrorMessage,
}: CreatorManagerProps) => {
  const sortedCreators = useMemo(
    () =>
      initialCreators.toSorted((a, b) => a.name.localeCompare(b.name, "ja")),
    [initialCreators]
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>クリエイター一覧</CardTitle>
          <CardDescription>
            名前やプロフィールを確認し、必要なクリエイターを編集します。
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/creators/new" />} variant="outline">
          クリエイターを新規作成
        </LinkButton>
      </CardHeader>
      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {sortedCreators.length === 0 ? (
          <EmptyState
            description="新規作成ページからクリエイターを作成してください。"
            title="クリエイターがまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名前</TableHead>
                <TableHead>プロフィール</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCreators.map((creator) => (
                <TableRow key={creator.publicId}>
                  <TableCell className="font-medium">{creator.name}</TableCell>
                  <TableCell>{excerpt(creator.profileText)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton
                        render={
                          <Link href={`/creators/${creator.publicId}/edit`} />
                        }
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
