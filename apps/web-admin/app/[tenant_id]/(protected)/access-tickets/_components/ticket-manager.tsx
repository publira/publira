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

import type { AccessTicketItem } from "../ticket-types";
import { RevokeTicketButton } from "./revoke-ticket-button";

interface TicketManagerProps {
  initialListErrorMessage?: string;
  initialTickets: AccessTicketItem[];
}

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

const formatDateTime = (value: string): string => {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("ja-JP", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export const TicketManager = ({
  initialTickets,
  initialListErrorMessage,
}: TicketManagerProps) => {
  const tickets = useMemo(
    () =>
      initialTickets.toSorted((a, b) =>
        b.createdAt.localeCompare(a.createdAt, "ja")
      ),
    [initialTickets]
  );

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

      <CardContent>
        {initialListErrorMessage ? (
          <FormMessage className="mb-4" variant="destructive">
            {initialListErrorMessage}
          </FormMessage>
        ) : null}

        {tickets.length === 0 ? (
          <EmptyState
            description="チケット発行からユーザーにエピソード閲覧権を付与してください。"
            title="チケットがまだありません。"
          />
        ) : (
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
                  <TableCell>{formatDateTime(ticket.expiresAt)}</TableCell>
                  <TableCell>{formatDateTime(ticket.createdAt)}</TableCell>
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
        )}
      </CardContent>
    </Card>
  );
};
