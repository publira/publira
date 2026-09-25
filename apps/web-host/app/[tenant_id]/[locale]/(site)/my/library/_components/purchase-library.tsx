import { toIntlLocale } from "@publira/i18n";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDateTime } from "@publira/utils";
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

interface PurchaseLibraryProps {
  listErrorMessage?: string;
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
    <ListPagination aria-label={t("host.library.pagination_aria")}>
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
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep href={nextToken ? purchasesListHref(nextToken) : ""}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
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
    : t("host.library.no_expiry");

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
        <span
          className={
            purchase.isActive
              ? "rounded-full bg-success/15 px-2 py-1 text-xs font-medium text-success"
              : "rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"
          }
        >
          {t(
            purchase.isActive ? "host.library.readable" : "host.library.expired"
          )}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>{t("host.library.purchased_at")}</dt>
          <dd className="mt-1 text-foreground">
            {formatDateTime(purchase.purchasedAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </dd>
        </div>
        <div>
          <dt>{t("host.library.price")}</dt>
          <dd className="mt-1 text-foreground">
            ¥{purchase.priceAtPurchase.toLocaleString(toIntlLocale(locale))}
          </dd>
        </div>
        <div>
          <dt>{t("host.library.expires_at")}</dt>
          <dd className="mt-1 text-foreground">{expiryLabel}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={href}
        >
          {t("host.library.open_episode")}
        </LocaleLink>
      </div>
    </article>
  );
};

export const PurchaseLibrary = ({
  listErrorMessage,
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
                <Message message="host.library.list_error" />
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
              <Message message="host.library.empty_title" />
            </Suspense>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
              <Message message="host.library.empty_description" />
            </Suspense>
          </p>
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href="/series"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="host.common.find_series" />
            </Suspense>
          </LocaleLink>
        </section>
      ) : null}
      {activePurchases.length > 0 ? (
        <section className="border border-border bg-card p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              <Suspense fallback={<SkeletonLine className="h-6 w-32" />}>
                <Message message="host.library.shelf_heading" />
              </Suspense>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="host.library.shelf_description" />
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
                <Message message="host.library.history_heading" />
              </Suspense>
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              <Suspense fallback={<SkeletonLine className="h-4 w-64" />}>
                <Message message="host.library.history_description" />
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
