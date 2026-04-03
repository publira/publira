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
import Image from "next/image";
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
          <CardTitle>著者一覧</CardTitle>
          <CardDescription>
            名前やプロフィールを確認し、必要な著者を編集します。
          </CardDescription>
        </div>
        <LinkButton render={<Link href="/creators/new" />} variant="outline">
          著者を新規作成
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
            description="新規作成ページから著者を作成してください。"
            title="著者がまだ登録されていません。"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">画像</TableHead>
                <TableHead>名前</TableHead>
                <TableHead>プロフィール</TableHead>
                <TableHead className="w-56">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCreators.map((creator) => (
                <TableRow key={creator.publicId}>
                  <TableCell>
                    {creator.iconImageUrl ? (
                      <Image
                        alt={`${creator.name} のアイコン`}
                        className="size-10 rounded-full border object-cover"
                        height={40}
                        src={creator.iconImageUrl}
                        unoptimized
                        width={40}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        未設定
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">{creator.name}</TableCell>
                  <TableCell>{excerpt(creator.profileText)}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <LinkButton
                        render={<Link href={`/creators/${creator.publicId}`} />}
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
