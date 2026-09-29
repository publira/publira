import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import {
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
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
import { Suspense } from "react";

import { AdminSection } from "#components/admin-page";
import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import {
  PaginationControls,
  PaginationFooter,
  PaginationFooterDescription,
} from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import type { ContactMessageItem } from "../contact-message-types";
import { contactMessageStatus } from "../contact-message-types";
import {
  ContactMessageStatusMessage,
  contactMessageStatusTone,
} from "./contact-message-status-label";

type ContactMessageManagerProps = CursorPageHrefs & {
  /** Whether a status filter narrowed the inbox. */
  filtered: boolean;
  listErrorMessage?: string;
  locale: Locale;
  messages: ContactMessageItem[];
  pageSize: number;
  timeZone: string;
};

/**
 * Who wrote the message: the account that sent it, linked to the reader it
 * belongs to, or the guest a message with no account came from. A reader who
 * has closed their account since reads as a guest, because that is all the
 * message still carries of them.
 */
const ContactMessageSender = ({ message }: { message: ContactMessageItem }) => {
  if (!message.senderPublicId) {
    return (
      <span className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="admin.contact_messages.sender_guest" />
        </Suspense>
      </span>
    );
  }

  return (
    <Link
      className="underline-offset-4 hover:underline"
      href={`/readers/${message.senderPublicId}`}
    >
      {message.senderName || message.senderPublicId}
    </Link>
  );
};

const ContactMessageListBody = ({
  filtered,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  messages,
  timeZone,
}: {
  filtered: boolean;
  hasPageLinks: boolean;
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  messages: ContactMessageItem[];
  timeZone: string;
}) => {
  if (listErrorMessage) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.contact_messages.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{listErrorMessage}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (messages.length === 0) {
    return (
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.contact_messages.empty_title" />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              {filtered ? (
                <Message message="admin.contact_messages.empty_filtered_description" />
              ) : (
                <Message message="admin.contact_messages.empty_description" />
              )}
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.contact_messages.columns.subject" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.contact_messages.columns.sender" />
            </Suspense>
          </TableHead>
          <TableHead>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.contact_messages.columns.reply_to" />
            </Suspense>
          </TableHead>
          <TableHead className="w-36">
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.contact_messages.columns.status" />
            </Suspense>
          </TableHead>
          <TableHead className="w-48">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.contact_messages.columns.created_at" />
            </Suspense>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {messages.map((message) => (
          <TableRow key={message.publicId}>
            <TableCell>
              <Link
                className="font-medium underline-offset-4 hover:underline"
                href={`/contact-messages/${message.publicId}`}
              >
                {message.subject || (
                  <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                    <Message message="admin.contact_messages.subject_none" />
                  </Suspense>
                )}
              </Link>
            </TableCell>
            <TableCell>
              <ContactMessageSender message={message} />
            </TableCell>
            <TableCell>{message.replyToEmail}</TableCell>
            <TableCell>
              <StatusChip
                status={contactMessageStatusTone(contactMessageStatus(message))}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <ContactMessageStatusMessage
                    status={contactMessageStatus(message)}
                  />
                </Suspense>
              </StatusChip>
            </TableCell>
            <TableCell className="tabular-nums">
              {message.createdAt
                ? formatDateTime(message.createdAt, { locale, timeZone })
                : "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
};

export const ContactMessageManager = async ({
  filtered,
  listErrorMessage,
  locale,
  messages,
  nextHref,
  pageSize,
  previousHref,
  timeZone,
}: ContactMessageManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });
  const showPagination =
    !listErrorMessage && (messages.length > 0 || hasPageLinks);

  return (
    <AdminSection>
      <ContactMessageListBody
        filtered={filtered}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.contact_messages.item_label")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        messages={messages}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter>
          <PaginationFooterDescription>
            {t("admin.contact_messages.pagination_description", {
              count: pageSize,
            })}
          </PaginationFooterDescription>
          <PaginationControls
            aria-label={t("admin.contact_messages.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter>
      ) : null}
    </AdminSection>
  );
};
