import type { Locale } from "@publira/i18n";
import * as Table from "@publira/ui-components/table";
import { formatPlainYearMonth, formatPrice } from "@publira/utils";

import type { MyCreatorStatementLineItem } from "#lib/creator-pages";
import { getMessagesFor } from "#lib/messages";

import { formatCount, formatShareBps } from "../../../../_lib/figures";

/**
 * The Author's lines of one closed month, in the statement's order. A line of
 * subscription payments says so under its episode, and an adjustment names
 * the closed month it takes refunds back from there too, which is what tells
 * its negative figures from a line of the month's own sales — as the console's
 * statement marks them.
 */
export const StatementLines = async ({
  currency,
  lines,
  locale,
}: {
  currency: string;
  lines: readonly MyCreatorStatementLineItem[];
  locale: Locale;
}) => {
  const t = await getMessagesFor(locale);

  return (
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{t("storefront.my_creator.series")}</Table.Head>
          <Table.Head>{t("storefront.my_creator.episode")}</Table.Head>
          <Table.Head>{t("storefront.my_creator.role")}</Table.Head>
          <Table.Head className="text-right">
            {t("storefront.my_creator.sales")}
          </Table.Head>
          <Table.Head className="text-right">
            {t("storefront.my_creator.gross")}
          </Table.Head>
          <Table.Head className="text-right">
            {t("storefront.my_creator.refunded")}
          </Table.Head>
          <Table.Head className="text-right">
            {t("storefront.my_creator.share")}
          </Table.Head>
          <Table.Head className="text-right">
            {t("storefront.my_creator.payout")}
          </Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {lines.length === 0 ? (
          <Table.EmptyRow colSpan={8}>
            {t("storefront.my_creator.lines_empty")}
          </Table.EmptyRow>
        ) : (
          lines.map((line) => (
            <Table.Row key={line.lineNumber}>
              <Table.Cell>{line.seriesTitle}</Table.Cell>
              <Table.Cell>
                {line.episodeTitle}
                {line.source === "subscription" ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("storefront.my_creator.subscription")}
                  </span>
                ) : null}
                {line.adjustedPeriod ? (
                  <span className="block text-xs text-muted-foreground">
                    {t("storefront.my_creator.adjustment", {
                      period: formatPlainYearMonth(line.adjustedPeriod, {
                        locale,
                      }),
                    })}
                  </span>
                ) : null}
              </Table.Cell>
              <Table.Cell>
                {line.roleName || t("storefront.my_creator.no_role")}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatCount(line.saleCount, locale)}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatPrice(line.grossAmount, { currency, locale })}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatPrice(line.refundedAmount, { currency, locale })}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatShareBps(line.shareBps, locale)}
              </Table.Cell>
              <Table.Cell className="text-right">
                {formatPrice(line.payoutAmount, { currency, locale })}
              </Table.Cell>
            </Table.Row>
          ))
        )}
      </Table.Body>
    </Table.Root>
  );
};
