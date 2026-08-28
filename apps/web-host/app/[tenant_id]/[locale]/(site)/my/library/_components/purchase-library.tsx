import { getMessage, toIntlLocale } from "@publira/i18n";
import { SectionError } from "@publira/ui-components/section-error";
import { formatDateTime } from "@publira/utils";

import { LocaleLink } from "#components/locale-link";
import { getLocale, loadHostMessages } from "#lib/locale";
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
 * Resolves the catalog itself rather than taking it as a prop: every caller
 * already sits inside the section's own boundary, and the `aria-label` cannot
 * stream in any case.
 */
const PurchasePagination = async ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.library.pagination_aria")}
      className="mt-6 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={purchasesListHref(previousToken)}
        >
          {getMessage(messages, "host.common.previous_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.previous_page")}
        </span>
      )}
      {nextToken ? (
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={purchasesListHref(nextToken)}
        >
          {getMessage(messages, "host.common.next_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.next_page")}
        </span>
      )}
    </nav>
  );
};

const PurchaseCard = async ({
  purchase,
  timeZone,
}: {
  purchase: PurchaseItem;
  timeZone: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  const href = `/series/${purchase.series.publicId}/episodes/${purchase.episode.publicId}`;
  const expiryLabel = purchase.expiresAt
    ? formatDateTime(purchase.expiresAt, { fallback: "-", locale, timeZone })
    : getMessage(messages, "host.library.no_expiry");

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
          {getMessage(
            messages,
            purchase.isActive ? "host.library.readable" : "host.library.expired"
          )}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        <div>
          <dt>{getMessage(messages, "host.library.purchased_at")}</dt>
          <dd className="mt-1 text-foreground">
            {formatDateTime(purchase.purchasedAt, {
              fallback: "-",
              locale,
              timeZone,
            })}
          </dd>
        </div>
        <div>
          <dt>{getMessage(messages, "host.library.price")}</dt>
          <dd className="mt-1 text-foreground">
            ¥{purchase.priceAtPurchase.toLocaleString(toIntlLocale(locale))}
          </dd>
        </div>
        <div>
          <dt>{getMessage(messages, "host.library.expires_at")}</dt>
          <dd className="mt-1 text-foreground">{expiryLabel}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <LocaleLink
          className="text-sm text-primary underline-offset-4 hover:underline"
          href={href}
        >
          {getMessage(messages, "host.library.open_episode")}
        </LocaleLink>
      </div>
    </article>
  );
};

export const PurchaseLibrary = async ({
  listErrorMessage,
  nextToken,
  previousToken,
  purchases,
  timeZone,
}: PurchaseLibraryProps) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  const activePurchases = purchases.filter((purchase) => purchase.isActive);
  const expiredPurchases = purchases.filter((purchase) => !purchase.isActive);

  return (
    <div className="space-y-6">
      {listErrorMessage ? (
        <SectionError
          description={listErrorMessage}
          title={getMessage(messages, "host.library.list_error")}
        />
      ) : null}
      {!listErrorMessage && purchases.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-6">
          <h2 className="text-lg font-semibold">
            {getMessage(messages, "host.library.empty_title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {getMessage(messages, "host.library.empty_description")}
          </p>
          <LocaleLink
            className="mt-4 inline-flex text-sm text-primary underline-offset-4 hover:underline"
            href="/series"
          >
            {getMessage(messages, "host.common.find_series")}
          </LocaleLink>
        </section>
      ) : null}
      {activePurchases.length > 0 ? (
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              {getMessage(messages, "host.library.shelf_heading")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {getMessage(messages, "host.library.shelf_description")}
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
        <section className="rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">
              {getMessage(messages, "host.library.history_heading")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {getMessage(messages, "host.library.history_description")}
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
