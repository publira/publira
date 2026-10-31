import type { Locale } from "@publira/i18n";
import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatDateTime } from "@publira/utils";
import { Suspense } from "react";

import * as ListPagination from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { redirectToLogin } from "#lib/auth-session";
import { listMyCoinTransactions } from "#lib/coins";
import type { CoinTransactionItem } from "#lib/coins";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { coinsPageHref, parseCoinsSearchParams } from "../_lib/search-params";
import type { CoinsPageSearchParams } from "../_lib/search-params";

/**
 * What one entry did, in the six kinds the history holds. Each branch writes
 * its own key out.
 */
const TransactionKind = ({ kind }: { kind: CoinTransactionItem["kind"] }) => {
  switch (kind) {
    case "grant": {
      return <Message message="storefront.coins.kind_grant" />;
    }

    case "spend": {
      return <Message message="storefront.coins.kind_spend" />;
    }

    case "revocation": {
      return <Message message="storefront.coins.kind_revocation" />;
    }

    case "expiry": {
      return <Message message="storefront.coins.kind_expiry" />;
    }

    case "shortfall": {
      return <Message message="storefront.coins.kind_shortfall" />;
    }

    default: {
      return <Message message="storefront.coins.kind_settlement" />;
    }
  }
};

/**
 * Which way the entry moved the balance. A grant adds coins; a shortfall
 * moves none, and records what the next grant pays back; everything else
 * takes coins away.
 */
const TransactionAmount = ({
  coinName,
  transaction,
}: {
  coinName: string;
  transaction: CoinTransactionItem;
}) => {
  const values = { coin_name: coinName, count: transaction.coins };

  switch (transaction.kind) {
    case "grant": {
      return (
        <Message message="storefront.coins.amount_added" values={values} />
      );
    }

    case "shortfall": {
      return <Message message="storefront.coins.amount_owed" values={values} />;
    }

    default: {
      return (
        <Message message="storefront.coins.amount_removed" values={values} />
      );
    }
  }
};

const TransactionRow = ({
  coinName,
  locale,
  timeZone,
  transaction,
}: {
  coinName: string;
  locale: Locale;
  timeZone: string;
  transaction: CoinTransactionItem;
}) => {
  const expiresOn = formatDate(transaction.expiresAt, {
    fallback: "",
    locale,
    timeZone,
  });

  const { episode } = transaction;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-border py-3 last:border-b-0">
      <div className="grid min-w-0 gap-1">
        <p className="font-medium">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <TransactionKind kind={transaction.kind} />
          </Suspense>
        </p>
        {episode ? (
          <p className="text-sm">
            <span className="text-muted-foreground" lang={episode.locale}>
              {episode.seriesTitle}
            </span>{" "}
            <LocaleLink
              className="hover:underline"
              href={`/series/${episode.seriesPublicId}/episodes/${episode.publicId}`}
              lang={episode.locale}
            >
              #{episode.orderIndex} {episode.title}
            </LocaleLink>
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground tabular-nums">
          {formatDateTime(transaction.createdAt, {
            fallback: "-",
            locale,
            timeZone,
          })}
          {transaction.kind === "grant" && expiresOn ? (
            <>
              {" · "}
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message
                  message="storefront.coins.grant_expires"
                  values={{ date: expiresOn }}
                />
              </Suspense>
            </>
          ) : null}
        </p>
      </div>
      <p className="tabular-nums">
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <TransactionAmount coinName={coinName} transaction={transaction} />
        </Suspense>
      </p>
    </li>
  );
};

/**
 * The reader's coin history, newest first and a page at a time: every pack
 * that added coins, every episode they paid for, and every coin taken back,
 * lapsed, or owed.
 *
 * The page is already behind a session, so a rejected session sends the
 * reader back to sign in rather than showing them an empty history.
 */
export const CoinHistory = async ({
  searchParams,
}: {
  searchParams: CoinsPageSearchParams;
}) => {
  const [tenantId, locale, { token }] = await Promise.all([
    getTenantId(),
    getLocale(),
    searchParams.then(parseCoinsSearchParams),
  ]);

  const [result, t, timeZone] = await Promise.all([
    listMyCoinTransactions(tenantId, { locale, token }),
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok && result.requiresSignIn) {
    await redirectToLogin(locale, coinsPageHref(token), tenantId);
  }

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.coins.history_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  // The tenant turned its coins off after the page read them.
  if (!result.value) {
    return null;
  }

  const { coinName, nextToken, previousToken, transactions } = result.value;

  if (transactions.length === 0 && !previousToken) {
    return (
      <EmptyState.Root>
        <EmptyState.Heading>
          <EmptyState.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="storefront.coins.history_empty_title" />
            </Suspense>
          </EmptyState.Title>
          <EmptyState.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="storefront.coins.history_empty_description"
                values={{ coin_name: coinName }}
              />
            </Suspense>
          </EmptyState.Description>
        </EmptyState.Heading>
      </EmptyState.Root>
    );
  }

  return (
    <div className="grid gap-4">
      <ol>
        {transactions.map((transaction) => (
          <TransactionRow
            coinName={coinName}
            key={transaction.id}
            locale={locale}
            timeZone={timeZone}
            transaction={transaction}
          />
        ))}
      </ol>
      <ListPagination.Root
        aria-label={t("storefront.coins.history_pagination_aria")}
      >
        <ListPagination.Step
          href={previousToken ? coinsPageHref(previousToken) : ""}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="storefront.common.previous_page" />
          </Suspense>
        </ListPagination.Step>
        <ListPagination.Step href={nextToken ? coinsPageHref(nextToken) : ""}>
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="storefront.common.next_page" />
          </Suspense>
        </ListPagination.Step>
      </ListPagination.Root>
    </div>
  );
};
