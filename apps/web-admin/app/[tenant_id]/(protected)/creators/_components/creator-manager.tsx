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
import Image from "next/image";
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { CreatorListItem } from "../creator-types";

type CreatorManagerProps = CursorPageHrefs & {
  creators: CreatorListItem[];
  listErrorMessage?: string;
  pageSize: number;
};

const excerpt = (text: string, max = 56) => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();
  if (normalized.length <= max) {
    return normalized || "-";
  }

  return `${normalized.slice(0, max)}...`;
};

const CreatorListBody = ({
  creators,
  hasPageLinks,
  listErrorMessage,
}: {
  creators: CreatorListItem[];
  hasPageLinks: boolean;
  listErrorMessage?: string;
}) => {
  // A failed fetch still hands an empty `creators` array; do not show the empty
  // list state alongside the error or operators will read it as "no creators".
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title="著者一覧を表示できませんでした"
      />
    );
  }

  if (creators.length === 0) {
    return (
      <CursorPageEmptyState
        description="新規作成ページから著者を作成してください。"
        hasPageLinks={hasPageLinks}
        itemLabel="著者"
        title="著者がまだ登録されていません。"
      />
    );
  }

  return (
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
        {creators.map((creator) => (
          <TableRow key={creator.publicId}>
            <TableCell>
              {creator.iconImageUrl ? (
                <Image
                  alt={`${creator.name} のアイコン`}
                  className="size-10 rounded-full border object-cover"
                  height={40}
                  src={creator.iconImageUrl}
                  width={40}
                />
              ) : (
                <span className="text-xs text-muted-foreground">未設定</span>
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
  );
};

export const CreatorManager = ({
  creators,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
}: CreatorManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (creators.length > 0 || hasPageLinks);

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
      <CardContent className="grid gap-4">
        <CreatorListBody
          creators={creators}
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel="著者一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
