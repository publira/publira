import type { Locale } from "@publira/i18n";
import { LinkButton } from "@publira/ui-components/button";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime, formatPrice } from "@publira/utils";
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { PurchaseItem } from "#lib/purchases";

import { purchasesListHref } from "../_lib/search-params";
import { RentalTimeLeft } from "./rental-time-left";

/**
 * The Route Handler that answers every purchase the library lists as CSV. It
 * sits outside the locale tree, so the path carries no prefix and the language
 * goes in the query instead. The link is a
 * plain navigation: the CSV arrives as an attachment and the sign-in redirect
 * as a page, which a `download` attribute would save as a file instead.
 */
const PURCHASES_CSV_PATH = "/api/v1/my/purchases/csv";

interface PurchaseLibraryProps {
  listErrorMessage?: string;
  /** The library's language, which the download reads the titles in. */
  locale: Locale;
  nextToken: string;
  previousToken: string;
  purchases: PurchaseItem[];
  timeZone: string;
}

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the accessor: an `aria-label` cannot be a node. The key stays written out
 * here, beside the call that reads it.
 */
const PurchasePaginationNav = async ({ children }: { children: ReactNode }) => {
  const t = await getMessages();

  return (
    <ListPagination aria-label={t("storefront.library.pagination_aria")}>
      {children}
    </ListPagination>
  );
};

const PurchasePagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <PurchasePaginationNav>
      <ListPaginationStep
        href={previousToken ? purchasesListHref(previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="storefront.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep href={nextToken ? purchasesListHref(nextToken) : ""}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="storefront.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </PurchasePaginationNav>
  </Suspense>
);

const PurchaseCard = async ({
  purchase,
  timeZone,
}: {
  purchase: PurchaseItem;
  timeZone: string;
}) => {
  const locale = await getLocale();
  const t = await getMessagesFor(locale);
  const href = `/series/${purchase.series.publicId}/episodes/${purchase.episode.publicId}`;
  const expiryLabel = purchase.expiresAt
    ? formatDateTime(purchase.expiresAt, { fallback: "-", locale, timeZone })
    : t("storefront.library.no_expiry");

  return (
    <article className="rounded-xl border border-border/70 bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {purchase.series.title}
          </p>
          <h3 className="mt-1 font-medium">
            <LocaleLink className="hover:underline" href={href}>
              #{purchase.episode.orderIndex} {purchase.episode.title}
            </LocaleLink>
          </h3>
        </div>
        {purchase.refundedAt ? (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("storefront.library.refunded")}
          </span>
        ) : null}
        {!purchase.refundedAt && purchase.revokedAt ? (
          <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
            {t("storefront.library.canceled")}
          </span>
        ) : null}
        {purchase.refundedAt || purchase.revokedAt ? null : (
          <span
            className={
              purchase.isActive
                ? "rounded-full bg-success/15 px-2 py-1 text-xs font-medium text-success"
                : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
            }
          >
            {purchase.isActive
              ? t("storefront.library.readable")
              : t("storefront.library.expired")}
          </span>
        )}
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-4">
        <div>
          <dt>{t("storefront.library.kind")}</dt>
          <dd className="mt-1 text-foreground">
            {purchase.kind === "rental"
              ? t("storefront.library.kind_rental")
              : t("storefront.library.kind_purchase")}
          </dd>
        </div>
        <div>
          <dt>{t("storefront.library.purchased_at")}</dt>
          <dd className="mt-1 text-foreground">
            {formatDateTime(purchase.purchasedAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </dd>
        </div>
        <div>
          <dt>{t("storefront.library.price")}</dt>
          <dd className="mt-1 text-foreground">
            {formatPrice(purchase.priceAtPurchase, {
              currency: purchase.currency,
              locale,
            })}
          </dd>
        </div>
        <div>
          <dt>{t("storefront.library.expires_at")}</dt>
          <dd className="mt-1 text-foreground">
            {expiryLabel}
            {purchase.kind === "rental" &&
            purchase.isActive &&
            purchase.expiresAt ? (
              <RentalTimeLeft expiresAt={purchase.expiresAt} />
            ) : null}
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={href}
        >
          {t("storefront.library.open_episode")}
        </LocaleLink>
      </div>
    </article>
  );
};

export const PurchaseLibrary = ({
  listErrorMessage,
  locale,
  nextToken,
  previousToken,
  purchases,
  timeZone,
}: PurchaseLibraryProps) => {
  const activePurchases = purchases.filter((purchase) => purchase.isActive);
  const expiredPurchases = purchases.filter((purchase) => !purchase.isActive);

  return (
    <div className="space-y-6">
      {listErrorMessage ? (
        <SectionError>
          <SectionErrorHeading>
            <SectionErrorTitle>
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="storefront.library.list_error" />
              </Suspense>
            </SectionErrorTitle>
            <SectionErrorDescription>
              {listErrorMessage}
            </SectionErrorDescription>
          </SectionErrorHeading>
        </SectionError>
      ) : null}
      {!listErrorMessage && purchases.length === 0 ? (
        <section className="border border-dashed border-border bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">
            <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
              <Message message="storefront.library.empty_title" />
            </Suspense>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="storefront.library.empty_description" />
            </Suspense>
          </p>
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href="/series"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="storefront.common.find_series" />
            </Suspense>
          </LocaleLink>
        </section>
      ) : null}
      {!listErrorMessage && purchases.length > 0 ? (
        <div className="flex justify-end">
          <LinkButton
            href={`${PURCHASES_CSV_PATH}?${new URLSearchParams({ locale })}`}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <Message message="storefront.library.download_csv" />
            </Suspense>
          </LinkButton>
        </div>
      ) : null}
      {activePurchases.length > 0 ? (
        <section className="border border-border bg-card p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
                <Message message="storefront.library.shelf_heading" />
              </Suspense>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="storefront.library.shelf_description" />
              </Suspense>
            </p>
          </div>
          <div className="grid gap-3">
            {activePurchases.map((purchase) => (
              <PurchaseCard
                key={purchase.id}
                purchase={purchase}
                timeZone={timeZone}
              />
            ))}
          </div>
        </section>
      ) : null}
      {expiredPurchases.length > 0 ? (
        <section className="border border-border bg-card p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
                <Message message="storefront.library.history_heading" />
              </Suspense>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="storefront.library.history_description" />
              </Suspense>
            </p>
          </div>
          <div className="grid gap-3">
            {expiredPurchases.map((purchase) => (
              <PurchaseCard
                key={purchase.id}
                purchase={purchase}
                timeZone={timeZone}
              />
            ))}
          </div>
        </section>
      ) : null}
      {!listErrorMessage && purchases.length > 0 ? (
        <PurchasePagination
          nextToken={nextToken}
          previousToken={previousToken}
        />
      ) : null}
    </div>
  );
};
