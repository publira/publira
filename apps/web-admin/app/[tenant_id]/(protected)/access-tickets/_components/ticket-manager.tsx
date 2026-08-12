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
import { formatDateTime } from "@publira/utils";
import Link from "next/link";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { PaginationFooter } from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";

import type { AccessTicketItem } from "../ticket-types";
import { RevokeTicketButton } from "./revoke-ticket-button";

type TicketManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  pageSize: number;
  tickets: AccessTicketItem[];
};

const statusLabel = (status: string): string => {
  switch (status) {
    case "active": {
      return "有効";
    }
    case "expired": {
      return "期限切れ";
    }
    case "revoked": {
      return "失効";
    }
    default: {
      return status;
    }
  }
};

// Absolute API timestamp → admin display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatTicketDateTime = (value: string): string =>
  value ? formatDateTime(value) : "—";

const TicketListBody = ({
  hasPageLinks,
  listErrorMessage,
  tickets,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  tickets: AccessTicketItem[];
}) => {
  if (listErrorMessage) {
    return (
      <SectionError
        description={listErrorMessage}
        title="アクセスチケット一覧を表示できませんでした"
      />
    );
  }

  if (tickets.length === 0) {
    return (
      <CursorPageEmptyState
        description="チケット発行からユーザーにエピソード閲覧権を付与してください。"
        hasPageLinks={hasPageLinks}
        itemLabel="チケット"
        title="チケットがまだありません。"
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">状態</TableHead>
          <TableHead>ユーザー</TableHead>
          <TableHead>エピソード</TableHead>
          <TableHead className="w-44">有効期限</TableHead>
          <TableHead className="w-44">作成日時</TableHead>
          <TableHead className="w-28">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.publicId}>
            <TableCell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {statusLabel(ticket.status)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticket.publicId}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {ticket.userName || ticket.userPublicId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticket.userEmail || ticket.userPublicId}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {ticket.episodeTitle || ticket.episodePublicId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticket.seriesTitle
                    ? `${ticket.seriesTitle} / ${ticket.episodePublicId}`
                    : ticket.episodePublicId}
                </span>
              </div>
            </TableCell>
            <TableCell>{formatTicketDateTime(ticket.expiresAt)}</TableCell>
            <TableCell>{formatTicketDateTime(ticket.createdAt)}</TableCell>
            <TableCell>
              {ticket.status === "active" ? (
                <RevokeTicketButton publicId={ticket.publicId} />
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const TicketManager = ({
  listErrorMessage,
  nextHref,
  pageSize,
  previousHref,
  tickets,
}: TicketManagerProps) => {
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (tickets.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>アクセスチケット一覧</CardTitle>
          <CardDescription>
            発行済みの限定閲覧チケットを確認・失効できます。
          </CardDescription>
        </div>
        <LinkButton
          render={<Link href="/access-tickets/new" />}
          variant="outline"
        >
          チケットを発行
        </LinkButton>
      </CardHeader>

      <CardContent className="grid gap-4">
        <TicketListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          tickets={tickets}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel="アクセスチケット一覧のページ送り"
            description={`新しい順に、1ページあたり ${pageSize} 件まで表示します。`}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
