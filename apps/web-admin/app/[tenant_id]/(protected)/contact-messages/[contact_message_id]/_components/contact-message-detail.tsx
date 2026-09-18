import type { Locale } from "@publira/i18n";
import { StatusChip } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionActions,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";

import {
  ContactMessageStatusMessage,
  contactMessageStatusTone,
} from "../../_components/contact-message-status-label";
import type { ContactMessageItem } from "../../contact-message-types";
import { contactMessageStatus } from "../../contact-message-types";
import { MarkHandledButton } from "./mark-handled-button";
import { ReopenMessageButton } from "./reopen-message-button";

interface ContactMessageDetailProps {
  contactMessage: ContactMessageItem;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}

const labelClassName = cn("text-sm text-muted-foreground");
const valueClassName = cn("min-w-0 text-sm");

export const ContactMessageDetail = ({
  contactMessage,
  locale,
  tenantId,
  timeZone,
}: ContactMessageDetailProps) => {
  const status = contactMessageStatus(contactMessage);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.contact_messages.detail_section_title" />
            </Suspense>
          </AdminSectionTitle>
        </AdminSectionHeading>
        <AdminSectionActions>
          {status === "handled" ? (
            <ReopenMessageButton
              publicId={contactMessage.publicId}
              tenantId={tenantId}
            />
          ) : (
            <MarkHandledButton
              publicId={contactMessage.publicId}
              tenantId={tenantId}
            />
          )}
        </AdminSectionActions>
      </AdminSectionHeader>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.columns.status" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <StatusChip status={contactMessageStatusTone(status)}>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <ContactMessageStatusMessage status={status} />
            </Suspense>
          </StatusChip>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.columns.created_at" />
          </Suspense>
        </dt>
        <dd className={cn(valueClassName, "tabular-nums")}>
          {contactMessage.createdAt
            ? formatDateTime(contactMessage.createdAt, { locale, timeZone })
            : "—"}
        </dd>

        {contactMessage.handledAt ? (
          <>
            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.contact_messages.handled_at" />
              </Suspense>
            </dt>
            <dd className={cn(valueClassName, "tabular-nums")}>
              {formatDateTime(contactMessage.handledAt, { locale, timeZone })}
            </dd>
          </>
        ) : null}

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.columns.sender" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {contactMessage.senderPublicId ? (
            <Link
              className="underline-offset-4 hover:underline"
              href={`/readers/${contactMessage.senderPublicId}`}
            >
              {contactMessage.senderName || contactMessage.senderPublicId}
            </Link>
          ) : (
            <span className="text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.contact_messages.sender_guest" />
              </Suspense>
            </span>
          )}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.columns.reply_to" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {/* Staff answer from their own mail client, so the address opens one
              rather than only being readable. */}
          <a
            className="underline underline-offset-4"
            href={`mailto:${contactMessage.replyToEmail}`}
          >
            {contactMessage.replyToEmail}
          </a>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.columns.subject" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {contactMessage.subject || (
            <span className="text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.contact_messages.subject_none" />
              </Suspense>
            </span>
          )}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.contact_messages.body" />
          </Suspense>
        </dt>
        {/* The reader's own line breaks are the only structure the body has. */}
        <dd className={cn(valueClassName, "whitespace-pre-wrap")}>
          {contactMessage.body}
        </dd>
      </dl>
    </AdminSection>
  );
};
