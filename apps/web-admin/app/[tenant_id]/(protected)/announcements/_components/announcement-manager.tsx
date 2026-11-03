import { getLocaleLabel, toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ActionForm from "@publira/ui-components/action-form";
import { LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";

import { unpinAnnouncementAction } from "../_lib/actions";
import type {
  AnnouncementDeliveryValue,
  AnnouncementItem,
} from "../announcement-types";

type AnnouncementManagerProps = CursorPageHrefs & {
  /**
   * Whether the operator may take a banner down or edit a scheduled
   * announcement, which a tenant auditor may not: the state is shown to them
   * without the controls.
   */
  canEdit: boolean;
  listErrorMessage?: string;
  announcements: AnnouncementItem[];
  locale: Locale;
  pageSize: number;
  tenantId: string;
  timeZone: string;
};

const excerpt = (text: string, maxLength: number): string => {
  const normalized = text.replaceAll(/\s+/gu, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
};

// Absolute API timestamp → tenant display zone. `formatDateTime` falls back to
// the raw value when it cannot be parsed, so only the empty case is special.
const formatAnnouncementDateTime = (
  value: string,
  locale: Locale,
  timeZone: string
): string => (value ? formatDateTime(value, { locale, timeZone }) : "—");

/**
 * A count of readers once the announcement has gone out, and a dash while it is
 * scheduled: 0 then would read as an announcement nobody was sent.
 */
const readerCountOf = (
  announcement: AnnouncementItem,
  value: number,
  locale: Locale
): string =>
  announcement.deliveredAt
    ? new Intl.NumberFormat(toIntlLocale(locale)).format(value)
    : "—";

/**
 * Whether the site is showing this announcement as a banner, and until when.
 * Each branch names its key inside the `<Message>` it returns.
 */
const BannerStateLabel = ({
  announcement,
  locale,
  timeZone,
}: {
  announcement: AnnouncementItem;
  locale: Locale;
  timeZone: string;
}) => {
  if (!announcement.pinnedUntil) {
    return <Message message="admin.announcements.banner_showing" />;
  }

  return (
    <Message
      message="admin.announcements.banner_showing_until"
      values={{
        until: formatAnnouncementDateTime(
          announcement.pinnedUntil,
          locale,
          timeZone
        ),
      }}
    />
  );
};

/**
 * Which readers the announcement's notification reached. Each branch names its
 * key inside the `<Message>` it returns.
 */
const DeliveryLabel = ({
  delivery,
}: {
  delivery: AnnouncementDeliveryValue;
}) => {
  if (delivery === "everyone") {
    return <Message message="admin.announcements.delivery.everyone" />;
  }

  return <Message message="admin.announcements.delivery.preferred" />;
};

/**
 * Who the announcement is addressed to: everyone, or how many conditions select
 * its readers. Each branch names its key inside the `<Message>` it returns.
 */
const AudienceLabel = ({ audience }: Pick<AnnouncementItem, "audience">) => {
  if (!audience) {
    return <Message message="admin.announcements.audience.everyone" />;
  }

  return (
    <Message
      message="admin.announcements.audience.targeted"
      values={{ count: audience.length }}
    />
  );
};

/**
 * Whether the announcement has gone out, and when it did or will. Each branch
 * names its key inside the `<Message>` it returns.
 */
const StatusLabel = ({
  announcement,
  locale,
  timeZone,
}: {
  announcement: AnnouncementItem;
  locale: Locale;
  timeZone: string;
}) => {
  if (announcement.deliveredAt) {
    return (
      <Message
        message="admin.announcements.status.delivered"
        values={{
          at: formatAnnouncementDateTime(
            announcement.deliveredAt,
            locale,
            timeZone
          ),
        }}
      />
    );
  }

  return (
    <Message
      message="admin.announcements.status.scheduled"
      values={{
        at: formatAnnouncementDateTime(
          announcement.deliverAt,
          locale,
          timeZone
        ),
      }}
    />
  );
};

/**
 * The status column of one row, and the link that edits a scheduled
 * announcement. One that has gone out is what its readers were pointed at, so
 * it has no such link.
 */
const StatusCell = ({
  announcement,
  canEdit,
  locale,
  timeZone,
}: {
  announcement: AnnouncementItem;
  canEdit: boolean;
  locale: Locale;
  timeZone: string;
}) => (
  <div className="grid gap-2">
    <span>
      <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
        <StatusLabel
          announcement={announcement}
          locale={locale}
          timeZone={timeZone}
        />
      </Suspense>
    </span>
    {canEdit && !announcement.deliveredAt ? (
      <LinkButton
        className="justify-self-start"
        render={<Link href={`/announcements/${announcement.id}/edit`} />}
        size="sm"
        variant="outline"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="admin.announcements.edit_action" />
        </Suspense>
      </LinkButton>
    ) : null}
  </div>
);

/**
 * The banner column of one row: what it says now, and the control that takes it
 * down. Only a pinned announcement has either — an ordinary one is a row in the
 * list and nothing else.
 */
const BannerCell = ({
  announcement,
  canEdit,
  locale,
  tenantId,
  timeZone,
}: {
  announcement: AnnouncementItem;
  canEdit: boolean;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}) => {
  if (!announcement.pinned) {
    return "—";
  }

  return (
    <div className="grid gap-2">
      <span>
        <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
          <BannerStateLabel
            announcement={announcement}
            locale={locale}
            timeZone={timeZone}
          />
        </Suspense>
      </span>
      {canEdit ? (
        <ActionForm.Root
          action={unpinAnnouncementAction}
          className="grid gap-2"
        >
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input name="announcement_id" type="hidden" value={announcement.id} />
          <ActionForm.Submit className="justify-self-start" variant="outline">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.unpin_action" />
            </Suspense>
          </ActionForm.Submit>
        </ActionForm.Root>
      ) : null}
    </div>
  );
};

/** The languages one announcement was written in, each named in itself. */
const TranslatedLocales = ({ locales }: { locales: readonly Locale[] }) => {
  if (locales.length === 0) {
    return "—";
  }

  return (
    <ul className="flex flex-wrap gap-x-2 gap-y-1">
      {locales.map((code) => (
        <li key={code} lang={code}>
          {getLocaleLabel(code)}
        </li>
      ))}
    </ul>
  );
};

const AnnouncementListBody = ({
  announcements,
  canEdit,
  hasPageLinks,
  itemLabel,
  listErrorMessage,
  locale,
  tenantId,
  timeZone,
}: {
  announcements: AnnouncementItem[];
  canEdit: boolean;
  hasPageLinks: boolean;
  /** The list's name, an interpolated value rather than a node. */
  itemLabel: string;
  listErrorMessage?: string;
  locale: Locale;
  tenantId: string;
  timeZone: string;
}) => {
  // A failed fetch still hands an empty `announcements` array; do not show the
  // empty list state alongside the error or operators will read it as "none".
  if (listErrorMessage) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.announcements.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (announcements.length === 0) {
    return (
      <CursorPageEmptyState hasPageLinks={hasPageLinks} itemLabel={itemLabel}>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="admin.announcements.empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="admin.announcements.empty_description" />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </CursorPageEmptyState>
    );
  }

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.created_at" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.title" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.announcements.columns.languages" />
            </Suspense>
          </Table.Head>
          <Table.Head>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.body" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-32">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.announcements.columns.audience" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-44">
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.announcements.columns.status" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-24 text-right">
            <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-16" />}>
              <Message message="admin.announcements.columns.delivered" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-24 text-right">
            <Suspense fallback={<SkeletonLine className="ml-auto h-4 w-16" />}>
              <Message message="admin.announcements.columns.opened" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.columns.delivery" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-40">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.announcements.columns.banner" />
            </Suspense>
          </Table.Head>
          <Table.Head className="w-60">
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="admin.announcements.columns.link" />
            </Suspense>
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {announcements.map((announcement) => (
          <Table.Row key={announcement.id}>
            <Table.Cell>
              {formatAnnouncementDateTime(
                announcement.createdAt,
                locale,
                timeZone
              )}
            </Table.Cell>
            <Table.Cell className="font-medium">
              {announcement.title}
            </Table.Cell>
            <Table.Cell>
              <TranslatedLocales locales={announcement.translatedLocales} />
            </Table.Cell>
            <Table.Cell>{excerpt(announcement.body, 72)}</Table.Cell>
            <Table.Cell>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <AudienceLabel audience={announcement.audience} />
              </Suspense>
            </Table.Cell>
            <Table.Cell>
              <StatusCell
                announcement={announcement}
                canEdit={canEdit}
                locale={locale}
                timeZone={timeZone}
              />
            </Table.Cell>
            <Table.Cell className="text-right tabular-nums">
              {readerCountOf(announcement, announcement.deliveredCount, locale)}
            </Table.Cell>
            <Table.Cell className="text-right tabular-nums">
              {readerCountOf(announcement, announcement.openedCount, locale)}
            </Table.Cell>
            <Table.Cell>
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <DeliveryLabel delivery={announcement.delivery} />
              </Suspense>
            </Table.Cell>
            <Table.Cell>
              <BannerCell
                announcement={announcement}
                canEdit={canEdit}
                locale={locale}
                tenantId={tenantId}
                timeZone={timeZone}
              />
            </Table.Cell>
            <Table.Cell>{announcement.linkUrl || "—"}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
  );
};

/**
 * Awaits the catalog for the list's name and the pager's `aria-label`, which
 * are an interpolated value and an attribute rather than nodes.
 */
export const AnnouncementManager = async ({
  canEdit,
  listErrorMessage,
  nextHref,
  announcements,
  locale,
  pageSize,
  previousHref,
  tenantId,
  timeZone,
}: AnnouncementManagerProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  // Hide the pager on a failed fetch: tokens are empty then, and a bare
  // "previous/next" chrome next to the error looks like the list exists.
  const showPagination =
    !listErrorMessage && (announcements.length > 0 || hasPageLinks);

  return (
    <div className="grid gap-6">
      <AnnouncementListBody
        announcements={announcements}
        canEdit={canEdit}
        hasPageLinks={hasPageLinks}
        itemLabel={t("admin.announcements.title")}
        listErrorMessage={listErrorMessage}
        locale={locale}
        tenantId={tenantId}
        timeZone={timeZone}
      />

      {showPagination ? (
        <PaginationFooter.Root>
          <PaginationFooter.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message
                message="admin.announcements.pagination_description"
                values={{ count: pageSize }}
              />
            </Suspense>
          </PaginationFooter.Description>
          <PaginationFooter.Controls
            aria-label={t("admin.announcements.pagination_aria")}
            nextHref={nextHref}
            previousHref={previousHref}
          />
        </PaginationFooter.Root>
      ) : null}
    </div>
  );
};
