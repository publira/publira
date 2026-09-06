import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";
import type { BadgeTone } from "@publira/ui-components/badge";
import { StatusChip } from "@publira/ui-components/badge";
import { LinkButton } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
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
  locale: Locale;
  pageSize: number;
  tickets: AccessTicketItem[];
  timeZone: string;
};

const statusLabel = (status: string, messages: SharedMessages): string => {
  switch (status) {
    case "active": {
      return getMessage(messages, "admin.access_tickets.status_active");
    }
    case "expired": {
      return getMessage(messages, "admin.access_tickets.status_expired");
    }
    case "revoked": {
      return getMessage(messages, "admin.access_tickets.status_revoked");
    }
    default: {
      return status;
    }
  }
};

const statusTone = (status: string): BadgeTone => {
  switch (status) {
    case "active": {
      return "success";
    }
    case "expired": {
      return "warning";
    }
    case "revoked": {
      return "muted";
    }
    default: {
      return "info";
    }
  }
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatTicketDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

const TicketListBody = ({
  hasPageLinks,
  listErrorMessage,
  locale,
  tickets,
  timeZone,
}: {
  hasPageLinks: boolean;
  listErrorMessage?: string;
  locale: Locale;
  tickets: AccessTicketItem[];
  timeZone: string;
}) => {
  const messages = sharedCatalog(locale);
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            {getMessage(messages, "admin.access_tickets.list_error")}
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (tickets.length === 0) {
    return (
      <CursorPageEmptyState
        description={getMessage(
          messages,
          "admin.access_tickets.empty_description"
        )}
        hasPageLinks={hasPageLinks}
        itemLabel={getMessage(messages, "admin.access_tickets.item_label")}
        title={getMessage(messages, "admin.access_tickets.empty_title")}
      />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-40">
            {getMessage(messages, "admin.access_tickets.columns.status")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.access_tickets.columns.user")}
          </TableHead>
          <TableHead>
            {getMessage(messages, "admin.access_tickets.columns.episode")}
          </TableHead>
          <TableHead className="min-w-40">
            {getMessage(messages, "admin.access_tickets.columns.note")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "admin.access_tickets.columns.expires_at")}
          </TableHead>
          <TableHead className="w-44">
            {getMessage(messages, "admin.access_tickets.columns.created_at")}
          </TableHead>
          <TableHead className="w-28">
            {getMessage(messages, "admin.access_tickets.columns.actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {tickets.map((ticket) => (
          <TableRow key={ticket.publicId}>
            <TableCell>
              <div className="grid gap-1">
                <StatusChip status={statusTone(ticket.status)}>
                  {statusLabel(ticket.status, messages)}
                </StatusChip>
                <span className="text-xs text-muted-foreground">
                  {ticket.publicId}
                </span>
                {ticket.status === "revoked" ? (
                  <span className="text-xs text-muted-foreground">
                    {getMessage(messages, "admin.access_tickets.revoked_at", {
                      at: formatTicketDateTime(
                        ticket.revokedAt,
                        locale,
                        timeZone
                      ),
                    })}
                  </span>
                ) : null}
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
            <TableCell>
              {ticket.note ? (
                <span className="line-clamp-2 text-sm">{ticket.note}</span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell>
              {formatTicketDateTime(ticket.expiresAt, locale, timeZone)}
            </TableCell>
            <TableCell>
              {formatTicketDateTime(ticket.createdAt, locale, timeZone)}
            </TableCell>
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
  locale,
  nextHref,
  pageSize,
  previousHref,
  tickets,
  timeZone,
}: TicketManagerProps) => {
  const messages = sharedCatalog(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (tickets.length > 0 || hasPageLinks);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>
            {getMessage(messages, "admin.access_tickets.list_title")}
          </CardTitle>
          <CardDescription>
            {getMessage(messages, "admin.access_tickets.list_description")}
          </CardDescription>
        </div>
        <LinkButton
          render={<Link href="/access-tickets/new" />}
          variant="outline"
        >
          {getMessage(messages, "admin.access_tickets.new_action")}
        </LinkButton>
      </CardHeader>

      <CardContent className="grid gap-4">
        <TicketListBody
          hasPageLinks={hasPageLinks}
          listErrorMessage={listErrorMessage}
          locale={locale}
          tickets={tickets}
          timeZone={timeZone}
        />

        {showPagination ? (
          <PaginationFooter
            ariaLabel={getMessage(
              messages,
              "admin.access_tickets.pagination_aria"
            )}
            description={getMessage(
              messages,
              "admin.access_tickets.pagination_description",
              { count: pageSize }
            )}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        ) : null}
      </CardContent>
    </Card>
  );
};
