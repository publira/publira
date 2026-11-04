import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import * as ConsoleSection from "@publira/layouts/admin/console-section";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import * as Table from "@publira/ui-components/table";
import { Suspense } from "react";

import { Message } from "#components/message";
import { formatShareBps } from "#lib/credit-share";
import { formatTenantAmount } from "#lib/price";
import type { RoyaltyCreatorSubtotal } from "#lib/royalty-lines";

interface RoyaltySubtotalsProps {
  /**
   * The currency every amount is in, the statement's or the preview's.
   * `null` when the API answered none, and each amount is then a dash.
   */
  currency: string | null;
  locale: Locale;
  subtotals: readonly RoyaltyCreatorSubtotal[];
  /** The rate the month withholds at, in basis points, `null` for none. */
  withholdingRateBps: number | null;
}

/**
 * What the month pays each Author, the tax that includes, and what is
 * withheld from it, as the API adds them up over every line, so a closed
 * statement's are whole however its lines are paged. A month that states
 * neither tax nor withholding renders nothing: its Authors' subtotals are
 * already under their lines.
 */
export const RoyaltySubtotals = ({
  currency,
  locale,
  subtotals,
  withholdingRateBps,
}: RoyaltySubtotalsProps) => {
  const withTax = subtotals.some((subtotal) => subtotal.taxAmount !== null);

  const withWithholding = subtotals.some(
    (subtotal) => subtotal.withholdingAmount !== null
  );

  if (!(withTax || withWithholding)) {
    return null;
  }

  const amount = (value: number | null) =>
    value === null ? (
      <Message message="admin.royalties.lines.no_tax_rate" />
    ) : (
      formatTenantAmount(value, { currency, locale })
    );

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="admin.royalties.subtotals.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-96" />}>
              <Message message="admin.royalties.subtotals.description" />
              {withholdingRateBps === null ? null : (
                <>
                  {" "}
                  <Message
                    message="admin.royalties.subtotals.withholding_note"
                    values={{
                      rate: formatShareBps(
                        withholdingRateBps,
                        toIntlLocale(locale)
                      ),
                    }}
                  />
                </>
              )}
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                <Message message="admin.royalties.lines.columns.creator" />
              </Suspense>
            </Table.Head>
            <Table.Head className="text-right">
              <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                <Message message="admin.royalties.lines.columns.payout" />
              </Suspense>
            </Table.Head>
            {withTax ? (
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                  <Message message="admin.royalties.lines.columns.tax" />
                </Suspense>
              </Table.Head>
            ) : null}
            {withWithholding ? (
              <Table.Head className="text-right">
                <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                  <Message message="admin.royalties.lines.columns.withholding" />
                </Suspense>
              </Table.Head>
            ) : null}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {subtotals.map((subtotal) => (
            <Table.Row
              key={
                subtotal.creatorPublicId
                  ? `id:${subtotal.creatorPublicId}`
                  : `name:${subtotal.creatorName}`
              }
            >
              <Table.Head className="text-foreground" scope="row">
                {subtotal.creatorName}
              </Table.Head>
              <Table.Cell className="text-right">
                {formatTenantAmount(subtotal.payoutAmount, {
                  currency,
                  locale,
                })}
              </Table.Cell>
              {withTax ? (
                <Table.Cell className="text-right">
                  {amount(subtotal.taxAmount)}
                </Table.Cell>
              ) : null}
              {withWithholding ? (
                <Table.Cell className="text-right">
                  {amount(subtotal.withholdingAmount)}
                </Table.Cell>
              ) : null}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </ConsoleSection.Root>
  );
};
