/**
 * What a line credits: the episode's sales, the tips readers gave its Authors,
 * or the parts of subscription payments shared to it. An adjustment has the
 * source of the line it adjusts.
 */
export type RoyaltyLineSource = "sale" | "subscription" | "tip";

/**
 * One creator's credit on one episode for one role, with the month's sales,
 * tips, or parts of its subscription payments, or an adjustment that takes back
 * the refunds recorded on a closed month's line since that month was closed.
 */
export interface RoyaltyLine {
  lineNumber: number;
  /**
   * `YYYY-MM` of the closed month an adjustment adjusts, whose figures are
   * then negative changes. Empty for a line of the month's own sales.
   */
  adjustedPeriod: string;
  creatorPublicId: string;
  creatorName: string;
  seriesTitle: string;
  episodeTitle: string;
  /** Empty for a credit that states no role. */
  roleName: string;
  saleCount: number;
  grossAmount: number;
  refundedAmount: number;
  /** Basis points, 10000 being all of it. */
  shareBps: number;
  payoutAmount: number;
  source: RoyaltyLineSource;
  /**
   * The tax rate of the sales or payments the line counts, in basis points,
   * and the tax `payoutAmount` includes at it; on an adjustment, the tax it
   * takes off the line it adjusts. Both `null` on a line of sales made without
   * a rate, and on every line closed before statements carried tax.
   */
  taxRateBps: number | null;
  taxAmount: number | null;
}

/**
 * What a statement pays one Author over all its lines, every page of a closed
 * one included, as the API adds it up.
 */
export interface RoyaltyCreatorSubtotal {
  /** Empty once the Author has been deleted. */
  creatorPublicId: string;
  creatorName: string;
  payoutAmount: number;
  /** `null` where none of the Author's lines has a tax rate. */
  taxAmount: number | null;
  /** `null` where the month withholds nothing. */
  withholdingAmount: number | null;
}

/** What the lines of one source pay a creator, adjustments to them included. */
export interface RoyaltySourceSubtotal {
  source: RoyaltyLineSource;
  payoutAmount: number;
}

export interface RoyaltyCreatorGroup {
  key: string;
  creatorName: string;
  lines: RoyaltyLine[];
  payoutSubtotal: number;
  /**
   * The tax the given lines' payouts include, `null` while none of them has a
   * tax rate.
   */
  taxSubtotal: number | null;
  /**
   * What the sales pay the creator, then the tips and the subscription shares
   * where the creator has a line of them. `null` for a creator with only lines
   * of sales, whose one subtotal is the sales'.
   */
  sourceSubtotals: RoyaltySourceSubtotal[] | null;
}

/** The order a statement's lines come in, which its subtotals follow. */
const LINE_SOURCES: readonly RoyaltyLineSource[] = [
  "sale",
  "tip",
  "subscription",
];

const subtotalBySource = (
  lines: readonly RoyaltyLine[]
): RoyaltySourceSubtotal[] | null => {
  const subtotals = LINE_SOURCES.flatMap((source) => {
    const sourceLines = lines.filter((line) => line.source === source);

    return source === "sale" || sourceLines.length > 0
      ? [
          {
            payoutAmount: sourceLines.reduce(
              (sum, line) => sum + line.payoutAmount,
              0
            ),
            source,
          },
        ]
      : [];
  });

  return subtotals.length > 1 ? subtotals : null;
};

/**
 * The lines regrouped by creator, in the order each creator first appears, with
 * what the given lines pay that creator, adjustments included, and apart for
 * each source once a creator has a line of anything but sales. The API orders
 * the month's own lines by series and episode and puts the adjustments after
 * them, so on a paged statement a subtotal covers only the page it came from.
 *
 * A creator deleted since the close has no public ID left, so those lines are
 * told apart by the name kept on the line instead.
 */
export const groupRoyaltyLinesByCreator = (
  lines: readonly RoyaltyLine[]
): RoyaltyCreatorGroup[] => {
  const groups = new Map<string, RoyaltyCreatorGroup>();

  for (const line of lines) {
    const key = line.creatorPublicId
      ? `id:${line.creatorPublicId}`
      : `name:${line.creatorName}`;

    let group = groups.get(key);

    if (!group) {
      group = {
        creatorName: line.creatorName,
        key,
        lines: [],
        payoutSubtotal: 0,
        sourceSubtotals: null,
        taxSubtotal: null,
      };
      groups.set(key, group);
    }

    group.lines.push(line);
    group.payoutSubtotal += line.payoutAmount;

    if (line.taxAmount !== null) {
      group.taxSubtotal = (group.taxSubtotal ?? 0) + line.taxAmount;
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    sourceSubtotals: subtotalBySource(group.lines),
  }));
};
