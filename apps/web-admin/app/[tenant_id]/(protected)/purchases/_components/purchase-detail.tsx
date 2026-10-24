import type { Locale } from "@publira/i18n";
import * as Identifier from "@publira/ui-components/identifier";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
import Link from "next/link";
import { Suspense } from "react";

import { Message } from "#components/message";
import {
  PurchasePaidThrough,
  PurchaseStatusChip,
} from "#components/purchase-status";
import { redirectToLoginIfSessionRejected } from "#lib/auth-session";
import { getMessagesFor } from "#lib/messages";
import { formatTenantAmount, readCurrency } from "#lib/price";
import type { PurchaseItem } from "#lib/purchase";
import { getPurchase } from "#lib/purchase";
import { purchasedItemHref, purchasedItemLabel } from "#lib/purchased-item";

import { RefundPurchaseButton } from "./refund-purchase-button";

interface PurchaseDetailProps {
  locale: Locale;
  /** The instant a reading period is judged run out against. */
  now: Temporal.Instant;
  providerNames: ReadonlyMap<string, string>;
  purchaseId: string;
  tenantId: string;
  timeZone: string;
}

const labelClassName = "text-sm text-muted-foreground";
const valueClassName = "min-w-0 text-sm";

/**
 * Why a purchase that is not refunded offers no refund, one branch at a time.
 * A purchase refunded already, or being refunded, says so through its status
 * and needs nothing here.
 */
const NotRefundableNote = ({ purchase }: { purchase: PurchaseItem }) => {
  if (purchase.refundedAt || purchase.revocationReason === "refund") {
    return null;
  }
  if (purchase.revocationReason === "staff") {
    return <Message message="admin.purchases.refund_pending" />;
  }
  if (purchase.revocationReason === "dispute") {
    return <Message message="admin.purchases.not_refundable.dispute" />;
  }
  if (purchase.store) {
    return <Message message="admin.purchases.not_refundable.store" />;
  }
  if (!purchase.provider) {
    return <Message message="admin.purchases.not_refundable.no_payment" />;
  }
  return <Message message="admin.purchases.not_refundable.provider" />;
};

/** The revocation's reason, one branch at a time. */
const RevocationReasonLabel = ({ purchase }: { purchase: PurchaseItem }) => {
  switch (purchase.revocationReason) {
    case "dispute": {
      return <Message message="admin.purchases.revocation_reason.dispute" />;
    }
    case "refund": {
      return <Message message="admin.purchases.revocation_reason.refund" />;
    }
    case "staff": {
      return <Message message="admin.purchases.revocation_reason.staff" />;
    }
    default: {
      return null;
    }
  }
};

const formatInstant = (
  value: string,
  locale: Locale,
  timeZone: string
): string => formatDateTime(value, { locale, timeZone });

/**
 * One purchase, read on its own so that a link to it opens even when it is not
 * on the page of the list behind the drawer.
 */
export const PurchaseDetail = async ({
  locale,
  now,
  providerNames,
  purchaseId,
  tenantId,
  timeZone,
}: PurchaseDetailProps) => {
  const [t, result] = await Promise.all([
    getMessagesFor(locale),
    getPurchase(tenantId, purchaseId, locale),
  ]);
  await redirectToLoginIfSessionRejected(result);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="admin.purchases.detail_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  const { purchase } = result;
  if (!purchase) {
    return (
      <p className="text-sm text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
          <Message message="admin.purchases.not_found" />
        </Suspense>
      </p>
    );
  }

  const currency = readCurrency(purchase.currency);

  return (
    <div className="grid gap-5">
      <PurchaseStatusChip now={now} purchase={purchase} />

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.purchases.columns.reader" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          {purchase.readerPublicId ? (
            <div className="grid gap-0.5">
              <Link
                className="font-medium underline-offset-4 hover:underline"
                href={`/readers/${purchase.readerPublicId}`}
              >
                {purchase.readerName || purchase.readerPublicId}
              </Link>
              <span className="text-muted-foreground">
                {purchase.readerEmail}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.purchases.reader_deleted" />
              </Suspense>
            </span>
          )}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.purchases.columns.item" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <div className="grid gap-0.5">
            <Link
              className="font-medium underline-offset-4 hover:underline"
              href={purchasedItemHref(purchase)}
            >
              {purchasedItemLabel(purchase, t)}
            </Link>
            <span className="text-muted-foreground">
              {purchase.seriesTitle || purchase.seriesPublicId}
            </span>
          </div>
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.purchases.columns.purchased_at" />
          </Suspense>
        </dt>
        <dd className={`${valueClassName} tabular-nums`}>
          {formatInstant(purchase.purchasedAt, locale, timeZone)}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.purchases.expires_at" />
          </Suspense>
        </dt>
        <dd className={`${valueClassName} tabular-nums`}>
          {purchase.expiresAt ? (
            formatInstant(purchase.expiresAt, locale, timeZone)
          ) : (
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.purchases.expires_never" />
            </Suspense>
          )}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="admin.purchases.columns.amount" />
          </Suspense>
        </dt>
        <dd className={`${valueClassName} tabular-nums`}>
          {formatTenantAmount(purchase.price, { currency, locale })}
        </dd>

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.purchases.columns.paid_through" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <PurchasePaidThrough
            providerNames={providerNames}
            purchase={purchase}
          />
        </dd>

        {purchase.refundedAmount > 0 ? (
          <>
            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.purchases.refunded_amount" />
              </Suspense>
            </dt>
            <dd className={`${valueClassName} tabular-nums`}>
              {formatTenantAmount(purchase.refundedAmount, {
                currency,
                locale,
              })}
            </dd>
          </>
        ) : null}

        {purchase.revokedAt ? (
          <>
            <dt className={labelClassName}>
              <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                <Message message="admin.purchases.revoked_at" />
              </Suspense>
            </dt>
            <dd className={valueClassName}>
              <div className="grid gap-0.5">
                <span className="tabular-nums">
                  {formatInstant(purchase.revokedAt, locale, timeZone)}
                </span>
                <span className="text-muted-foreground">
                  <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                    <RevocationReasonLabel purchase={purchase} />
                  </Suspense>
                </span>
              </div>
            </dd>
          </>
        ) : null}

        <dt className={labelClassName}>
          <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
            <Message message="admin.purchases.purchase_id" />
          </Suspense>
        </dt>
        <dd className={valueClassName}>
          <Identifier.Root>
            <Identifier.Value>{purchase.id}</Identifier.Value>
            <Identifier.Copy
              aria-label={t("admin.purchases.copy_purchase_id")}
              value={purchase.id}
            />
          </Identifier.Root>
        </dd>
      </dl>

      {purchase.refundable ? (
        <RefundPurchaseButton purchaseId={purchase.id} tenantId={tenantId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <NotRefundableNote purchase={purchase} />
          </Suspense>
        </p>
      )}
    </div>
  );
};
