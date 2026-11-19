import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import { CursorPageEmptyState } from "#components/cursor-page-empty-state";
import * as GroupNav from "#components/group-nav";
import { Message } from "#components/message";
import * as PaginationFooter from "#components/pagination-controls";
import type { CursorPageHrefs } from "#lib/cursor-page";
import { hasCursorPageLinks } from "#lib/cursor-page";
import { getMessagesFor } from "#lib/messages";
import type { WebhookDeliveryItem } from "#lib/webhooks";

import type { DeliveryFilters } from "../_lib/search-params";
import { deliveryListQuery } from "../_lib/search-params";
import { WebhookDeliveryResendButton } from "./webhook-delivery-resend-button";
import { WebhookDeliveryStatusChip } from "./webhook-delivery-status";
import { WebhookEventLabel } from "./webhook-event-label";

type WebhookDeliveriesSectionProps = CursorPageHrefs & {
  deliveries: WebhookDeliveryItem[];
  listErrorMessage?: string;
  locale: Locale;
  pageSize: number;
  status: DeliveryFilters["status"];
  tenantId: string;
  timeZone: string;
};

/** What the endpoint last answered, and why the attempt failed if it did. */
const LastResponseCell = ({ delivery }: { delivery: WebhookDeliveryItem }) => (
  <div className="grid max-w-64 gap-0.5">
    <span className="tabular-nums">
      {delivery.lastStatusCode > 0 ? (
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message
            message="admin.settings.webhooks.deliveries.http_status"
            values={{ code: String(delivery.lastStatusCode) }}
          />
        </Suspense>
      ) : null}
      {delivery.lastStatusCode === 0 && delivery.attempts > 0 ? (
        <span className="text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.settings.webhooks.deliveries.no_response" />
          </Suspense>
        </span>
      ) : null}
    </span>
    {delivery.lastError ? (
      <span className="text-xs break-words text-muted-foreground">
        {delivery.lastError}
      </span>
    ) : null}
  </div>
);

/** The recent deliveries, narrowed to the failed or the dead ones on request. */
export const WebhookDeliveriesSection = async ({
  deliveries,
  listErrorMessage,
  locale,
  nextHref,
  pageSize,
  previousHref,
  status,
  tenantId,
  timeZone,
}: WebhookDeliveriesSectionProps) => {
  const t = await getMessagesFor(locale);
  const hasPageLinks = hasCursorPageLinks({ nextHref, previousHref });

  const filter = (
    <GroupNav.Root
      aria-label={t("admin.settings.webhooks.deliveries.filter_aria")}
    >
      <GroupNav.Link current={status === ""} href={deliveryListQuery("")}>
        <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
          <Message message="admin.settings.webhooks.deliveries.filter_all" />
        </Suspense>
      </GroupNav.Link>
      <GroupNav.Link
        current={status === "failed"}
        href={deliveryListQuery("failed")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
          <Message message="admin.settings.webhooks.deliveries.filter_failed" />
        </Suspense>
      </GroupNav.Link>
      <GroupNav.Link
        current={status === "dead"}
        href={deliveryListQuery("dead")}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
          <Message message="admin.settings.webhooks.deliveries.filter_dead" />
        </Suspense>
      </GroupNav.Link>
    </GroupNav.Root>
  );

  const pagination = (
    <PaginationFooter.Root>
      <PaginationFooter.Description>
        {t("admin.settings.webhooks.deliveries.pagination_description", {
          count: pageSize,
        })}
      </PaginationFooter.Description>
      <PaginationFooter.Controls
        aria-label={t("admin.settings.webhooks.deliveries.pagination_aria")}
        nextHref={nextHref}
        previousHref={previousHref}
      />
    </PaginationFooter.Root>
  );

  let body = (
    <>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head className="w-44">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.created_at" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.event" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.endpoint" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24 text-right whitespace-nowrap">
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.attempts" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-28">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.status" />
              </Suspense>
            </Table.Head>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.webhooks.deliveries.columns.last_response" />
              </Suspense>
            </Table.Head>
            <Table.Head className="w-24">
              <span className="sr-only">
                <Suspense fallback={null}>
                  <Message message="admin.settings.webhooks.deliveries.columns.actions" />
                </Suspense>
              </span>
            </Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {deliveries.map((delivery) => (
            <Table.Row key={delivery.id}>
              <Table.Cell className="tabular-nums">
                {formatDateTime(delivery.createdAt, { locale, timeZone })}
              </Table.Cell>
              <Table.Cell>
                {delivery.eventType ? (
                  <div className="grid gap-0.5">
                    <span className="font-medium">
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-28" />}
                      >
                        <WebhookEventLabel eventType={delivery.eventType} />
                      </Suspense>
                    </span>
                    <code className="text-xs text-muted-foreground">
                      {delivery.eventType}
                    </code>
                  </div>
                ) : null}
              </Table.Cell>
              <Table.Cell className="min-w-48 break-all">
                {delivery.endpointUrl}
              </Table.Cell>
              <Table.Cell className="text-right tabular-nums">
                {delivery.attempts}
              </Table.Cell>
              <Table.Cell>
                {delivery.status ? (
                  <WebhookDeliveryStatusChip status={delivery.status} />
                ) : null}
              </Table.Cell>
              <Table.Cell>
                <LastResponseCell delivery={delivery} />
              </Table.Cell>
              <Table.Cell>
                {delivery.status === "dead" ? (
                  <WebhookDeliveryResendButton
                    aria-label={t(
                      "admin.settings.webhooks.deliveries.resend_aria",
                      {
                        date: formatDateTime(delivery.createdAt, {
                          locale,
                          timeZone,
                        }),
                        endpoint: delivery.endpointUrl,
                      }
                    )}
                    deliveryId={delivery.id}
                    tenantId={tenantId}
                  />
                ) : null}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      {pagination}
    </>
  );

  if (listErrorMessage) {
    body = (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.integrations.deliveries_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>
            {listErrorMessage}
          </SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  } else if (deliveries.length === 0) {
    body = (
      <>
        <CursorPageEmptyState
          hasPageLinks={hasPageLinks}
          itemLabel={t("admin.settings.webhooks.deliveries.item_label")}
        >
          {status ? (
            <EmptyState.Heading>
              <EmptyState.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.webhooks.deliveries.empty_filtered_title" />
                </Suspense>
              </EmptyState.Title>
              <EmptyState.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.webhooks.deliveries.empty_filtered_description" />
                </Suspense>
              </EmptyState.Description>
            </EmptyState.Heading>
          ) : (
            <EmptyState.Heading>
              <EmptyState.Title>
                <Suspense fallback={<SkeletonLine className="h-5 w-48" />}>
                  <Message message="admin.settings.webhooks.deliveries.empty_title" />
                </Suspense>
              </EmptyState.Title>
              <EmptyState.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                  <Message message="admin.settings.webhooks.deliveries.empty_description" />
                </Suspense>
              </EmptyState.Description>
            </EmptyState.Heading>
          )}
        </CursorPageEmptyState>
        {hasPageLinks ? pagination : null}
      </>
    );
  }

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-6 w-28" />}>
              <Message message="admin.settings.webhooks.deliveries.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message message="admin.settings.webhooks.deliveries.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      {filter}
      {body}
    </ConsoleSection.Root>
  );
};
