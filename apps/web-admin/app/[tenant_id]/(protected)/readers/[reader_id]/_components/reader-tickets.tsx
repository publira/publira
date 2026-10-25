import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { StatusChip } from "@publira/ui-components/badge";
import * as Dialog from "@publira/ui-components/dialog";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import Link from "next/link";
import { Suspense } from "react";

import { TicketForm } from "#components/access-ticket-form";
import {
  formatTicketDateTime,
  TicketStatusLabel,
  ticketStatusTone,
} from "#components/access-ticket-status";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import { RevokeTicketButton } from "#components/revoke-access-ticket-button";
import type { AccessTicketItem } from "#lib/access-ticket";
import { issueAccessTicketInPlaceAction } from "#lib/access-ticket-actions";
import type { TicketSeriesOption } from "#lib/access-ticket-shared";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import * as IssueTicketDialog from "./issue-ticket-dialog";

type ReaderTicketsProps = CursorPageHrefs & {
  listErrorMessage?: string;
  locale: Locale;
  /** The name the issue dialog calls the reader by. */
  name: string;
  pageSize: number;
  /**
   * The reader's primary key, which a ticket is issued to. Without it the
   * section lists the tickets and offers no issue.
   */
  readerId?: string;
  series: TicketSeriesOption[];
  seriesErrorMessage?: string;
  tenantId: string;
  tickets: AccessTicketItem[];
  timeZone: string;
};

/**
 * The tickets staff issued to one reader, with the revoke the ticket screen
 * offers on each and an issue of a new one for this reader, so a support case
 * about access is handled without leaving the page. The user column is left
 * out because every row names the same person.
 */
export const ReaderTickets = async ({
  listErrorMessage,
  locale,
  name,
  nextHref,
  pageSize,
  previousHref,
  readerId,
  series,
  seriesErrorMessage,
  tenantId,
  tickets,
  timeZone,
}: ReaderTicketsProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (tickets.length > 0 || hasPageLinks);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.readers.tickets_title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.readers.tickets_description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
        {readerId ? (
          <ConsoleSection.Actions>
            <IssueTicketDialog.Root>
              <IssueTicketDialog.Trigger>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.access_tickets.new_action" />
                </Suspense>
              </IssueTicketDialog.Trigger>
              <IssueTicketDialog.Popup>
                <Dialog.Header>
                  <Dialog.Title className="text-lg font-semibold">
                    <Suspense fallback={<SkeletonLine className="h-6 w-48" />}>
                      <Message
                        message="admin.readers.tickets_issue_title"
                        values={{ name }}
                      />
                    </Suspense>
                  </Dialog.Title>
                  <Dialog.Description className="text-sm text-muted-foreground">
                    <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                      <Message message="admin.readers.tickets_issue_description" />
                    </Suspense>
                  </Dialog.Description>
                </Dialog.Header>
                <IssueTicketDialog.Body>
                  <TicketForm
                    action={issueAccessTicketInPlaceAction}
                    readerId={readerId}
                    series={series}
                    seriesErrorMessage={seriesErrorMessage}
                    tenantId={tenantId}
                    timeZone={timeZone}
                  >
                    <IssueTicketDialog.CloseOnIssued />
                  </TicketForm>
                </IssueTicketDialog.Body>
              </IssueTicketDialog.Popup>
            </IssueTicketDialog.Root>
          </ConsoleSection.Actions>
        ) : null}
      </ConsoleSection.Header>

      {listErrorMessage ? (
        <SectionError.Root>
          <SectionError.Heading>
            <SectionError.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.tickets_error" />
              </Suspense>
            </SectionError.Title>
            <SectionError.Description>
              {listErrorMessage}
            </SectionError.Description>
          </SectionError.Heading>
        </SectionError.Root>
      ) : null}

      {!listErrorMessage && tickets.length === 0 ? (
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.access_tickets.item_label")}
        >
          <EmptyState.Heading>
            <EmptyState.Title>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="admin.readers.tickets_empty_title" />
              </Suspense>
            </EmptyState.Title>
            <EmptyState.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="admin.readers.tickets_empty_description" />
              </Suspense>
            </EmptyState.Description>
          </EmptyState.Heading>
        </CursorPageEmptyState>
      ) : null}

      {!listErrorMessage && tickets.length > 0 ? (
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head className="w-40">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.status" />
                </Suspense>
              </Table.Head>
              <Table.Head>
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.episode" />
                </Suspense>
              </Table.Head>
              <Table.Head className="min-w-40">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.note" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-44">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.expires_at" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-44">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.created_at" />
                </Suspense>
              </Table.Head>
              <Table.Head className="w-28">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.access_tickets.columns.actions" />
                </Suspense>
              </Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {tickets.map((ticket) => (
              <Table.Row key={ticket.publicId}>
                <Table.Cell>
                  <div className="grid justify-items-start gap-1">
                    <StatusChip status={ticketStatusTone(ticket.status)}>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-16" />}
                      >
                        <TicketStatusLabel status={ticket.status} />
                      </Suspense>
                    </StatusChip>
                    {ticket.status === "revoked" ? (
                      <span className="text-xs text-muted-foreground">
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-24" />}
                        >
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
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/series/${ticket.seriesPublicId}/episodes/${ticket.episodePublicId}`}
                    >
                      {ticket.episodeTitle || ticket.episodePublicId}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {ticket.seriesTitle || ticket.seriesPublicId}
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
                    <RevokeTicketButton
                      tenantId={tenantId}
                      ticketId={ticket.id}
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      ) : null}

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            {t("admin.access_tickets.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.readers.tickets_pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </ConsoleSection.Root>
  );
};
