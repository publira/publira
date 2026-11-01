/**
 * What a line credits: the episode's sales, or the parts of subscription
 * payments shared to it. An adjustment has the source of the line it adjusts.
 */
export type RoyaltyLineSource = "sale" | "subscription";

/**
 * One creator's credit on one episode for one role, with the month's sales or
 * the parts of its subscription payments, or an adjustment that takes back the
 * refunds recorded on a closed month's line since that month was closed.
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
}

export interface RoyaltyCreatorGroup {
  key: string;
  creatorName: string;
  lines: RoyaltyLine[];
  payoutSubtotal: number;
  /**
   * What the lines of each source pay the creator, adjustments counted with
   * the source of the line they adjust. `null` for a creator with no
   * subscription line, whose one subtotal is the sales'.
   */
  sourceSubtotals: Record<RoyaltyLineSource, number> | null;
}

const sumPayouts = (
  lines: readonly RoyaltyLine[],
  source: RoyaltyLineSource
): number =>
  lines
    .filter((line) => line.source === source)
    .reduce((sum, line) => sum + line.payoutAmount, 0);

/**
 * The lines regrouped by creator, in the order each creator first appears, with
 * what the given lines pay that creator, adjustments included, and apart for
 * sales and for subscription payments once a creator has a subscription line. The API orders
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
      };
      groups.set(key, group);
    }

    group.lines.push(line);
    group.payoutSubtotal += line.payoutAmount;
  }

  return [...groups.values()].map((group) =>
    group.lines.some((line) => line.source === "subscription")
      ? {
          ...group,
          sourceSubtotals: {
            sale: sumPayouts(group.lines, "sale"),
            subscription: sumPayouts(group.lines, "subscription"),
          },
        }
      : group
  );
};
