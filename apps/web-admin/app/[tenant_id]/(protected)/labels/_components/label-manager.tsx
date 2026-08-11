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
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { LabelListItem } from "../label-types";

type LabelManagerProps = CursorPageHrefs & {
  labels: LabelListItem[];
  listErrorMessage?: string;
  pageSize: number;
};

const LabelListBody = ({
  hasPageLinks,
  labels,
  listErrorMessage,
}: {
  hasPageLinks: boolean;
  labels: LabelListItem[];
  listErrorMessage?: string;
}) => {
  // A failed fetch still hands an empty `labels` array; do not show the empty
  // list state alongside the error or operators will read it as "no labels".
  if (listErrorMessage) {
    return <FormMessage variant="destructive">{listErrorMessage}</FormMessage>;
  }

  if (labels.length === 0) {
    return (
      <CursorPageEmptyState
        description="新規作成ページからレーベルを作成してください。"
        hasPageLinks={hasPageLinks}
        itemLabel="レーベル"
        title="レーベルがまだ登録されていません。"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>レーベル名</TableHead>
          <TableHead className="w-56">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {labels.map((label) => (
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
  );
};

export const LabelManager = ({
  labels,
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
}: LabelManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (labels.length > 0 || hasPageLinks);

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
      <CardContent className="grid gap-4">
        <LabelListBody
          hasPageLinks={hasPageLinks}
          labels={labels}
          listErrorMessage={listErrorMessage}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel="レーベル一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
