/**
 * One creator's credit on one episode for one role, with the month's sales, or
 * an adjustment that takes back the refunds recorded on the sales of a closed
 * month's line since that month was closed.
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
}

export interface RoyaltyCreatorGroup {
  key: string;
  creatorName: string;
  lines: RoyaltyLine[];
  payoutSubtotal: number;
}

/**
 * The lines regrouped by creator, in the order each creator first appears, with
 * what the given lines pay that creator, adjustments included. The API orders
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
      };
      groups.set(key, group);
    }

    group.lines.push(line);
    group.payoutSubtotal += line.payoutAmount;
  }

  return [...groups.values()];
};
