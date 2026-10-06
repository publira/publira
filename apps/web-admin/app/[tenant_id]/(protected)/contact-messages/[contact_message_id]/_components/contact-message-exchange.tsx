import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import type {
  ContactMessageEntryItem,
  ContactMessageItem,
} from "../../contact-message-types";
import { ContactMessageReplyForm } from "./contact-message-reply-form";

interface ContactMessageExchangeProps {
  contactMessage: Pick<
    ContactMessageItem,
    "entries" | "entryCount" | "id" | "publicId" | "replyToEmail"
  >;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

/**
 * Who wrote one entry: the member of staff by name, or the address a reader's
 * reply was mailed from. An answer whose author's account has been deleted
 * since still reads as staff, because it was still sent from the console.
 */
const ContactMessageEntryAuthor = ({
  entry,
}: {
  entry: ContactMessageEntryItem;
}) => {
  if (entry.direction === "reader") {
    return (
      <Message
        message="admin.contact_messages.exchange.reader_entry"
        values={{ email: entry.fromEmail }}
      />
    );
  }
  if (!entry.authorName) {
    return (
      <Message message="admin.contact_messages.exchange.staff_entry_former" />
    );
  }
  return (
    <Message
      message="admin.contact_messages.exchange.staff_entry"
      values={{ name: entry.authorName }}
    />
  );
};

/**
 * The exchange under a message, oldest first so the newest is last, the way a
 * mail thread reads, with the answer form at its foot.
 */
export const ContactMessageExchange = ({
  contactMessage,
  locale,
  tenantId,
  timeZone,
}: ContactMessageExchangeProps) => (
  <AdminSection>
    <AdminSectionHeader>
      <AdminSectionHeading>
        <AdminSectionTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="admin.contact_messages.exchange.title" />
          </Suspense>
        </AdminSectionTitle>
        <AdminSectionDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.contact_messages.exchange.description" />
          </Suspense>
        </AdminSectionDescription>
      </AdminSectionHeading>
    </AdminSectionHeader>

    {contactMessage.entries.length === 0 ? (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.contact_messages.exchange.empty" />
        </Suspense>
      </p>
    ) : (
      <ol className="grid gap-6">
        {contactMessage.entries.map((entry) => (
          <li
            className={cn(
              "grid gap-1 border-l-2 pl-4",
              entry.direction === "staff" ? "border-primary" : "border-border"
            )}
            key={entry.id}
          >
            <p className="text-sm font-medium">
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <ContactMessageEntryAuthor entry={entry} />
              </Suspense>
            </p>
            {entry.createdAt ? (
              <time
                className="text-sm text-muted-foreground tabular-nums"
                dateTime={entry.createdAt}
              >
                {formatDateTime(entry.createdAt, { locale, timeZone })}
              </time>
            ) : null}
            {/* The writer's own line breaks are the only structure it has. */}
            <p className="mt-2 text-sm whitespace-pre-wrap">{entry.body}</p>
          </li>
        ))}
      </ol>
    )}

    <ContactMessageReplyForm
      contactMessage={contactMessage}
      tenantId={tenantId}
    />
  </AdminSection>
);
