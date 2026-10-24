import type { Locale } from "@publira/i18n";
import type { BadgeTone } from "@publira/ui-components/badge";
import { StatusChip } from "@publira/ui-components/badge";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { AccessTicketItem } from "../ticket-types";
import { RevokeTicketButton } from "./revoke-ticket-button";

type TicketManagerProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  tenantId: string;
  tickets: AccessTicketItem[];
  timeZone: string;
};

/**
 * The ticket's status, worded one branch at a time. Each branch names its key
 * inside the `<Message>` it returns, so the key stays where anything reading
 * this file for the strings the screen uses can see it.
 */
const TicketStatusLabel = ({ status }: { status: string }) => {
  switch (status) {
    case "active": {
      return <Message message="admin.access_tickets.status_active" />;
    }
    case "expired": {
      return <Message message="admin.access_tickets.status_expired" />;
    }
    case "revoked": {
      return <Message message="admin.access_tickets.status_revoked" />;
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
  emptyDescription,
  emptyTitle,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  tenantId,
  tickets,
  timeZone,
}: {
  /** The empty state's copy, resolved by the async parent. */
  emptyDescription: string;
  emptyTitle: string;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  tickets: AccessTicketItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.access_tickets.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (tickets.length === 0) {
    return (
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyState.Heading>
          <EmptyState.Title>{emptyTitle}</EmptyState.Title>
          <EmptyState.Description>{emptyDescription}</EmptyState.Description>
        </EmptyState.Heading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.user" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.episode" />
            </Suspense>
          </Table.Head>
          <Table.Head className="min-w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.note" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.expires_at" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.created_at" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-28">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.access_tickets.columns.actions" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {tickets.map((ticket) => (
          <Table.Row key={ticket.publicId}>
            <Table.Cell>
              <div className="grid gap-1">
                <StatusChip status={statusTone(ticket.status)}>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <TicketStatusLabel status={ticket.status} />
                  </Suspense>
                </StatusChip>
                <span className="text-xs text-muted-foreground">
                  {ticket.publicId}
                </span>
                {ticket.status === "revoked" ? (
                  <span className="text-xs text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                      <Message
                        message="admin.access_tickets.revoked_at"
                        values={{
                          at: formatTicketDateTime(
                            ticket.revokedAt,
                            locale,
                            timeZone
                          ),
                        }}
                      />
                    </Suspense>
                  </span>
                ) : null}
              </div>
            </Table.Cell>
            <Table.Cell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {ticket.userName || ticket.userPublicId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {ticket.userEmail || ticket.userPublicId}
                </span>
              </div>
            </Table.Cell>
            <Table.Cell>
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
            </Table.Cell>
            <Table.Cell>
              {ticket.note ? (
                <span className="line-clamp-2 text-sm">{ticket.note}</span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </Table.Cell>
            <Table.Cell>
              {formatTicketDateTime(ticket.expiresAt, locale, timeZone)}
            </Table.Cell>
            <Table.Cell>
              {formatTicketDateTime(ticket.createdAt, locale, timeZone)}
            </Table.Cell>
            <Table.Cell>
              {ticket.status === "active" ? (
                <RevokeTicketButton tenantId={tenantId} ticketId={ticket.id} />
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

/**
 * One ticket's status, as its own async component: the label is a string the
 * catalog resolves, and a row rendered inside `.map()` cannot await.
 */
export const TicketManager = async ({
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  tenantId,
  tickets,
  timeZone,
}: TicketManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (tickets.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <TicketListBody
        emptyDescription={t("admin.access_tickets.empty_description")}
        emptyTitle={t("admin.access_tickets.empty_title")}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.access_tickets.item_label")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        tenantId={tenantId}
        tickets={tickets}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.access_tickets.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.access_tickets.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
