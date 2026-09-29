/**
 * A credited author's share of an episode's sales, as the API stores it: basis
 * points, where 10000 is 100%. What the shares of one episode leave below that
 * is the publisher's own.
 *
 * This module is the half a Client Component may import, so the form and the
 * action parse a typed percentage the same way.
 */

export const MAX_CREDIT_SHARE_BPS = 10_000;

/** Up to 100, with at most two decimal places: the precision a basis point has. */
const SHARE_PERCENT_RE = /^\d{1,3}(?:\.\d{1,2})?$/u;

/**
 * Parses a percentage as the editor typed it into basis points, or `undefined`
 * when it is not one. The digits are read as text rather than multiplied as a
 * float, so 33.33 is 3333 and never 3332.9999.
 *
 * An empty box is 0: a credit without pay is the default, not a mistake.
 */
export const sharePercentToBps = (text: string): number | undefined => {
  const trimmed = text.trim();
  if (trimmed === "") {
    return 0;
  }
  if (!SHARE_PERCENT_RE.test(trimmed)) {
    return;
  }
  const [whole = "", fraction = ""] = trimmed.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return bps <= MAX_CREDIT_SHARE_BPS ? bps : undefined;
};

/** The text a share box opens on: `30`, `33.33`, `0.5`. */
export const shareBpsToPercentText = (bps: number): string => {
  const whole = Math.trunc(bps / 100);
  const fraction = bps % 100;
  if (fraction === 0) {
    return String(whole);
  }
  return `${whole}.${String(fraction).padStart(2, "0").replace(/0$/u, "")}`;
};

/** A share for display, in the viewer's locale: `33.33%`. */
export const formatShareBps = (bps: number, intlLocale: string): string =>
  new Intl.NumberFormat(intlLocale, {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(bps / MAX_CREDIT_SHARE_BPS);

export interface CreditShareTotal {
  /** Some box holds text that is not a share, so no total can be trusted. */
  hasInvalid: boolean;
  totalBps: number;
}

/** Sums the typed shares of one credit list. */
export const totalCreditShares = (
  texts: readonly string[]
): CreditShareTotal => {
  let totalBps = 0;
  let hasInvalid = false;
  for (const text of texts) {
    const bps = sharePercentToBps(text);
    if (bps === undefined) {
      hasInvalid = true;
    } else {
      totalBps += bps;
    }
  }
  return { hasInvalid, totalBps };
};

/** Whether a list can be saved as it stands. */
export const isCreditShareTotalSavable = (total: CreditShareTotal): boolean =>
  !total.hasInvalid && total.totalBps <= MAX_CREDIT_SHARE_BPS;
