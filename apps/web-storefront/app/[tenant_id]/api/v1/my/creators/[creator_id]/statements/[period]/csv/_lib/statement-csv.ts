import type { MyCreatorStatementExport } from "#lib/creator-pages";
import { CSV_BOM, encodeCsvRow } from "#lib/csv";

const HEADER = [
  "period",
  "role_name",
  "series_id",
  "series_title",
  "episode_id",
  "episode_title",
  "sale_count",
  "gross_amount",
  "refunded_amount",
  "share_percent",
  "payout_amount",
  "currency",
  "adjusted_period",
  "source",
] as const;

/** A share in basis points as a percentage with two decimals: `12.50`. */
const sharePercent = (bps: number): string =>
  `${Math.trunc(bps / 100)}.${String(bps % 100).padStart(2, "0")}`;

/**
 * The Author's lines of a closed month as CSV, laid out as `#lib/csv`
 * describes: a header row, then one row per line in the statement's order,
 * with no summary row.
 *
 * The columns are those of the console's export of the same month, in the same
 * order and written the same way — amounts as integers in the minor unit of
 * `currency`, the share with two decimals — so a sheet built on one reads the
 * other. Three are left out: `creator_id` and `creator_name`, which would name
 * the reader's own Author on every row, and `role_id`, which the reader's API
 * does not answer. `series_id` and `episode_id` are the public IDs the
 * storefront's URLs carry, where the console's are its internal ones, and are
 * empty once the row a line named has been deleted.
 */
export const renderStatementCsv = ({
  lines,
  statement,
}: Pick<MyCreatorStatementExport, "lines" | "statement">): string =>
  CSV_BOM +
  encodeCsvRow(HEADER) +
  lines
    .map((line) =>
      encodeCsvRow([
        statement.period,
        line.roleName,
        line.seriesPublicId,
        line.seriesTitle,
        line.episodePublicId,
        line.episodeTitle,
        String(line.saleCount),
        String(line.grossAmount),
        String(line.refundedAmount),
        sharePercent(line.shareBps),
        String(line.payoutAmount),
        statement.currency,
        line.adjustedPeriod,
        line.source,
      ])
    )
    .join("");
